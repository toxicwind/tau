/**
 * Shared grammar for `tau://` docs scopes.
 *
 * Three callers need the same answers — the `tau://` handler (what doc does
 * this URL name?), `grep`'s virtual-resource expansion (does this path mean
 * every doc?), and `find`'s temp corpus (which docs do we materialize?) — so
 * the scope grammar lives here once instead of being re-derived per caller.
 */
import * as path from "node:path";
import { InternalUrlRouter } from "./router";
import type { InternalUrl, ResolveContext } from "./types";

/** `tau://` prefix, case-insensitive: addresses harness docs instead of the filesystem. */
const TAU_DOCS_RE = /^tau:\/\//i;
/** Root scope: `tau://`, `tau:///`, `tau://docs`, `tau://docs/`. */
const TAU_DOCS_ROOT_RE = /^tau:\/\/(?:\/?|docs\/?)$/i;

/** Whether `input` addresses harness docs instead of the filesystem. */
export function isOmpDocsScope(input: string): boolean {
	return TAU_DOCS_RE.test(input.trim());
}

/** Whether `input` is the docs root (every doc) rather than a single-doc URL. */
export function isOmpDocsRoot(input: string): boolean {
	return TAU_DOCS_ROOT_RE.test(input.trim());
}

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

/** One embedded doc of a `tau://` root scope. */
export interface TauDocEntry {
	/** Canonical `tau://<rel>` URL. */
	url: string;
	/** Doc path relative to `docs/`. */
	rel: string;
	/** Doc text. */
	content: string;
}

/**
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
	}
	return entries;
}
