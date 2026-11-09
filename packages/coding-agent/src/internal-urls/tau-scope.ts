/**
<<<<<<< ours — interstitial `file_header` (T+F, confidence: medium)
// refused_by: merge_ladder_exhausted · collision: `* Shared grammar for `omp://` docs scopes.` +1 more
 * Shared grammar for `tau://` docs scopes.
 *
 * Three callers need the same answers — the `tau://` handler (what doc does
 * this URL name?), `grep`'s virtual-resource expansion (does this path mean
 * every doc?), and `find`'s temp corpus (which docs do we materialize?) — so
 * the scope grammar lives here once instead of being re-derived per caller.
=======
 * Shared grammar for `omp://` docs scopes: which doc a URL names, and the
 * whole embedded corpus for the docs root (the handler's `enumerate`).
>>>>>>> theirs — interstitial `file_header` (T+F, confidence: medium) · weave: run 'weave explain packages/coding-agent/src/internal-urls/tau-scope.ts' for per-hunk detail, 'weave check' to verify your resolution
 */
import * as path from "node:path";
import { getDocFilenames, getEmbeddedDoc } from "./docs-index";
import type { InternalUrl, ResolveContext } from "./types";

/** `tau://` prefix, case-insensitive: addresses harness docs instead of the filesystem. */
const TAU_DOCS_RE = /^tau:\/\//i;
/** Root scope: `tau://`, `tau:///`, `tau://docs`, `tau://docs/`. */
const TAU_DOCS_ROOT_RE = /^tau:\/\/(?:\/?|docs\/?)$/i;

<<<<<<< ours — function `isOmpDocsScope` (S+F, confidence: low)
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
/** Whether `input` addresses harness docs instead of the filesystem. */
export function isOmpDocsScope(input: string): boolean {
	return TAU_DOCS_RE.test(input.trim());
}
=======
>>>>>>> theirs — function `isOmpDocsScope` (S+F, confidence: low)
<<<<<<< ours — function `isOmpDocsRoot` (S+F, confidence: low)
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
/** Whether `input` is the docs root (every doc) rather than a single-doc URL. */
export function isOmpDocsRoot(input: string): boolean {
	return TAU_DOCS_ROOT_RE.test(input.trim());
}
=======
>>>>>>> theirs — function `isOmpDocsRoot` (S+F, confidence: low)

/** Host + path of an `tau://` URL, exactly as the handler reads it; `""` when the URL names the docs root. */
export function tauDocFilename(url: InternalUrl): string {
	const host = url.rawHost || url.hostname;
	const pathname = url.rawPathname ?? url.pathname;
	return host ? (pathname && pathname !== "/" ? host + pathname : host) : "";
}

/**
 * Canonical doc path relative to `docs/` for an `tau://` URL, or `""` for the
 * docs root (`tau://`, `tau:///`, `tau://docs`, `tau://docs/`). Throws on
 * absolute paths and `..` traversal — the rejections the handler reports.
 */
export function tauDocRel(url: InternalUrl): string {
	const filename = tauDocFilename(url);
	if (filename.length === 0) return "";
	if (path.isAbsolute(filename)) throw new Error("Absolute paths are not allowed in tau:// URLs");
	const normalized = path.posix.normalize(filename.replaceAll("\\", "/"));
	if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
		throw new Error("Path traversal (..) is not allowed in tau:// URLs");
	}
	if (normalized === "." || normalized === "docs") return "";
	return normalized.startsWith("docs/") ? normalized.slice("docs/".length) : normalized;
}

<<<<<<< ours — interface `OmpDocEntry` (T+S+F, confidence: low)
// refused_by: rename_vs_edit_guard · collision: `export interface OmpDocEntry {`
/** One embedded doc of a `tau://` root scope. */
export interface TauDocEntry {
	/** Canonical `tau://<rel>` URL. */
	url: string;
	/** Doc path relative to `docs/`. */
	rel: string;
=======
/** One embedded doc of a `omp://` root scope. */
interface OmpDocEntry {
	/** Canonical `omp://<rel>` URL. */
	url: string;
>>>>>>> theirs — interface `OmpDocEntry` (T+S+F, confidence: low)
	/** Doc text. */
	content: string;
}

/**
<<<<<<< ours — function `ompDocsScopeEntries` (S+F, confidence: low)
// refused_by: rename_vs_edit_guard · collision: `const completions = (await router.complete("omp", "")) ?? [];` +1 more
 * Every embedded doc for a root scope, one entry per unique completion in
 * completion order. Empty when no docs corpus is reachable.
 */
export async function tauDocsScopeEntries(context?: ResolveContext): Promise<TauDocEntry[]> {
	const router = InternalUrlRouter.instance();
	const completions = (await router.complete("tau", "")) ?? [];
	const entries: TauDocEntry[] = [];
	const seen = new Set<string>();
	for (const completion of completions) {
		const rel = completion.value;
		if (rel.length === 0 || seen.has(rel)) continue;
		seen.add(rel);
		context?.signal?.throwIfAborted();
		const url = `tau://${rel}`;
		entries.push({ url, rel, content: (await router.resolve(url, context)).content });
=======
 * Every embedded doc for a root scope, in docs-index (sorted) order. Empty
 * when no docs corpus is reachable.
 */
export async function ompDocsScopeEntries(context?: ResolveContext): Promise<OmpDocEntry[]> {
	const entries: OmpDocEntry[] = [];
	for (const rel of getDocFilenames()) {
		context?.signal?.throwIfAborted();
		const content = await getEmbeddedDoc(rel);
		if (content === undefined) continue;
		entries.push({ url: `omp://${rel}`, content });
>>>>>>> theirs — function `ompDocsScopeEntries` (S+F, confidence: low)
	}
	return entries;
}
