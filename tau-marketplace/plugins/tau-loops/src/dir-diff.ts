import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Two-tree diff with a consumer census.
 *
 * Built because "which of these two directories is the real one" kept
 * needing the same three answers: what exists only in A, what exists only
 * in B, and who actually references either. The third is the one that
 * decides whether anything can be deleted.
 */

const DEFAULT_IGNORED_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	".svelte-kit",
	"coverage",
	".next",
	".turbo",
]);

const DEFAULT_IGNORED_FILES = new Set([
	".DS_Store",
	"bun.lock",
	"bun.lockb",
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"tsconfig.tsbuildinfo",
]);

export type FileEntry = { relPath: string; sha: string; size: number };

export type TreeDiff = {
	onlyInLeft: string[];
	onlyInRight: string[];
	differing: string[];
	identical: string[];
};

function sha256(contents: string): string {
	return createHash("sha256").update(contents).digest("hex");
}

function listTree(
	root: string,
	ignoreDirs: ReadonlySet<string>,
	ignoreFiles: ReadonlySet<string>,
): FileEntry[] {
	const entries: FileEntry[] = [];
	const walk = (dir: string): void => {
		for (const dirent of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, dirent.name);
			if (dirent.isDirectory()) {
				if (ignoreDirs.has(dirent.name)) continue;
				walk(full);
			} else if (dirent.isFile()) {
				if (ignoreFiles.has(dirent.name)) continue;
				const contents = readFileSync(full, "utf8");
				entries.push({
					relPath: relative(root, full).split("\\").join("/"),
					sha: sha256(contents),
					size: contents.length,
				});
			}
		}
	};
	walk(root);
	entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
	return entries;
}

export function diffTrees(
	leftRoot: string,
	rightRoot: string,
	options: { ignoreDirs?: ReadonlySet<string>; ignoreFiles?: ReadonlySet<string> } = {},
): TreeDiff {
	for (const root of [leftRoot, rightRoot]) {
		if (!existsSync(root)) throw new Error(`dir-diff: not a directory: ${root}`);
	}
	const ignoreDirs = options.ignoreDirs ?? DEFAULT_IGNORED_DIRS;
	const ignoreFiles = options.ignoreFiles ?? DEFAULT_IGNORED_FILES;
	const left = new Map(listTree(leftRoot, ignoreDirs, ignoreFiles).map((e) => [e.relPath, e]));
	const right = new Map(listTree(rightRoot, ignoreDirs, ignoreFiles).map((e) => [e.relPath, e]));

	const onlyInLeft: string[] = [];
	const onlyInRight: string[] = [];
	const differing: string[] = [];
	const identical: string[] = [];

	for (const [relPath, entry] of left) {
		const other = right.get(relPath);
		if (!other) onlyInLeft.push(relPath);
		else if (other.sha !== entry.sha) differing.push(relPath);
		else identical.push(relPath);
	}
	for (const relPath of right.keys()) {
		if (!left.has(relPath)) onlyInRight.push(relPath);
	}
	return { onlyInLeft, onlyInRight, differing, identical };
}

export type ConsumerHit = { file: string; line: number; text: string };

export type CensusOptions = {
	searchRoot: string;
	/** Directory names that are never searched. */
	ignoreDirs?: ReadonlySet<string>;
	/** Literal substrings identifying the target, e.g. ["herd/ui", "ui-svelte"]. */
	needles: string[];
	maxHitsPerNeedle?: number;
};

/**
 * Grep a whole tree for references to the directories under comparison.
 * A directory with no hits outside itself has no consumers and is dead.
 */
export function censusConsumers(options: CensusOptions): Map<string, ConsumerHit[]> {
	const hits = new Map<string, ConsumerHit[]>(options.needles.map((n) => [n, []]));
	const ignoreDirs = options.ignoreDirs ?? DEFAULT_IGNORED_DIRS;
	const perNeedle = options.maxHitsPerNeedle ?? 40;

	const walk = (dir: string): void => {
		for (const dirent of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, dirent.name);
			if (dirent.isDirectory()) {
				if (ignoreDirs.has(dirent.name)) continue;
				walk(full);
			} else if (dirent.isFile()) {
				let contents: string;
				try {
					contents = readFileSync(full, "utf8");
				} catch {
					continue;
				}
				const lines = contents.split("\n");
				for (const needle of options.needles) {
					const bucket = hits.get(needle);
					if (bucket === undefined || bucket.length >= perNeedle) continue;
					lines.forEach((text, index) => {
						if (bucket.length >= perNeedle) return;
						if (text.includes(needle)) {
							bucket.push({
								file: relative(options.searchRoot, full),
								line: index + 1,
								text: text.trim().slice(0, 200),
							});
						}
					});
				}
			}
		}
	};
	walk(options.searchRoot);
	return hits;
}

export function formatDiff(diff: TreeDiff): string {
	return [
		`identical: ${diff.identical.length}`,
		`differing: ${diff.differing.length}`,
		`only in left:  ${diff.onlyInLeft.length}`,
		`only in right: ${diff.onlyInRight.length}`,
	].join("  |  ");
}

export function formatCensus(hits: Map<string, ConsumerHit[]>): string {
	const lines: string[] = [];
	for (const [needle, found] of hits) {
		lines.push(`"${needle}": ${found.length === 0 ? "NO CONSUMERS (dead)" : `${found.length} hit(s)`}`);
		for (const hit of found.slice(0, 12)) {
			lines.push(`    ${hit.file}:${hit.line}  ${hit.text}`);
		}
		if (found.length > 12) lines.push(`    ... ${found.length - 12} more`);
	}
	return lines.join("\n");
}

export function resolveDir(explicit: string): string {
	const full = resolve(explicit);
	if (!existsSync(full)) throw new Error(`dir-diff: not a directory: ${full}`);
	return full;
}
