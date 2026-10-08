#!/usr/bin/env bun

/**
 * Resolve residual merge conflicts in a tree.
 *
 * This is the pass the DoD invokes between `upstream-pull.ts --apply` and the
 * build. It finds files still carrying conflict markers, hands each to
 * `TauAIConflictResolver`'s rule chain, and refuses to claim success while any
 * marker survives.
 *
 *   bun scripts/resolve-conflicts.ts                 # scan the working tree
 *   bun scripts/resolve-conflicts.ts <dir>           # scan a staged tree
 *   bun scripts/resolve-conflicts.ts --no-model      # policy rules only
 *   bun scripts/resolve-conflicts.ts --check         # report, change nothing
 *
 * Exit code is 0 only when nothing carries a marker afterwards. A file whose
 * hunks cannot be resolved cleanly is left BYTE-IDENTICAL — writing a lossy
 * "resolution" would hide a real conflict behind a clean-looking tree.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { hasMarkers, resolveFile, TELEMETRY_SOCKET, type Strategy } from "./ai-conflict-resolver.ts";

const REPO_ROOT = join(import.meta.dir, "..");

/** Directories that never contain mergeable source. */
const SKIP_DIRS = new Set([
	".git", "node_modules", "dist", "build", "target", ".jj", ".next", "coverage", "vendor", ".turbo", ".cache",
]);

/** Only these can carry weave markers worth resolving. */
const TEXT_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|toml|ya?ml|md|sh|ps1|nix|txt|rs|py|go|css|html|sql|proto)$/;

function walk(root: string, out: string[] = []): string[] {
	for (const entry of readdirSync(root)) {
		if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
		const full = join(root, entry);
		let st;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (st.isDirectory()) walk(full, out);
		else if (TEXT_EXT.test(entry) && st.size < 8 * 1024 * 1024) out.push(full);
	}
	return out;
}

interface Options {
	root: string;
	model: boolean;
	check: boolean;
}

function parseArgs(argv: string[]): Options {
	const o: Options = { root: REPO_ROOT, model: true, check: false };
	for (const a of argv) {
		if (a === "--no-model") o.model = false;
		else if (a === "--check") o.check = true;
		else if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
		// `resolve`, not `join`: `join` would turn an absolute argument into
		// cwd-relative and hunt for the tree under the repo.
		else o.root = resolve(a);
	}
	return o;
}

async function main(): Promise<number> {
	const opts = parseArgs(process.argv.slice(2));
	if (!existsSync(opts.root)) throw new Error(`no such tree: ${opts.root}`);

	const candidates = walk(opts.root).filter(p => hasMarkers(readFileSync(p, "utf8")));

	console.log(`\nConflict resolution pass`);
	console.log(`  tree       ${opts.root}`);
	console.log(`  candidates ${candidates.length}`);
	console.log(`  model      ${opts.model ? "enabled" : "disabled (policy rules only)"}`);
	console.log(`  telemetry  ${existsSync(TELEMETRY_SOCKET) ? TELEMETRY_SOCKET : "absent — telemetry skipped"}`);

	if (candidates.length === 0) {
		console.log(`\n  \x1b[32mno conflict markers\x1b[0m — nothing to resolve`);
		return 0;
	}

	const totals: Record<Strategy, number> = { "ours-policy": 0, vocabulary: 0, model: 0 };
	let cleaned = 0;
	const unresolved: string[] = [];

	for (const abs of candidates) {
		const fromRepo = relative(REPO_ROOT, abs);
		const rel = fromRepo && !fromRepo.startsWith("..") ? fromRepo : relative(opts.root, abs);
		if (opts.check) {
			const hunkCount = (readFileSync(abs, "utf8").match(/^<{7} ours$/gm) ?? []).length;
			console.log(`\n  ${rel}\n      ${hunkCount} hunk(s) — not resolving (--check)`);
			continue;
		}

		const r = await resolveFile(rel, abs, { model: opts.model });
		for (const k of Object.keys(totals) as Strategy[]) totals[k] += r.byStrategy[k];

		if (r.remaining > 0) {
			unresolved.push(rel);
			console.log(`\n  \x1b[31mUNRESOLVED\x1b[0m ${rel}\n      ${r.resolved} hunk(s) attempted, ${r.remaining} still carry markers — left byte-identical`);
		} else if (r.changed) {
			cleaned++;
			const breakdown = (Object.keys(r.byStrategy) as Strategy[])
				.filter(k => r.byStrategy[k] > 0)
				.map(k => `${r.byStrategy[k]} ${k}`)
				.join(", ");
			console.log(`\n  \x1b[32mresolved\x1b[0m ${rel}\n      ${r.resolved} hunk(s): ${breakdown}`);
		} else {
			console.log(`\n  \x1b[33munchanged\x1b[0m ${rel}\n      ${r.resolved} hunk(s) resolved to exactly the current content`);
		}
	}

	if (opts.check) {
		console.log(`\n  ${candidates.length} file(s) carry conflict markers`);
		return 1;
	}

	console.log(`\n  cleaned ${cleaned} of ${candidates.length}`);
	console.log(
		`  by strategy: ${totals["ours-policy"]} native-policy, ` +
			`${totals.vocabulary} vocabulary, ${totals.model} model`,
	);

	if (unresolved.length) {
		console.log(`\n  \x1b[31m${unresolved.length} file(s) still conflicted\x1b[0m — these need a human:`);
		for (const u of unresolved) console.log(`    ${u}`);
		return 1;
	}
	console.log(`\n  \x1b[32mall conflict markers resolved\x1b[0m`);
	return 0;
}

process.exit(await main());
