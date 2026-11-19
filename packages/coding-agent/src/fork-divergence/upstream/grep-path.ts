/**
 * upstream/grep-path.ts — can1357/oh-my-pi's `!glob` exclusion semantics,
 * ported verbatim from upstream main (their grep.ts lines 465-530 + path-utils
 * `isExclusionPart`) so it compiles inside the tau tree.
 *
 * This is the A/B side of `forkDivergence.grepExclusions`:
 *   - upstream: `!foo` in a path list = ripgrep-style exclusion glob; a
 *     `!foo` that IS a real file (or an inconclusive probe) stays a literal
 *     path so real files named `!notes.txt` keep working.
 *   - fork:     everything is a literal include path.
 *
 * Sources (upstream main @ 83de60ad99):
 *   - packages/coding-agent/src/tools/grep.ts   (isExclusionEntry /
 *     normalizeExclusion / anchoredExclusionPath / relativeInside /
 *     exclusionsForRoot / searchApprovalCacheTargets shape)
 *   - packages/coding-agent/src/tools/path-utils.ts (isExclusionPart)
 */
import * as path from "node:path";
import {
	probeLiteralPathExistsSync,
	resolveToCwd,
	splitPathAndSelPreferringLiteralSync,
} from "../../tools/path-utils";
import { splitPathAndSel } from "@tau/tau-tui/tools/read";
import { InternalUrlRouter } from "../../internal-urls/router";

/**
 * Whether a path entry is a `!glob` exclusion rather than a path to search: it
 * starts with `!` and is confirmed missing on disk once a `:selector` is split
 * off the way `read` splits it, so `!notes.txt:1-2` still reads a real
 * `!notes.txt`, and a dangling `!link` or an inconclusive probe stays a path
 * whose error the search reports. Approval and execution both classify entries
 * through this.
 */
export function isExclusionEntry(entry: string, cwd: string): boolean {
	if (!entry.startsWith("!")) return false;
	return probeLiteralPathExistsSync(splitPathAndSelPreferringLiteralSync(entry, cwd).path, cwd) === "missing";
}

/** A `!glob` exclusion part of a path list, which search tools take beside URLs. */
export function isExclusionPart(part: string): boolean {
	return part.length > 1 && part.startsWith("!") && !part.includes("://");
}

/** One exclusion with Windows separators and trailing separators normalized away. */
export function normalizeExclusion(pattern: string): string {
	return pattern.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Where an anchored exclusion points: one with a `/` that does not start with
 * `**`, resolved against cwd like any tool path. `undefined` for a pattern that
 * matches at any depth, `null` for one that resolves to no filesystem path.
 */
export function anchoredExclusionPath(pattern: string, cwd: string): string | null | undefined {
	if (!pattern.includes("/") || pattern.startsWith("**")) return undefined;
	try {
		return resolveToCwd(pattern, cwd);
	} catch {
		return null;
	}
}

/** `target` relative to `root` with `/` separators, or `undefined` unless it lies strictly inside `root`. */
export function relativeInside(root: string, target: string): string | undefined {
	const relative = path.relative(root, target);
	// Across Windows drives `path.relative` returns an absolute path.
	if (relative === "" || path.isAbsolute(relative)) return undefined;
	const posix = relative.split(path.sep).join("/");
	return posix === ".." || posix.startsWith("../") ? undefined : posix;
}

/**
 * Rebase `!glob` exclusions, written relative to cwd, onto one search root for
 * native grep, which matches them against root-relative paths. A pattern with
 * no `/` (or starting with `**`) matches at any depth and passes through; any
 * other is anchored to the root with a leading `/` (`!./gen` must not drop
 * `sub/gen`); one naming a place outside this root has nothing to exclude there.
 */
export function exclusionsForRoot(patterns: readonly string[], cwd: string, root: string): string[] | undefined {
	const rebased: string[] = [];
	const internalRoot = InternalUrlRouter.instance().canHandle(root);
	for (const raw of patterns) {
		const pattern = normalizeExclusion(raw);
		if (!pattern) continue;
		const target = anchoredExclusionPath(pattern, cwd);
		if (target === undefined) {
			rebased.push(pattern);
			continue;
		}
		if (internalRoot || target === null) continue;
		const relative = relativeInside(root, target);
		if (relative !== undefined) rebased.push(`/${relative}`);
	}
	return rebased.length > 0 ? rebased : undefined;
}

/**
 * Upstream grep-path semantics as the seam contract:
 * split a raw `;`-delimited path list into includes + `!glob` exclusions.
 * A `!` entry that names a real file (selector-aware) is a literal include —
 * exactly `isExclusionEntry`'s rule.
 */
export const grepPathSemantics = {
	name: "upstream-exclusion" as const,
	split(raw: string, cwd: string): { includes: string[]; excludes: string[] } {
		const parts = raw.split(";").map(p => p.trim()).filter(Boolean);
		const includes: string[] = [];
		const excludes: string[] = [];
		for (const part of parts) {
			if (isExclusionPart(part) && isExclusionEntry(part, cwd)) excludes.push(part);
			else includes.push(part);
		}
		return { includes, excludes };
	},
};
