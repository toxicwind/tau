/**
 * Path realignment for the upstream pull.
 *
 * The fork renamed `pi` to `tau` at the path level as well as inside file
 * contents, so a merge cannot compare `crates/pi-natives` (upstream) with
 * `crates/tau-natives` (ours). This module derives that directory map from
 * git's own rename records in the fork commit, so a moved directory becomes
 * one operation instead of one per file.
 *
 * Why git's records rather than string substitution: the rename is not a
 * prefix rule. `mnemopi` -> `mnemotau`, `omptype` -> `tautype` and `pi-vcs` ->
 * `tau-vcs` share no prefix and differ in length. Git's rename detection
 * already resolved this against file content; re-deriving it with regexes can
 * only do worse.
 *
 * A pair needs votes from at least `MIN_DIR_SUPPORT` files before it is
 * trusted. A single file that moved is far more likely to be a one-off than a
 * directory rename, and a wrong directory map silently swallows a subtree.
 */

/** One `R<score>\t<from>\t<to>` line from `git diff --name-status -M`. */
export interface RenameRecord {
	from: string;
	to: string;
}

/**
 * A file that moved is evidence about the directory that contains it. Below
 * this many independent files, a directory rename is not distinguishable from
 * coincidental per-file churn.
 */
export const MIN_DIR_SUPPORT = 3;

/**
 * Destination directories that a vote can legitimately land in but that must
 * never receive merged source.
 *
 * This fork's rename commit was a bulk find-and-replace, and it caught a few
 * paths nobody meant to move: `packages/catalog/.../providers/*.kdl` ended up
 * in `.patch_backup_20261004_234728/`. Git reports those as ordinary renames
 * with a perfect similarity score, so the vote cannot tell them apart from a
 * real one. Realigning upstream's live rules into a backup directory would
 * move working source out of the build, so those destinations are refused.
 */
const ARTIFACT_DIR_RE = /(?:^|\/)(?:\.patch_backup[^/]*|\.git|node_modules|target|dist|\.tau-staging)(?:\/|$)/;

/**
 * A move whose destination is inside its own source cannot be performed.
 *
 * `git rename docs docs/upstream` is a legitimate reorganization — upstream
 * docs were quarantined into a subdirectory — but replaying it as a
 * filesystem rename is `rename(2)` on a directory into its own subtree,
 * which fails EINVAL on Linux and EBUSY elsewhere. Such a pair is a
 * reorganization rather than a rename, so it is left out of the map and its
 * files stay under the path upstream gave them.
 */
const nestedInSelf = (from: string, to: string): boolean => to === from || to.startsWith(`${from}/`);

const normalize = (rel: string): string => rel.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");

const parentDir = (rel: string): string => {
	const segments = normalize(rel).split("/");
	segments.pop(); // the filename itself is not part of its directory
	return segments.join("/");
};

/**
 * Parse the rename subset of `git diff --name-status -M` output.
 *
 * Non-rename rows (`A`, `M`, `D`) are ignored rather than rejected: the same
 * invocation emits them and the caller has already accounted for them.
 */
export function parseRenameRecords(stdout: string): RenameRecord[] {
	const out: RenameRecord[] = [];
	for (const line of stdout.split("\n")) {
		if (!line.startsWith("R")) continue;
		const parts = line.split("\t");
		if (parts.length < 3 || parts[0].length < 2) continue;
		out.push({ from: normalize(parts[1]!), to: normalize(parts[2]!) });
	}
	return out;
}

/**
 * Roll per-file rename records up into directory pairs.
 *
 * `records` come from `git diff --name-status -M <upstream> <ours>`, so each
 * one reads (upstream path, our path) and the resulting map is keyed
 * upstream -> ours. Callers that need the other direction invert it.
 *
 * A source directory that maps to two different destinations has ambiguous
 * evidence and is dropped: guessing wrong there loses a whole subtree, and a
 * lost subtree is indistinguishable from "upstream had nothing to say".
 */
export function derivePathMap(records: RenameRecord[]): Record<string, string> {
	const votes = new Map<string, Map<string, number>>();
	for (const { from, to } of records) {
		const fromDir = parentDir(from);
		const toDir = parentDir(to);
		if (fromDir === toDir) continue;
		const targets = votes.get(fromDir) ?? new Map<string, number>();
		targets.set(toDir, (targets.get(toDir) ?? 0) + 1);
		votes.set(fromDir, targets);
	}

	const map: Record<string, string> = {};
	for (const [fromDir, targets] of votes) {
		const ranked = [...targets].sort((a, b) => b[1] - a[1]);
		const [winner, support] = ranked[0]!;
		if (support < MIN_DIR_SUPPORT) continue;
		if (ranked[1] && ranked[1][1] === support) continue; // tied: ambiguous
		if (nestedInSelf(fromDir, winner)) continue;
		map[fromDir] = winner;
	}

	// Collapse to minimal pairs: when both `crates/pi-edit` and
	// `crates/pi-edit/src` moved, the parent entry alone already covers the
	// child. A child is dropped only when the parent's mapping already
	// produces its own, so a genuine divergence is never lost.
	const prefixes = Object.keys(map).sort((a, b) => b.length - a.length);
	const minimal = prefixes
		.filter(from => !ARTIFACT_DIR_RE.test(map[from]!))
		.filter(
			from =>
				!prefixes.some(
					other =>
						other !== from &&
						from.startsWith(`${other}/`) &&
						realignPath(from, { [other]: map[other]! }) === map[from],
				),
		)
		.map(from => [from, map[from]!] as const);

	// Lift a set of consistent children into their parent. A crate whose only
	// manifest is `Cargo.toml` never forms a directory-level vote of its own —
	// git reports renames for `crates/pi-edit/src/...` but for no file
	// directly in `crates/pi-edit/` — so without this the crate root is left
	// behind under its upstream spelling and the merge writes a second,
	// half-empty copy of it beside ours.
	const lifted: Record<string, string> = {};
	for (const [from, to] of minimal) {
		const parentFrom = from.slice(0, from.lastIndexOf("/"));
		const parentTo = to.slice(0, to.lastIndexOf("/"));
		// A parent that renames to itself (`crates` -> `crates`) carries no
		// rename; lifting it would add an identity pair that matches every
		// path and realigns nothing.
		if (!parentFrom || !parentTo || parentFrom === parentTo) continue;
		if (map[parentFrom]) continue; // the parent already has its own vote
		if (lifted[parentFrom]) {
			if (lifted[parentFrom] !== parentTo) delete lifted[parentFrom]; // siblings disagree
			continue;
		}
		lifted[parentFrom] = parentTo;
	}
	return { ...lifted, ...Object.fromEntries(minimal) };
}

/**
 * Apply the directory map to one path, longest prefix first so a nested rename
 * (`crates/pi-natives` inside some `crates/pi-*`) cannot be half consumed by a
 * shorter sibling entry.
 */
export function realignPath(rel: string, map: Record<string, string>): string {
	const norm = normalize(rel);
	for (const [from, to] of Object.entries(map).sort((a, b) => b[0].length - a[0].length)) {
		if (norm === from) return to;
		if (norm.startsWith(`${from}/`)) return `${to}/${norm.slice(from.length + 1)}`;
	}
	return norm;
}
