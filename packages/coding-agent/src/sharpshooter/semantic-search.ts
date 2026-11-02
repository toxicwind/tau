import { logger } from "@tau/tau-utils";

/**
 * Semantic search over sharpshooter decision lines using the estate-owned
 * OpenAI-compatible embedding lane (freeinference bge-m3, keyring-SSOT).
 *
 * Decoupled from mnemotau: `memory.backend=hindsight` disables mnemotau's
 * config surface, so sharpshooter reads its OWN `sharpshooter.embedding*`
 * settings. No API key configured == substring fallback (never breaks search).
 *
 * The embed API is stateless per call; failures degrade to substring so the
 * decision-memory backend never bricks on a dead lane.
 */
export interface SemanticSearchLine {
	content: string;
	file: string;
}

export interface SemanticSearchConfig {
	/** OpenAI-compatible /v1/embeddings base URL, e.g. https://freeinference.org/v1 */
	apiUrl?: string;
	/** e.g. bge-m3 */
	model?: string;
	/** Keyring-SSOT key; absent/empty disables semantic search. */
	apiKey?: string;
	/** Optional transport override (tests). */
	http?: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
		status: number;
		text(): Promise<string>;
	}>;
}

const DEFAULT_HTTP = fetch as SemanticSearchConfig["http"] extends never
	? never
	: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
			status: number;
			text(): Promise<string>;
		}>;

/** Normalized embedding vector pair for cosine ranking. */
export async function embedTexts(
	texts: readonly string[],
	cfg: SemanticSearchConfig,
): Promise<number[][] | null> {
	if (!cfg.apiKey || !cfg.apiUrl || !cfg.model) return null;
	const http = cfg.http ?? (fetch as typeof DEFAULT_HTTP);
	const body = JSON.stringify({ model: cfg.model, input: [...texts] });
	let res: { status: number; text(): Promise<string> };
	try {
		res = await http(`${cfg.apiUrl.replace(/\/+$/, "")}/embeddings`, {
			method: "POST",
			headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
			body,
		});
	} catch (err) {
		logger.debug("sharpshooter semantic search: embed transport failed", {
			error: err instanceof Error ? err.message : String(err),
		});
		return null;
	}
	if (!res || res.status !== 200) {
		logger.debug("sharpshooter semantic search: embed HTTP {status}", { status: res?.status });
		return null;
	}
	try {
		const data = JSON.parse(await res.text()) as { data?: Array<{ embedding?: number[] }> };
		const vectors = (data.data ?? []).map((d) => d.embedding);
		if (vectors.some((v) => !Array.isArray(v) || v.length === 0)) return null;
		return vectors as number[][];
	} catch {
		return null;
	}
}

function dot(a: number[], b: number[]): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * b[i];
	return s;
}

function norm(a: number[]): number {
	return Math.sqrt(dot(a, a));
}

export function cosine(a: number[], b: number[]): number {
	const na = norm(a);
	const nb = norm(b);
	if (na === 0 || nb === 0) return 0;
	return dot(a, b) / (na * nb);
}

/**
 * Rank matching decision lines semantically. Always returns a result; when the
 * embed lane is unavailable/absent it falls back to case-insensitive substring
 * (preserving prior behavior exactly) then alphabetic order.
 */
export async function semanticSearch(
	query: string,
	lines: readonly SemanticSearchLine[],
	cfg: SemanticSearchConfig,
	options: {
		limit?: number;
		threshold?: number;
		embed?: (texts: readonly string[]) => Promise<number[][] | null>;
	} = {},
	fetchImpl?: SemanticSearchConfig["http"],
): Promise<SemanticSearchLine[]> {
	const { limit = 8, threshold = 0.1, embed } = options;
	const needle = query.trim().toLowerCase();
	if (!needle) return [];

	const effective: SemanticSearchConfig = cfg.http ? cfg : { ...cfg, http: fetchImpl };
	const embedOrRemote = async (texts: readonly string[]): Promise<number[][] | null> => {
		try {
			return (await embed?.(texts)) ?? (await embedTexts(texts, effective));
		} catch {
			logger.debug("sharpshooter semantic search: embed lane unavailable; substring fallback");
			return null;
		}
	};

	const qv = (await embedOrRemote([query]))?.[0];

	if (qv) {
		const scored: Array<{ line: SemanticSearchLine; score: number }> = [];
		const chunk: string[] = [];
		const map: SemanticSearchLine[] = [];
		for (const line of lines) {
			const c = line.content.trim();
			if (!c) continue;
			chunk.push(c);
			map.push(line);
			if (chunk.length === 16) {
				const vecs = await embedOrRemote(chunk);
				if (vecs) {
					for (let i = 0; i < vecs.length; i++) {
						const s = cosine(qv, vecs[i]);
						if (s > threshold) scored.push({ line: map[i], score: s });
					}
				}
				chunk.length = 0;
				map.length = 0;
			}
		}
		if (chunk.length && map.length) {
			const vecs = await embedOrRemote(chunk);
			if (vecs) {
				for (let i = 0; i < vecs.length; i++) {
					const s = cosine(qv, vecs[i]);
					if (s > threshold) scored.push({ line: map[i], score: s });
				}
			}
		}
		if (scored.length) {
			scored.sort((a, b) => b.score - a.score);
			const ranked = scored.slice(0, limit).map((r) => r.line);
			// Substring matches always win (exact text over semantic proximity).
			const exact = lines.filter((l) => l.content.toLowerCase().includes(needle)).slice(0, limit);
			const merged = [...exact];
			for (const r of ranked) {
				if (!merged.some((m) => m.content === r.content && m.file === r.file)) merged.push(r);
			}
			return merged.slice(0, limit);
		}
	}

	// Fallback: substring (legacy behavior).
	return lines.filter((l) => l.content.toLowerCase().includes(needle)).slice(0, limit);
}