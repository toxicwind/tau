/**
 * upstream/search-approval-targets.ts — can1357/oh-my-pi's approval cache-target
 * derivation for search tools, ported so `GrepTool.approvalCacheTargets` exists
 * in-tree (upstream contract test parity).
 *
 * Ported from upstream main @ 83de60ad99:
 *   - tools/search-approval-targets.ts (whole module)
 *   - tools/approval-targets.ts        (approvalTargetKey / approvalTreeSearchKey /
 *                                       isApprovalPublicUrl — key shape only)
 *   - tools/approval-cache.ts          (approvalCacheKeyForPath /
 *                                       approvalDirectoryKey — path→key only;
 *                                       the SQLite store is fork-absent by design:
 *                                       fork runs always-ask|write|yolo, not
 *                                       always-ask-cached)
 *
 * The fork consumes these keys observationally (tool contract + tests); wiring
 * them into a persistent grant store stays an upstream-mode follow-up.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { isReadableUrlPath } from "@tau/tau-tui/tools/read";
import { InternalUrlRouter } from "../internal-urls/router";
import { normalizePathLikeInput, resolveToCwd } from "../tools/path-utils";

/** Key prefix for a recursive search of a tree: opaque, so no folder or file grant matches it. */
const APPROVAL_TREE_SEARCH_PREFIX = "tree\0";

/** Cache key for a filesystem target: absolute, symlinks resolved, case-folded on Windows. */
export function approvalCacheKeyForPath(target: string): string {
	const resolved = path.resolve(target);
	try {
		// Through the deepest existing ancestor for a path that does not exist yet.
		const real = fs.realpathSync(resolved);
		return process.platform === "win32" ? real.toLowerCase() : real;
	} catch {
		// Walk up to the deepest existing ancestor and append the missing tail.
		let missing = "";
		let dir = resolved;
		for (;;) {
			const parent = path.dirname(dir);
			if (parent === dir) break;
			missing = `/${path.basename(dir)}${missing}`;
			dir = parent;
			try {
				const real = fs.realpathSync(dir);
				const joined = `${real}${missing}`;
				return process.platform === "win32" ? joined.toLowerCase() : joined;
			} catch {
				continue;
			}
		}
		return process.platform === "win32" ? resolved.toLowerCase() : resolved;
	}
}

/** Cache key for a directory grant: {@link approvalCacheKeyForPath} plus a trailing separator. */
export function approvalDirectoryKey(directory: string): string {
	const key = approvalCacheKeyForPath(directory);
	return key.endsWith(path.sep) ? key : `${key}${path.sep}`;
}

/** Cache key for a recursive search of a tree rooted at `directoryKey`. */
export function approvalTreeSearchKey(directoryKey: string): string {
	return `${APPROVAL_TREE_SEARCH_PREFIX}${directoryKey}`;
}

/** The folder key a tree key was minted from, or `undefined` when the key is not a tree key. */
export function approvalTreeSearchFolderKey(key: string): string | undefined {
	return key.startsWith(APPROVAL_TREE_SEARCH_PREFIX) ? key.slice(APPROVAL_TREE_SEARCH_PREFIX.length) : undefined;
}

/** Whether a readable URL's host is public, so Ask and remember can leave it ungated. */
export function isApprovalPublicUrl(url: string): boolean {
	let host: string;
	try {
		host = new URL(url).hostname.toLowerCase();
	} catch {
		try {
			host = new URL(`https://${url}`).hostname.toLowerCase();
		} catch {
			return false;
		}
	}
	if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
	return host !== "localhost" && !/^127\./.test(host) && host !== "::1" && !host.endsWith(".local");
}

/**
 * Cache key derivation for `always-ask-cached` grants. Shared by every
 * path-based tool so one approved target maps to one key: a filesystem path
 * resolved against the session cwd, a registered internal URL (`xd://`,
 * `local://`, …) kept in its normalized form, or a readable web URL kept as
 * written. `undefined` for a blank target.
 */
export function approvalTargetKey(cwd: string, target: string): string | undefined {
	const trimmed = target.trim();
	if (trimmed.length === 0) return undefined;
	const router = InternalUrlRouter.instance();
	if (router.canHandle(trimmed)) return trimmed;
	if (isReadableUrlPath(trimmed)) return trimmed;
	try {
		return approvalCacheKeyForPath(resolveToCwd(target, cwd));
	} catch {
		return undefined;
	}
}

/** List delimiters the execution-side path parser splits a root on. */
export const APPROVAL_ROOT_DELIMITERS = /[;,\s]+/;

/**
 * Roots to key for one raw entry: the entry itself plus its list parts. Execution
 * fans `a;b`, `a,b` and whitespace lists out, so a key minted only from the
 * unsplit string would miss every path the search really walks — and a search
 * that reports no keys is auto-allowed. Parts that do not resolve are dropped by
 * the key derivation, so naming them here can only add keys that really exist.
 */
export function approvalRootCandidates(rawRoot: string): string[] {
	const parts = rawRoot.split(APPROVAL_ROOT_DELIMITERS).filter(part => part.length > 0);
	return parts.length <= 1 ? [rawRoot] : [rawRoot, ...parts];
}

/**
 * One cache key for a resolution-ready search root: a file reports the file key
 * a `read` of it would mint, a folder reports the folder key a folder grant
 * covers, a folder walked recursively reports its tree key, and a registered
 * internal URL keeps its normalized form. `undefined` for anything else — a
 * public web URL, or a root that does not resolve or does not exist.
 */
function searchRootApprovalKey(root: string, cwd: string, recursive: boolean): string | undefined {
	if (root.length === 0) return undefined;
	if (isReadableUrlPath(root)) {
		// A public page is ungated like a public read; a private host is gated like a file.
		return isApprovalPublicUrl(root) ? undefined : approvalTargetKey(cwd, root);
	}
	const router = InternalUrlRouter.instance();
	if (router.canHandle(root)) return approvalTargetKey(cwd, root);
	let absolute: string;
	try {
		absolute = resolveToCwd(root, cwd);
	} catch {
		// resolveToCwd rejects unknown URL schemes; there is no filesystem target to key.
		return undefined;
	}
	try {
		if (!fs.statSync(absolute).isDirectory()) return approvalTargetKey(cwd, root);
		const directoryKey = approvalDirectoryKey(absolute);
		return recursive ? approvalTreeSearchKey(directoryKey) : directoryKey;
	} catch {
		// The search of a path that does not exist finds nothing and errors out;
		// nothing about it is worth remembering.
		return undefined;
	}
}

/**
 * Approval-cache keys for one search call, or `undefined` when no root resolves
 * to anything rememberable.
 *
 * `splitBase` is the calling tool's own root parser ({@link parseSearchPath}-shaped
 * for grep), so a glob root reports the folder the tool actually walks instead of
 * the pattern. `isRecursive` says whether that root is walked below its subfolders
 * (grep always is); such a root reports a tree key instead of the folder key.
 * Nothing here expands a glob, materializes an archive member, or walks a
 * directory: each root costs at most one `statSync`. An omitted `path` makes the
 * tool search the session cwd, so that folder is reported too; a supplied root
 * that resolves to nothing contributes no key.
 */
export function searchApprovalCacheTargets(
	roots: readonly string[],
	cwd: string,
	splitBase: (root: string) => string,
	isRecursive: (root: string) => boolean = () => true,
	skipCandidate?: (candidate: string, wholeList: boolean) => boolean,
): readonly string[] | undefined {
	const keys = new Set<string>();
	// Both tools search `.` when no path argument was supplied, so the fallback
	// root below is the folder the call really runs in.
	for (const rawRoot of roots.length > 0 ? roots : ["."]) {
		const root = normalizePathLikeInput(rawRoot);
		if (root.length === 0) continue;
		const candidates = approvalRootCandidates(root);
		for (const [index, candidate] of candidates.entries()) {
			// A caller's own list syntax (grep's `!glob` exclusions) names parts that search nothing.
			if (skipCandidate?.(candidate, candidates.length > 1 && index === 0)) continue;
			const base = normalizePathLikeInput(splitBase(candidate));
			const key = searchRootApprovalKey(base, cwd, isRecursive(candidate));
			if (key !== undefined) keys.add(key);
		}
	}
	return keys.size > 0 ? [...keys] : undefined;
}
