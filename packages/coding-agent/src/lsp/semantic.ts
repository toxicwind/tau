/**
 * semantic.ts — bge-m3 dense-semantic layer for LSP type intelligence.
 *
 * Structural LSP (textDocument/definition, /references) returns candidates by
 * name+position graph identity. Overloads, generics, shadowed renames and
 * cross-package re-exports make structural results ambiguous or noisy: the
 * server knows WHERE symbols are, not WHAT the queried one MEANS in context.
 *
 * This module fuses a dense bge-m3 embedding index with the structural
 * candidate set: given the *query context* (symbol + container + detail +
 * surrounding line) and the *candidate locations*, it embeds each and returns
 * candidates ranked by cosine similarity of *meaning* — resolving the overload
 * / shadowed / re-exported definition that actually matches intent.
 *
 * It is strictly additive: it never removes a structural candidate, always
 * degrades gracefully to the structural order when the embedding lane is
 * unavailable (no key / timeout / 429), and only re-ranks when there is more
 * than one candidate (single candidate = unambiguous, skip embedding cost).
 */
import { cosine, embedMany, embedOne } from "/home/toxic/pens/barn/products/forge/hf/hf";
import { logger } from "@tau/tau-utils";
import type { Location } from "./types";

export interface SemanticCandidate {
	/** Index into the original candidate array so callers keep the structure. */
	index: number;
	/** Cosine similarity of this candidate's context to the query context. */
	score: number;
	/** The context text that was embedded for this candidate (debugging). */
	context: string;
}

export interface SemanticRankOptions {
	/** Text describing the queried symbol's meaning (symbol + container + detail + line). */
	queryContext: string;
	/** Per-candidate context blobs, aligned with `candidates`. */
	candidateContexts: string[];
	/** Re-ranking interleaves semantic winners first but always keeps every candidate. */
	topN?: number;
	/** bge-m3 free lane is effectively unlimited (2026-11-02 verified ~99.9%); keep a sane cap. */
	maxEmbed?: number;
	/** Only re-rank when this many candidate contexts are available. */
	minCandidates?: number;
	/** Abort the embedding pass on signal. */
	signal?: AbortSignal;
}

export interface SemanticRankResult {
	ranks: SemanticCandidate[];
	/** True when the bge-m3 lane actually produced rankings (embedded, cosine computed). */
	embedded: boolean;
	/** Human-readable note for debug output. */
	note?: string;
}

/** Deterministic dimension guard for bge-m3 (1024 per estate doctrine). */
const BGE_DIM = 1024;

function truncated(text: string, n = 400): string {
	const t = text.trim().replace(/\s+/g, " ");
	return t.length > n ? `${t.slice(0, n)}…` : t;
}

/**
 * Embed the query + candidate contexts and rank candidates by cosine similarity
 * to the query. Best-match-first. Shared internals so definition and references
 * both call one code path.
 */
export async function semanticRank(opts: SemanticRankOptions): Promise<SemanticRankResult> {
	const min = opts.minCandidates ?? 2;
	const embedded = false;
	const base: SemanticRankResult = {
		ranks: opts.candidateContexts.map((_, index) => ({ index, score: 0, context: opts.candidateContexts[index] })),
		embedded,
		note: min > opts.candidateContexts.length ? "single candidate — structural order kept" : undefined,
	};

	if (opts.candidateContexts.length < min) {
		return base;
	}
	if (opts.signal?.aborted) return base;

	// Cap the embed batch; below the topN threshold extra embedding is waste.
	const cap = Math.min(opts.candidateContexts.length, opts.topN ?? 8, opts.maxEmbed ?? 16);
	const targets = opts.candidateContexts.slice(0, cap);
	const query = truncated(opts.queryContext);

	try {
		// SERIAL, not Promise.all (2026-11-03 audit): freeinference rate-limits
		// CONCURRENT embed batches and answers the loser with {data:[]} — HTTP
		// 200, empty, no error. The concurrent pair here lost a side on 3/4
		// measured runs, and the dim-check below silently degraded to structural
		// order — meaning the semantic re-rank almost never actually ran under
		// load. Serialize the two calls and require the full answer (retry once
		// for transient rate pressure; sustained short answers keep the additive
		// degrade contract).
		const embedFull = async (inputs: string[]): Promise<number[][]> => {
			for (let attempt = 0; attempt < 2; attempt++) {
				const vecs = await embedMany(inputs);
				if (vecs.length === inputs.length && vecs.every(v => v.length === BGE_DIM)) return vecs;
				if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 900));
			}
			throw new Error(`embed short-answer after retry (${inputs.length} inputs)`);
		};
		const queryVecs = await embedFull([query]);
		const targetVecs = await embedFull(targets.map(t => truncated(t)));
		const queryVec = queryVecs[0];
		if (queryVec.length !== BGE_DIM) {
			return { ...base, note: `bge-m3 dimension mismatch (${queryVec.length}) — structural order kept` };
		}
		const ranked = targetVecs
			.map((vec, index) => ({ index, score: cosine(queryVec, vec), context: targets[index] }))
			.sort((a, b) => b.score - a.score);
		return { ranks: ranked, embedded: true };
	} catch (err) {
		// Embedding failure must never break core LSP. Log and keep structural order.
		logger.warn("lsp semantic rank fell back to structural order", {
			error: err instanceof Error ? err.message : String(err),
			contexts: opts.candidateContexts.length,
		});
		return { ...base, note: "embedding lane unavailable — structural order kept" };
	}
}

/** Build a compact context token for a candidate location from its file + range. */
export function locationContext(location: Location, cwd = ""): string {
	const file = location.uri.replace(/^file:\/\//, "").replace(cwd.replace(/\/$/, ""), "");
	return `${file}:${location.range.start.line}:${location.range.start.character} ${
		location.range.start.line !== location.range.end.line ? `-${location.range.end.line}` : ""
	}`;
}