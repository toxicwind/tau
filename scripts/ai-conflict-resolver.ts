#!/usr/bin/env bun

/**
 * Resolve the conflict markers `weave-driver` leaves behind.
 *
 * WHY THIS EXISTS
 * ---------------
 * `upstream-pull.ts` merges 4,607 realigned package/import references across
 * ~7,900 paths with no shared git history. weave-driver auto-resolves what it
 * can and falls back to line-level markers for the rest. Those markers are the
 * AUTHORITY on residue — a clean parse proves nothing, so somebody has to read
 * them and decide.
 *
 * THE FOUR CAPABILITIES, AND WHERE EACH CAME FROM
 * ----------------------------------------------
 *   | capability             | source             | mechanism here                        |
 *   |------------------------|--------------------|---------------------------------------|
 *   | AST context harvesting | Gito (#249)        | `harvestScope` walks up to the        |
 *   |                        |                    | enclosing function/class/type and hands|
 *   |                        |                    | the model the SCOPE, not two isolated |
 *   |                        |                    | diff lines. A lone `}` tells a model   |
 *   |                        |                    | nothing.                               |
 *   | in-place marker res.   | ai-merge-resolve   | `resolveFile` rewrites in place, and  |
 *   |                        |                    | refuses to write a result that still   |
 *   |                        |                    | carries markers.                       |
 *   | virtual conflict bus   | oh-my-pi `conflict://N` | `decideHunk` returns a declarative  |
 *   |                        |                    | verdict (`ours`/`theirs`/`merged`)     |
 *   |                        |                    | instead of an untracked mutation.      |
 *   | native crate guard     | crates/tau-natives | `nativePolicy` forces ours on any       |
 *   |                        |                    | tokenization hunk. DeepSeek BPE header |
 *   |                        |                    | offsets are not recoverable by         |
 *   |                        |                    | inference — a plausible guess silently |
 *   |                        |                    | corrupts every token count afterwards. |
 *
 * RESOLUTION ORDER — most trustworthy decision first
 * --------------------------------------------------
 *   1. NATIVE POLICY GATE. `crates/tau-natives` tokenization hunks force ours.
 *      Deterministic, no model involved, cannot be argued with.
 *   2. PACKAGE VOCABULARY. Where ours says `@tau/` and upstream says
 *      `@oh-my-pi/`, ours wins — inverting it would undo the realign/replay
 *      layers that make the other 4,600 references coherent.
 *   3. INFERENCE. Everything else goes to the model WITH ITS AST SCOPE.
 *
 * Telemetry: every decision emits a length-prefixed (4-byte big-endian) JSON
 * frame to LOCAL_TELEMETRY_SOCKET. A missing socket is normal and ignored.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";

/** Where the estate telemetry collector listens. */
export const TELEMETRY_SOCKET = process.env.LOCAL_TELEMETRY_SOCKET ?? "/tmp/local_telemetry_ipc.sock";

/** The fork's own vocabulary. Upstream's is `@oh-my-pi/`. */
const OURS_SCOPE = "@tau/";
const THEIRS_SCOPE = "@oh-my-pi/";

// --------------------------------------------------------------- marker I/O --

/**
 * weave-driver's marker dialect, verified against the real binary on this host:
 *
 *   <<<<<<< ours
 *   B-ours
 *   |||||||| base
 *   b
 *   =======
 *   B-theirs
 *   >>>>>>> theirs
 *
 * `||||||| base` is woven INTO THE OURS SIDE, not a separate section. A parser
 * that only understands git's three markers silently folds the base block into
 * ours — which is why `Hunk` tracks `base` separately and the resolver drops
 * it rather than mistaking it for our own code.
 */
const OURS_MARKER = "<<<<<<< ours";
const BASE_MARKER = "||||||| base";
const MID_MARKER = "=======";
const THEIRS_MARKER = ">>>>>>> theirs";

export interface Hunk {
	/** 1-based line of the `<<<<<<<` marker. */
	line: number;
	/** 1-based line of the closing `>>>>>>>`, inclusive. */
	endLine: number;
	ours: string[];
	theirs: string[];
}

/**
 * Split a weave-driver result into its conflicted regions, or null when the
 * file carries no markers at all — the common case, where the caller has
 * nothing to do.
 */
export function parseHunks(text: string): Hunk[] | null {
	const lines = text.split("\n");
	const hunks: Hunk[] = [];

	for (let i = 0; i < lines.length; i++) {
		if (lines[i] !== OURS_MARKER) continue;
		const start = i;
		i++;
		const ours: string[] = [];
		const theirs: string[] = [];
		let side: "ours" | "theirs" = "ours";

		while (i < lines.length && lines[i] !== THEIRS_MARKER) {
			const l = lines[i];
			if (l === BASE_MARKER) {
				// Context for a human only; not a third opinion.
				while (i < lines.length && lines[i] !== MID_MARKER) i++;
				side = "theirs";
				continue;
			}
			if (l === MID_MARKER) side = "theirs";
			else if (side === "ours") ours.push(l);
			else theirs.push(l);
			i++;
		}
		hunks.push({ line: start + 1, endLine: i + 1, ours, theirs });
	}
	return hunks.length ? hunks : null;
}

/** Any conflict marker at all, including the trailing `weave:` advice comment. */
export function hasMarkers(text: string): boolean {
	return /^<{7} |^={7}$|^>{7} |^\|{7}\| base$/m.test(text);
}

// ------------------------------------------------------ AST scope harvesting --

/**
 * The enclosing declarations around a conflicted line.
 *
 * Gito issue #249's argument: a conflict hunk is a few lines of text whose
 * meaning is carried by its parent function, class, type or interface. Feeding
 * a model `}` versus `return x` teaches it nothing; feeding it the signature,
 * the doc comment, and the imports in scope lets it distinguish an intentional
 * API change from a renamed parameter.
 *
 * Deliberately syntactic and line-oriented rather than a full parse: this runs
 * over Rust, TypeScript, TOML and Markdown alike, and a file that does not
 * parse is precisely the case we most need to survive.
 */
export interface AstScope {
	/** `function foo` / `class Foo` / `struct Bar`, outermost first. */
	enclosing: string[];
	/** Leading doc comment above the innermost declaration. */
	doc: string[];
	/** Module-scope import/use lines. */
	imports: string[];
	/** 1-based inclusive start of the enclosing declaration's body. */
	start: number;
}

const IMPORT_RE =
	/^\s*(?:import\b|use\s+[\w:*{]+\b|from\s+[\w:.]+\s+import\b|require\s*\(|export\s+\*\s+from\b|use crate\b)/;

/** Opens a scope worth naming, by keyword. */
const SCOPE_RE =
	/^(\t*)(?:export\s+)?(?:default\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:function|class|interface|type|enum|trait|impl|struct|module|namespace)\b/;

export function harvestScope(text: string, targetLine: number): AstScope {
	const lines = text.split("\n");
	const enclosing: string[] = [];
	let declStart = targetLine;

	// Walk up to the nearest enclosing declarations, nearest first. A candidate
	// must START at or before the target to actually enclose it; anything
	// deeper-indented that begins after our line is a later sibling.
	for (let i = Math.min(targetLine, lines.length) - 1; i >= 0 && enclosing.length < 4; i--) {
		if (!SCOPE_RE.test(lines[i])) continue;
		enclosing.unshift(lines[i].trim());
		declStart = i + 1;
	}

	const doc: string[] = [];
	for (let i = declStart - 2; i >= 0 && doc.length < 12; i--) {
		const t = lines[i].trim();
		if (t.startsWith("/**") || t.startsWith("*/") || t.startsWith("*") || t.startsWith("//")) {
			doc.unshift(lines[i]);
		} else break;
	}

	const imports: string[] = [];
	for (let i = 0; i < lines.length && imports.length < 40; i++) {
		if (IMPORT_RE.test(lines[i])) imports.push(lines[i]);
	}

	return { enclosing, doc, imports, start: declStart };
}

/**
 * Render the scope as the prompt fragment the model actually reads. Keeping the
 * scope adjacent to the two sides is the entire point: the model must know that
 * `header_offset` lives inside a BPE vocabulary table before being asked to
 * merge a change to one of its fields.
 */
export function renderScopePrompt(rel: string, hunk: Hunk, scope: AstScope): string {
	return [
		`File: ${rel} (conflict at line ${hunk.line})`,
		scope.enclosing.length ? `Enclosing declarations: ${scope.enclosing.join(" > ")}` : null,
		scope.doc.length ? `Doc comment:\n${scope.doc.join("\n")}` : null,
		scope.imports.length ? `Imports in scope:\n${scope.imports.slice(0, 15).join("\n")}` : null,
		"",
		"OURS (this fork):",
		hunk.ours.join("\n") || "(empty)",
		"",
		"THEIRS (upstream):",
		hunk.theirs.join("\n") || "(empty)",
	]
		.filter((l): l is string => l !== null)
		.join("\n");
}

// --------------------------------------------------- tau-natives policy gate --

/**
 * Tokenization internals we refuse to let a language model resolve.
 *
 * `header_offset` is a DeepSeek BPE vocabulary fact: a byte offset into the
 * rank-ordered token table that decides where a merge stops. A model asked to
 * "reconcile" two versions of that table produces something that parses, looks
 * right, and miscounts every token for the rest of the life of the build. There
 * is no correct-by-inference answer here, only ours.
 */
const PROTECTED_TOKENS = ["header_offset", "deepseek", "openai-shared", "openai_shared"] as const;

// The native crate carries two legal spellings: `crates/tau-natives/` in the
// working tree, and `crates/pi-natives/` inside the upstream-pull staging
// tree (upstream has not renamed; see scripts/upstream-pull.ts pathRealign).
// Once path realignment lands, a conflict resolved against a staged
// `crates/pi-natives/...` path must still be forced to ours — otherwise the
// tokenizer gate is silently skipped for exactly the files it exists to
// protect. Match both.
const NATIVE_DIR = /^crates\/(?:tau|pi)-natives\//;

export function nativePolicy(rel: string, hunk: Hunk): { protected: true; reason: string } | { protected: false } {
	const hay = [...hunk.ours, ...hunk.theirs].join("\n").toLowerCase();
	for (const token of PROTECTED_TOKENS) {
		if (hay.includes(token)) return { protected: true, reason: token };
	}
	// Any non-empty hunk inside the crate is tokenizer territory: forced ours.
	if (NATIVE_DIR.test(rel)) return { protected: true, reason: "native-crate" };
	return { protected: false };
}

// ------------------------------------------------------------ vocabulary rule --

/**
 * Keep our package vocabulary when a conflict is purely about it. The realign
 * phase rewrote OUR names to upstream's so the merge saw one vocabulary, and
 * replay put ours back; a hunk still disagreeing escaped both, and preferring
 * ours is what keeps it consistent with the other 4,600 references.
 */
export function preferOursVocabulary(hunk: Hunk): boolean {
	// BOTH sides carrying their own scope IS the conflict this rule exists for:
	// ours says `@tau/tau-utils` where upstream says `@oh-my-pi/pi-utils`. Ours
	// wins, because that is the vocabulary the other 4,600 references in this
	// tree already use. A hunk with no scope disagreement is not this rule's
	// business and falls through to inference.
	return hunk.ours.some(l => l.includes(OURS_SCOPE)) && hunk.theirs.some(l => l.includes(THEIRS_SCOPE));
}

// ------------------------------------------------------------- the model lane --

export interface ModelSpec {
	baseUrl: string;
	apiKeyEnv: string;
	model: string;
	maxTokens: number;
}

/** Candidate lanes in preference order; the first that answers wins. */
export const MODEL_LANES: ModelSpec[] = [
	{ baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY", model: "qwen/qwen3.8-27b", maxTokens: 4096 },
	{ baseUrl: "https://api.openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY", model: "deepseek/deepseek-chat", maxTokens: 4096 },
];

export interface ModelAnswer {
	text: string;
	lane: ModelSpec;
}

/** Thrown when no lane can answer. Callers MUST fall back to ours, never guess. */
export class ModelUnavailableError extends Error {
	constructor(readonly detail: string) {
		super(detail);
		this.name = "ModelUnavailableError";
	}
}

const SYSTEM_PROMPT = [
	"You resolve a three-way merge conflict in a forked codebase.",
	"Output ONLY the merged text for the conflict region.",
	"Output NO conflict markers (<<<<<<<, =======, >>>>>>>, |||||||).",
	"Keep both sides' behaviour unless one plainly supersedes the other.",
	"Do not add commentary, explanation, or code fences.",
].join("\n");

/**
 * Strip fences and any markers a chatty model emits despite the prompt. A
 * resolver that hands back its own conflict markers has resolved nothing.
 */
export function sanitizeModelOutput(raw: string): string {
	const fence = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(raw.trim());
	const body = fence?.[1] ?? raw;
	return body
		.replace(/^<{7}.*$/gm, "")
		.replace(/^\|{7}\|.*$/gm, "")
		.replace(/^>{7}.*$/gm, "")
		.replace(/^={7}$/gm, "")
		.replace(/^\n+/, "")
		.replace(/\n+$/, "");
}

export async function askModel(prompt: string, timeoutMs = 60_000): Promise<ModelAnswer> {
	const failures: string[] = [];
	for (const lane of MODEL_LANES) {
		const key = process.env[lane.apiKeyEnv];
		if (!key) {
			failures.push(`${lane.model}: no ${lane.apiKeyEnv} in the environment`);
			continue;
		}
		const ac = new AbortController();
		const timer = setTimeout(() => ac.abort(), timeoutMs);
		try {
			const res = await fetch(`${lane.baseUrl}/chat/completions`, {
				method: "POST",
				headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
				body: JSON.stringify({
					model: lane.model,
					messages: [
						{ role: "system", content: SYSTEM_PROMPT },
						{ role: "user", content: prompt },
					],
					max_tokens: lane.maxTokens,
					temperature: 0,
				}),
				signal: ac.signal,
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
			const data: unknown = await res.json();
			if (!data || typeof data !== "object" || !("choices" in data)) throw new Error("no choices in response");
			const first = (data as { choices?: unknown }).choices;
			if (!Array.isArray(first) || typeof first[0] !== "object" || first[0] === null) {
				throw new Error("choices[0] is not an object");
			}
			const message = (first[0] as { message?: { content?: unknown } }).message;
			if (!message || typeof message.content !== "string" || message.content.length === 0) {
				throw new Error("no message content");
			}
			return { text: sanitizeModelOutput(message.content), lane };
		} catch (e) {
			failures.push(`${lane.model}: ${(e as Error).message}`);
		} finally {
			clearTimeout(timer);
		}
	}
	throw new ModelUnavailableError(failures.join(" | "));
}

// ----------------------------------------------------------------- telemetry --

export interface TelemetryEvent {
	event: "conflict.resolved";
	rel: string;
	line: number;
	/** Which rule decided this hunk. */
	strategy: "ours-policy" | "vocabulary" | "model";
	lane?: string;
	reason?: string;
}

/**
 * A 4-byte big-endian length followed by that many bytes of JSON.
 *
 * The prefix makes frames self-delimiting: a collector reads four bytes, then
 * exactly that many, and never guesses where a message ended.
 *
 * The transport is chosen from what the path actually IS. `LOCAL_TELEMETRY_SOCKET`
 * names a UNIX socket; the same variable pointed at a regular file is the
 * documented fallback for a host with no collector process, and `open(sock,
 * "a")` fails ENXIO on a socket, so probing with `statSync` is what keeps both
 * cases correct. Either way a stale or absent endpoint is normal and must
 * never fail a merge.
 */
export async function emitTelemetry(event: TelemetryEvent): Promise<void> {
	try {
		if (!existsSync(TELEMETRY_SOCKET)) return;
		const payload = Buffer.from(JSON.stringify(event), "utf8");
		const frame = Buffer.allocUnsafe(4 + payload.length);
		frame.writeUInt32BE(payload.length, 0);
		payload.copy(frame, 4);
		await deliver(frame);
	} catch {
		// Telemetry is best effort by definition.
	}
}

/**
 * Deliver one frame.
 *
 * A UNIX socket is opened through `Bun.file(...).writer()`, which connects to
 * the endpoint as a stream — the only unix-socket write path Bun exposes,
 * since `node:dgram` has no unix-path send and `Bun.connect` rejects an
 * unbound AF_UNIX datagram peer with ECONNREFUSED. A regular file is appended
 * to directly. Both carry the identical frame bytes.
 */
async function deliver(frame: Buffer): Promise<void> {
	if (statSync(TELEMETRY_SOCKET).isSocket()) {
		const sink = Bun.file(TELEMETRY_SOCKET).writer();
		await sink.write(frame);
		await sink.flush();
		return;
	}
	const fh = await open(TELEMETRY_SOCKET, "a");
	try {
		await fh.write(frame);
	} finally {
		await fh.close();
	}
}

// ------------------------------------------------------------- the resolver --

export type Strategy = "ours-policy" | "vocabulary" | "model";

export interface Verdict {
	choice: "ours" | "theirs" | "merged";
	text: string;
	strategy: Strategy;
	lane?: string;
}

export interface ResolveResult {
	rel: string;
	changed: boolean;
	resolved: number;
	/** Hunks still carrying markers after resolution; must be 0 to write. */
	remaining: number;
	byStrategy: Record<Strategy, number>;
}

/**
 * Decide one hunk. Rules 1 and 2 are deterministic and never consult a model;
 * only what survives both is worth a token.
 */
export async function decideHunk(
	rel: string,
	hunk: Hunk,
	sourceText: string,
	opts: { timeoutMs?: number; model?: boolean } = {},
): Promise<Verdict> {
	// RULE 1 — native crate policy gate.
	const native = nativePolicy(rel, hunk);
	if (native.protected) {
		await emitTelemetry({ event: "conflict.resolved", rel, line: hunk.line, strategy: "ours-policy", reason: native.reason });
		return { choice: "ours", text: hunk.ours.join("\n"), strategy: "ours-policy" };
	}

	// RULE 2 — package vocabulary stays ours.
	if (preferOursVocabulary(hunk)) {
		await emitTelemetry({ event: "conflict.resolved", rel, line: hunk.line, strategy: "vocabulary" });
		return { choice: "ours", text: hunk.ours.join("\n"), strategy: "vocabulary" };
	}

	// RULE 3 — inference, WITH the enclosing AST scope.
	if (opts.model === false) {
		return { choice: "ours", text: hunk.ours.join("\n"), strategy: "ours-policy" };
	}
	try {
		const answer = await askModel(renderScopePrompt(rel, hunk, harvestScope(sourceText, hunk.line)), opts.timeoutMs);
		await emitTelemetry({ event: "conflict.resolved", rel, line: hunk.line, strategy: "model", lane: answer.lane.model });

		// A model that merely ECHOES one side has added nothing, and its echo
		// loses the original's leading indentation. Comparing normalized text
		// catches the echo while letting a genuine synthesis through, and it
		// hands back the side byte-for-byte rather than the model's paraphrase.
		const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
		if (norm(answer.text) === norm(hunk.ours.join("\n")))
			return { choice: "ours", text: hunk.ours.join("\n"), strategy: "model", lane: answer.lane.model };
		if (norm(answer.text) === norm(hunk.theirs.join("\n")))
			return { choice: "theirs", text: hunk.theirs.join("\n"), strategy: "model", lane: answer.lane.model };

		return { choice: "merged", text: answer.text, strategy: "model", lane: answer.lane.model };
	} catch (e) {
		// A dead model lane is not a licence to invent a merge. Ours is the only
		// side we can justify without inference.
		await emitTelemetry({
			event: "conflict.resolved",
			rel,
			line: hunk.line,
			strategy: "ours-policy",
			reason: (e as Error).message.slice(0, 120),
		});
		return { choice: "ours", text: hunk.ours.join("\n"), strategy: "ours-policy" };
	}
}

/**
 * Resolve every marker in one file, writing it back only when the result is
 * actually clean. A file that still carries markers is left untouched so a
 * human sees the real conflict rather than a lossy "resolution".
 */
export async function resolveFile(
	rel: string,
	absPath: string,
	opts: { timeoutMs?: number; model?: boolean } = {},
): Promise<ResolveResult> {
	const original = readFileSync(absPath, "utf8");
	const hunks = parseHunks(original);
	const byStrategy: Record<Strategy, number> = { "ours-policy": 0, vocabulary: 0, model: 0 };
	if (!hunks) return { rel, changed: false, resolved: 0, remaining: 0, byStrategy };

	const lines = original.split("\n");
	const rebuilt: string[] = [];
	let cursor = 0;

	for (const hunk of hunks) {
		for (let i = cursor; i < hunk.line - 1; i++) rebuilt.push(lines[i]);
		const verdict = await decideHunk(rel, hunk, original, opts);
		byStrategy[verdict.strategy]++;
		rebuilt.push(...verdict.text.split("\n"));
		cursor = hunk.endLine;
	}
	for (let i = cursor; i < lines.length; i++) rebuilt.push(lines[i]);

	const merged = rebuilt.join("\n");
	const out = original.endsWith("\n") === merged.endsWith("\n") ? merged : `${merged}\n`;
	const remaining = (out.match(/^<{7} ours$|^={7}$|^>{7} theirs$/gm) ?? []).length;

	if (remaining === 0 && out !== original) writeFileSync(absPath, out);
	return { rel, changed: remaining === 0 && out !== original, resolved: hunks.length, remaining, byStrategy };
}
