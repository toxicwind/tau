#!/usr/bin/env bun

/**
 * Pull upstream (can1357/tau) into this fork without a git merge.
 *
 * WHY NOT `git merge upstream/main`
 * ---------------------------------
 * This fork was created by squashing upstream into a single commit
 * (`141e270e2c Initial commit: Tau 18.3.0 monorepo`). `git merge-base
 * upstream/main HEAD` is therefore EMPTY — the histories are unrelated — so a
 * merge would treat every file as an add/add conflict, and weave's git-driven
 * commands reject it outright:
 *
 *   $ weave preview upstream/main
 *   Error: no merge base between 'HEAD' and 'upstream/main'
 *
 * The content gap is nothing like the commit gap. Upstream's real bump points
 * run `dacdef24a3` (18.3.0) -> `608ac7360f` (18.3.3): a few days of work, not
 * 25000 commits. The fork point is a *version* fact, not an ancestry fact, so
 * this script recovers it from upstream's version-bump history.
 *
 * THE FOUR LAYERS, AND WHY EACH ONE IS THERE
 * ------------------------------------------
 * 1. REALIGN / REPLAY. A renamed package is a repository-wide refactoring, and
 *    refactorings obscure semantic correspondence: upstream still says
 *    `@tau/tau-coding-agent` in 1137 imports while our tree says `tau`, so
 *    a merge engine sees a conflict on every one of those lines even though
 *    both sides mean the same thing. Ogenrwot & Businge measure this exact
 *    failure mode on divergent forks — "Git cherry-pick fails in 64.4% of cases
 *    due to structural misalignments" (arXiv:2508.06718) — and their fix is to
 *    invert the refactoring on both sides to realign the patch context, apply,
 *    then replay the transformation to preserve the fork's intent. So this
 *    script rewrites OUR names back to upstream's in the staging copy, merges,
 *    then replays ours forward. The rename becomes invisible to the merge.
 *
 * 2. WEAVE + SUTURE, per path, cheapest correct tool:
 *      - suture  "do these exact bytes still describe this file?" A
 *        length-preserving byte patch carrying a blake3 digest of its source.
 *        On a file that has not drifted it is byte-exact and verified; on one
 *        that has drifted it is REFUSED ("refusing to apply incompatible
 *        patch"). It cannot corrupt our work.
 *      - weave   "both sides changed this, so what should the result be?" An
 *        entity-level (property, function, class) three-way merge, ancestry free
 *        at its core: `weave-driver <base> <ours> <theirs>` merges three files
 *        that share no git history.
 *      Split: upstream untouched -> keep ours; we untouched -> suture;
 *      both touched -> weave; workspace manifest -> weave always.
 *
 * 3. MANIFEST COHERENCE. A manifest can merge *cleanly* and still leave the
 *    workspace broken, because each side is a perfectly good JSON document on
 *    its own. That is exactly how this repo ended up with
 *    `@tau/tau-coding-agent` deleted from the catalog while 1137 files
 *    still import it, and with two consumers on `file:` specs that make bun
 *    COPY the sources so TypeScript loads coding-agent twice as two distinct
 *    modules. No text merge sees that. The coherence pass does.
 *
 * 4. CORRECTNESS GATES. "No conflict markers" is a weak criterion, and Mori &
 *    Hashimoto (arXiv:2607.07987, ASE 2025) show why: measured over 43,774 file
 *    merge scenarios, existing tools including git return results that are
 *    neither *parsable* nor *universal*. They require a merge result to be
 *    parsable (valid per the language grammar) and universal (it carries ALL
 *    and ONLY each branch's edits, with edits common to both applied EXACTLY
 *    ONCE). So this script gates on all three:
 *      - parsable:   parse every merged file.
 *      - universal:  ours' deletions survive, theirs' additions survive, and no
 *                     edit common to both is applied twice.
 *      - idempotent: re-merge the result against the same theirs; a tool that
 *                     drifts on the second pass is not safe to run twice.
 *    The universality check is a line-multiset screen. It is deliberately
 *    conservative: it is tuned to never miss a dropped edit, so it may report
 *    a case a human clears in five seconds. Findings go to a review list, not
 *    to the exit code's hot path.
 *
 * Usage:
 *   bun scripts/upstream-pull.ts                  # dry run: plan, gates, conflicts
 *   bun scripts/upstream-pull.ts --base <rev>     # override the detected fork point
 *   bun scripts/upstream-pull.ts --manifests      # only the manifest coherence pass
 *   bun scripts/upstream-pull.ts --record-base    # pin the detected fork point
 *   bun scripts/upstream-pull.ts --no-gates       # skip the correctness gates
 *   bun scripts/upstream-pull.ts --apply          # write the result into the working tree
 */

import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const SYNC_RECORD = join(REPO_ROOT, ".upstream-sync.json");
const UPSTREAM_REMOTE = "upstream";
const UPSTREAM_BRANCH = "main";
const FORK_ROOT_SUBJECT = "Initial commit: Tau";
/** Non-code files that always take the semantic path. See the header. */
const MANIFEST_RE = /(^|\/)(package\.json|tsconfig[^/]*\.json|Cargo\.toml|pyproject\.toml)$/;
/** Extensions a rename can legitimately rewrite. */
const TEXT_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|toml|ya?ml|md|sh|ps1|nix|txt)$/;
/** How many findings each gate prints before summarizing the rest. */
const REPORT_LIMIT = 25;

// ------------------------------------------------------------------ plumbing --

function run(
	cmd: string,
	args: string[],
	opts: { cwd?: string } = {},
): { status: number; stdout: string; stderr: string } {
	const r = spawnSync(cmd, args, { cwd: opts.cwd ?? REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
	return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function git(args: string[], opts: { allowFail?: boolean } = {}): string {
	const r = run("git", args);
	if (r.status !== 0) {
		if (opts.allowFail) return "";
		throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
	}
	return r.stdout;
}

let quiet = false;
const log = (m: string): void => {
	if (!quiet) process.stdout.write(`${m}\n`);
};
const warn = (m: string): void => {
	process.stderr.write(`${m}\n`);
};
const heading = (m: string): void => {
	log(`\n\x1b[1m${m}\x1b[0m`);
};

function which(candidates: string[], probe: string[]): string | null {
	for (const p of candidates) {
		if (!p || !existsSync(p)) continue;
		if (run(p, probe).status === 0) return p;
	}
	return null;
}

const homeBin = (name: string): string => join(process.env.HOME ?? "", ".cargo/bin", name);

// ------------------------------------------------------------------ fork point --

interface SyncRecord {
	/** Upstream commit this fork was cut from. */
	base: string;
	/** Upstream version at `base`, for humans. */
	baseVersion: string;
	/** Upstream tip this record was written against. */
	theirs: string;
	/** ISO date the record was written. */
	recordedAt: string;
	/** Extra renames to realign, ours -> upstream, beyond the derived ones. */
	renames?: Record<string, string>;
}

/**
 * The version lives in the coding-agent manifest, not the root one: upstream's
 * root package.json has no `version` field at all.
 */
function upstreamVersionAt(rev: string): string {
	for (const path of ["packages/coding-agent/package.json", "package.json"]) {
		const raw = git(["show", `${rev}:${path}`], { allowFail: true });
		if (!raw) continue;
		try {
			const v = (JSON.parse(raw) as { version?: string }).version;
			if (v) return v;
		} catch {
			return "unparseable";
		}
	}
	return "unknown";
}

/**
 * Recover the fork point from upstream's version-bump history.
 *
 * The root commit is a squash, so its date is the only link to upstream's
 * timeline. Upstream bumps the version in commits titled "chore: bump version
 * to X", so the newest such bump at or before the fork date is the release
 * this fork was cut from.
 */
function detectBase(): string {
	const root = git(["rev-list", "--max-parents=0", "HEAD"]).trim().split("\n")[0];
	if (!root) throw new Error("could not find this fork's root commit");
	const forkDate = git(["log", "-1", "--format=%cI", root]).trim();
	const subject = git(["log", "-1", "--format=%s", root]).trim();
	if (!subject.startsWith(FORK_ROOT_SUBJECT))
		log(`note: root commit "${subject}" is not a recognizable squash import`);
	const bump = git([
		"log",
		`${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`,
		`--before=${forkDate}`,
		"-1",
		"--format=%H",
		"--grep=^chore: bump version to",
		"-E",
	]).trim();
	if (!bump) {
		throw new Error(
			`no upstream version bump at or before the fork date (${forkDate}).\n` +
				`Pass the fork point explicitly:  bun scripts/upstream-pull.ts --base <rev>`,
		);
	}
	return bump;
}

function loadRecord(): SyncRecord | null {
	if (!existsSync(SYNC_RECORD)) return null;
	try {
		return JSON.parse(readFileSync(SYNC_RECORD, "utf8")) as SyncRecord;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------- tree export --

function exportTree(rev: string, dest: string): void {
	mkdirSync(dest, { recursive: true });
	const r = run("sh", ["-c", `git archive --format=tar ${JSON.stringify(rev)} | tar -x -C ${JSON.stringify(dest)}`]);
	if (r.status !== 0) throw new Error(`git archive ${rev} failed: ${r.stderr.trim()}`);
}

const at = (...segs: string[]): string => join(...segs);
const has = (root: string, rel: string): boolean => existsSync(at(root, rel));

function isBinary(root: string, rel: string): boolean {
	try {
		return readFileSync(at(root, rel)).subarray(0, 8000).includes(0);
	} catch {
		return false;
	}
}

const sameBytes = (x: string, y: string): boolean => {
	try {
		return readFileSync(x).equals(readFileSync(y));
	} catch {
		return false;
	}
};

// ------------------------------------------------------------ realign / replay --

/**
 * Rewrite one identifier across a staging tree, longest name first so that
 * `tau/tools` is never half-consumed by a shorter sibling name.
 */
function rewriteTree(root: string, rels: string[], map: Record<string, string>): number {
	const pairs = Object.entries(map).sort((a, b) => b[0].length - a[0].length);
	if (pairs.length === 0) return 0;
	let touched = 0;
	for (const rel of rels) {
		if (!TEXT_RE.test(rel)) continue;
		const p = at(root, rel);
		if (!existsSync(p) || isBinary(root, rel)) continue;
		const before = readFileSync(p, "utf8");
		let after = before;
		for (const [from, to] of pairs) after = after.split(from).join(to);
		if (after === before) continue;
		writeFileSync(p, after);
		touched++;
	}
	return touched;
}

/**
 * Derive ours -> upstream identifier renames by comparing member names across
 * the fork point. This is how `tau` is discovered as the upstream name
 * `@tau/tau-coding-agent` without anyone maintaining the list.
 */
function deriveRenames(baseRoot: string, oursRoot: string): Record<string, string> {
	const names = (root: string): Record<string, string> => {
		const out: Record<string, string> = {};
		const dir = join(root, "packages");
		if (!existsSync(dir)) return out;
		for (const entry of readdirSync(dir)) {
			const p = join(dir, entry, "package.json");
			if (!existsSync(p)) continue;
			try {
				const name = (JSON.parse(readFileSync(p, "utf8")) as { name?: string }).name;
				if (name) out[entry] = name;
			} catch {
				/* an unparseable manifest is reported by the coherence pass */
			}
		}
		return out;
	};
	const theirs = names(baseRoot);
	const ours = names(oursRoot);
	const map: Record<string, string> = {};
	for (const [dir, oursName] of Object.entries(ours)) {
		const theirsName = theirs[dir];
		if (theirsName && theirsName !== oursName) map[oursName] = theirsName;
	}
	return map;
}

const invert = (m: Record<string, string>): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const [from, to] of Object.entries(m)) out[to] = from;
	return out;
};

// ----------------------------------------------------------------- the merge --

type PathKind = "keep-ours" | "upstream-only" | "deleted-upstream" | "suture" | "weave" | "binary" | "conflict";

interface Outcome {
	rel: string;
	kind: PathKind;
	detail?: string;
}

/** weave leaves standard git conflict markers; they are the authority on residue. */
const CONFLICT_RE = /^(<{7} |={7}\r?$|>{7} )/m;

interface Engines {
	weave: string;
	suture: string | null;
}

function classify(stage: string, rel: string): PathKind {
	const inBase = has(at(stage, "base"), rel);
	const inOurs = has(at(stage, "ours"), rel);
	const inTheirs = has(at(stage, "theirs"), rel);
	if (!inTheirs) return "deleted-upstream";
	if (!inOurs) return inBase ? "deleted-upstream" : "upstream-only";
	if (isBinary(at(stage, "ours"), rel) || isBinary(at(stage, "theirs"), rel)) return "binary";
	if (sameBytes(at(stage, "base"), at(stage, "ours")) || !inBase) return "upstream-only";
	if (sameBytes(at(stage, "base"), at(stage, "theirs"))) return "keep-ours";
	// A manifest is a dependency graph. Whether our rename and their catalog
	// bump agree is not a byte question, so never take the fast path here.
	return MANIFEST_RE.test(rel) ? "weave" : "suture";
}

/**
 * The path kind actually taken on THIS host.
 *
 * `classify` picks the fast path from the tree's shape alone, but availability
 * is a property of the host. Without suture every changed path falls back to
 * the entity merge — slower, and correct. Both the merge and the idempotence
 * gate resolve the kind through here, so they can never disagree about which
 * engine produced a file.
 */
function effectiveKind(engines: Engines, stage: string, rel: string): PathKind {
	const classified = classify(stage, rel);
	return classified === "suture" && !engines.suture ? "weave" : classified;
}

function mergeOne(engines: Engines, stage: string, rel: string, outDir: string): Outcome {
	const kind = effectiveKind(engines, stage, rel);
	const ours = at(stage, "ours", rel);
	const theirs = at(stage, "theirs", rel);
	const out = at(outDir, rel);

	switch (kind) {
		case "deleted-upstream":
		case "keep-ours":
			return { rel, kind };
		case "upstream-only":
		case "binary": {
			mkdirSync(dirname(out), { recursive: true });
			if (has(at(stage, "theirs"), rel)) copyFileSync(theirs, out);
			return { rel, kind };
		}
		case "suture": {
			// Only reached when OURS == BASE, so the digest is guaranteed to
			// match and the patch is a byte-exact replay of upstream's edit.
			const patch = join(outDir, `.patches/${rel}.patch`);
			mkdirSync(dirname(patch), { recursive: true });
			const d = run(engines.suture!, ["diff", at(stage, "base", rel), theirs, "-o", patch]);
			if (d.status !== 0) return { rel, kind: "conflict", detail: `suture diff failed: ${d.stderr.trim()}` };
			const a = run(engines.suture!, ["apply", patch, ours, "-o", out]);
			if (a.status !== 0) return { rel, kind: "conflict", detail: `suture apply refused: ${a.stderr.trim()}` };
			return { rel, kind };
		}
		case "weave": {
			const base = has(at(stage, "base"), rel) ? at(stage, "base", rel) : writeTempEmpty(stage);
			mkdirSync(dirname(out), { recursive: true });
			const r = run(engines.weave, [base, ours, theirs, "-o", out, "-l", "7", "-p", rel]);
			if (!existsSync(out)) return { rel, kind: "conflict", detail: `weave produced no output: ${r.stderr.trim()}` };
			if (CONFLICT_RE.test(readFileSync(out, "utf8"))) {
				const note = r.stderr
					.split("\n")
					.filter(l => /refus|conflict|both modified/i.test(l))
					.slice(0, 2)
					.join("; ");
				return { rel, kind: "conflict", detail: note || undefined };
			}
			return { rel, kind };
		}
	}
}

function writeTempEmpty(stage: string): string {
	const p = join(stage, "empty-base");
	if (!existsSync(p)) writeFileSync(p, "");
	return p;
}

// -------------------------------------------------- manifest coherence pass --

interface ManifestIssue {
	file: string;
	problem: string;
	detail: string;
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

interface Manifest {
	name?: string;
	version?: string;
	workspaces?: string[] | { packages?: string[]; catalog?: Record<string, string> };
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/**
 * Validate that a tree's manifests agree with each other.
 *
 * Every issue here is invisible to a textual merge, because each side is a
 * valid JSON document alone. They only break once the pieces are read together.
 */
function checkManifestCoherence(root: string): ManifestIssue[] {
	const issues: ManifestIssue[] = [];
	const add = (file: string, problem: string, detail: string): void => void issues.push({ file, problem, detail });

	const readManifest = (rel: string): Manifest | null => {
		const p = join(root, rel);
		if (!existsSync(p)) return null;
		try {
			return JSON.parse(readFileSync(p, "utf8")) as Manifest;
		} catch (e) {
			add(rel, "unparseable manifest", (e as Error).message);
			return null;
		}
	};

	const rootManifest = readManifest("package.json");
	if (!rootManifest) return issues;
	const ws = rootManifest.workspaces;
	const catalog = (Array.isArray(ws) ? {} : (ws?.catalog ?? {})) as Record<string, string>;
	const patterns = Array.isArray(ws) ? ws : (ws?.packages ?? []);

	const members: { rel: string; name: string }[] = [];
	for (const pattern of patterns) {
		const star = pattern.indexOf("*");
		if (star < 0) {
			const rel = pattern.replace(/\/$/, "");
			const m = readManifest(`${rel}/package.json`);
			if (m?.name) members.push({ rel: `${rel}/package.json`, name: m.name });
			continue;
		}
		const dir = pattern.slice(0, star).replace(/\/$/, "");
		const suffix = pattern.slice(star + 1);
		if (!existsSync(join(root, dir))) continue;
		for (const entry of readdirSync(join(root, dir))) {
			if (!entry.endsWith(suffix)) continue;
			const rel = `${dir}/${entry}/package.json`;
			const m = readManifest(rel);
			if (m?.name) members.push({ rel, name: m.name });
		}
	}
	const names = new Set(members.map(m => m.name));
	const manifestOf = (rel: string): Manifest | undefined => readManifest(rel) ?? undefined;

	// 1. A catalog entry in the workspace's OWN namespace with no member to
	//    satisfy it. The catalog legitimately holds third-party pins
	//    (@babel/parser, @opentelemetry/api), so "not a workspace member"
	//    proves nothing on its own — it is only wrong once you look for the
	//    package it claims to version in a scope the workspace itself owns.
	const ownScopes = new Set<string>();
	for (const n of names) {
		const i = n.lastIndexOf("/");
		if (i > 0) ownScopes.add(n.slice(0, i));
	}
	for (const [pkg, range] of Object.entries(catalog)) {
		if (names.has(pkg)) continue;
		if (!ownScopes.has(pkg.slice(0, pkg.lastIndexOf("/") + 1))) continue;
		const users = members.filter(m => DEP_FIELDS.some(f => manifestOf(m.rel)?.[f]?.[pkg] === "catalog:"));
		add(
			"package.json",
			"catalog entry in the workspace scope with no matching member",
			`catalog["${pkg}"] = "${range}", but no workspace member is named "${pkg}"` +
				(users.length
					? `; still requested via catalog: by ${users.map(u => u.rel).join(", ")}`
					: "; nothing requests it via catalog:"),
		);
	}

	for (const m of members) {
		const man = manifestOf(m.rel);
		if (!man) continue;

		// 1b. The mirror image: a dependency asking for `catalog:` with no entry
		//     to resolve against. That is a hard install failure, not a warning.
		for (const field of DEP_FIELDS) {
			for (const [dep, spec] of Object.entries(man[field] ?? {})) {
				if (spec !== "catalog:" || dep in catalog) continue;
				add(
					m.rel,
					`"${field}.${dep}" asks for catalog: with no catalog entry`,
					`"${dep}": "catalog:" but package.json has no catalog["${dep}"]`,
				);
			}
		}

		// 2. A path spec aimed at another workspace member makes the package
		//    manager materialize a SECOND physical copy, so TypeScript loads
		//    the same source twice as two distinct modules and every nominal
		//    type crossing the boundary fails ("Property '#nextId' refers to a
		//    different member"). `link:` fails outright when the names disagree.
		for (const field of DEP_FIELDS) {
			for (const [dep, spec] of Object.entries(man[field] ?? {})) {
				if (typeof spec !== "string" || !/^(file|link|portal):/.test(spec)) continue;
				const target = join(root, dirname(m.rel), spec.replace(/^(file|link|portal):/, ""));
				if (!existsSync(join(target, "package.json"))) continue;
				let targetName: string | undefined;
				try {
					targetName = (JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as { name?: string }).name;
				} catch {
					continue;
				}
				if (!targetName || !names.has(targetName)) continue;
				add(
					m.rel,
					`"${field}.${dep}" bypasses the workspace`,
					`"${spec}" resolves to workspace member "${targetName}", but a path spec makes the package manager copy it ` +
						`rather than link it — use "catalog:" so the workspace links it`,
				);
			}
		}

		// 3. `catalog:` ranges cannot resolve against a non-semver version, and a
		//    stamped build string ("tau/main-18.3.0-...") is not one.
		if (man.version && !SEMVER_RE.test(man.version)) {
			add(m.rel, "non-semver version", `"version": "${man.version}" — catalog: ranges cannot resolve against it`);
		}
	}

	return issues;
}

function reportManifests(issues: ManifestIssue[]): void {
	if (issues.length === 0) {
		log("  \x1b[32mclean\x1b[0m — catalog, dependency specs and versions all agree");
		return;
	}
	for (const i of issues) log(`  \x1b[33m${i.file}\x1b[0m  ${i.problem}\n      ${i.detail}`);
	log(`\n  ${issues.length} manifest issue(s)`);
}

// ------------------------------------------------------ correctness gates ---

interface Finding {
	gate: "parsable" | "universal" | "idempotent";
	rel: string;
	problem: string;
}

const snippet = (line: string): string => `\`${line.trim().slice(0, 72)}\``;

/** Multiset line difference, as counts so repeated lines are not conflated. */
function lineDelta(from: string[], to: string[]): { removed: string[]; added: string[] } {
	const count = (xs: string[]): Map<string, number> => {
		const m = new Map<string, number>();
		for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
		return m;
	};
	const a = count(from);
	const b = count(to);
	const removed: string[] = [];
	const added: string[] = [];
	for (const [k, n] of a) {
		const d = n - (b.get(k) ?? 0);
		for (let i = 0; i < d; i++) removed.push(k);
	}
	for (const [k, n] of b) {
		const d = n - (a.get(k) ?? 0);
		for (let i = 0; i < d; i++) added.push(k);
	}
	return { removed, added };
}

const lines = (p: string): string[] => readFileSync(p, "utf8").split("\n");

/** GATE: parsable. A merge result must be valid per the language grammar. */
function gateParsable(rel: string, mergedPath: string): Finding | null {
	const text = readFileSync(mergedPath, "utf8");
	try {
		if (rel.endsWith(".json")) {
			JSON.parse(text);
		} else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(rel)) {
			new Bun.Transpiler({ loader: rel.endsWith("x") ? "tsx" : "ts" }).transformSync(text);
		}
	} catch (e) {
		return { gate: "parsable", rel, problem: `merged result does not parse: ${(e as Error).message.split("\n")[0]}` };
	}
	return null;
}

/**
 * GATE: universal. The result must carry all and only each branch's edits, with
 * an edit common to both applied exactly once (arXiv:2607.07987).
 *
 * Line-granularity and deliberately conservative. Each rule is stated so that
 * it only fires when NEITHER side had an opinion, which makes a firing a real
 * defect signal rather than a legitimate both-sides-edit case:
 *   - theirs' addition is gone, and ours never contained it  -> dropped edit
 *   - ours' deletion is back, and theirs kept the line        -> lost edit
 *   - a line both sides added occurs twice in the result      -> double-apply
 */
function gateUniversal(
	rel: string,
	basePath: string | null,
	oursPath: string,
	theirsPath: string,
	mergedPath: string,
): Finding[] {
	if (!basePath) return [];
	const b = lines(basePath);
	const o = lines(oursPath);
	const t = lines(theirsPath);
	const m = lines(mergedPath);
	const oursDelta = lineDelta(b, o);
	const theirsDelta = lineDelta(b, t);
	const mergedCount = new Map<string, number>();
	for (const l of m) mergedCount.set(l, (mergedCount.get(l) ?? 0) + 1);
	const oursHas = new Set(o);
	const theirsHas = new Set(t);
	const findings: Finding[] = [];

	for (const line of theirsDelta.added) {
		if (theirsHas.has(line) && !oursHas.has(line) && (mergedCount.get(line) ?? 0) === 0) {
			findings.push({
				gate: "universal",
				rel,
				problem: `upstream added ${snippet(line)} and our side never had it, but it is absent from the merge`,
			});
		}
	}
	for (const line of oursDelta.removed) {
		if (theirsHas.has(line) && (mergedCount.get(line) ?? 0) > 0) {
			findings.push({
				gate: "universal",
				rel,
				problem: `we deleted ${snippet(line)}, upstream kept it, yet the merge restored it`,
			});
		}
	}
	const oursAdded = new Set(oursDelta.added);
	for (const line of theirsDelta.added) {
		if (!oursAdded.has(line)) continue;
		if ((mergedCount.get(line) ?? 0) > 1) {
			findings.push({
				gate: "universal",
				rel,
				problem: `${snippet(line)} was added by both sides and occurs ${mergedCount.get(line)} times — a shared edit applied more than once`,
			});
		}
	}
	return findings;
}

/** GATE: idempotent. Re-merge against the same theirs; the result must not drift. */
function gateIdempotent(
	engines: Engines,
	stage: string,
	rel: string,
	mergedPath: string,
	scratch: string,
): Finding | null {
	// Only the entity merge is re-runnable, and only when it is the engine that
	// actually produced this file — see `effectiveKind`.
	if (effectiveKind(engines, stage, rel) !== "weave") return null;
	const again = join(scratch, rel);
	mkdirSync(dirname(again), { recursive: true });
	const r = run(engines.weave, [
		at(stage, "base", rel),
		mergedPath,
		at(stage, "theirs", rel),
		"-o",
		again,
		"-l",
		"7",
		"-p",
		rel,
	]);
	if (r.status !== 0 || !existsSync(again))
		return { gate: "idempotent", rel, problem: "second merge pass failed outright" };
	if (!sameBytes(again, mergedPath)) {
		return {
			gate: "idempotent",
			rel,
			problem: "re-merging the result against the same upstream changes it again — the merge is not stable",
		};
	}
	return null;
}

function reportFindings(findings: Finding[]): void {
	const byGate: Record<string, Finding[]> = { parsable: [], universal: [], idempotent: [] };
	for (const f of findings) byGate[f.gate].push(f);
	for (const [gate, list] of Object.entries(byGate)) {
		if (list.length === 0) {
			log(`  \x1b[32mpass\x1b[0m  ${gate}`);
			continue;
		}
		log(`  \x1b[31m${String(list.length).padStart(4)}\x1b[0m  ${gate}`);
		for (const f of list.slice(0, REPORT_LIMIT)) log(`          ${f.rel}\n            ${f.problem}`);
		if (list.length > REPORT_LIMIT) log(`          … and ${list.length - REPORT_LIMIT} more`);
	}
}

// ---------------------------------------------------------------------- main --

interface Options {
	base?: string;
	apply: boolean;
	manifestsOnly: boolean;
	recordBase: boolean;
	gates: boolean;
}

function parseArgs(argv: string[]): Options {
	const o: Options = { apply: false, manifestsOnly: false, recordBase: false, gates: true };
	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--base": {
				const v = argv[++i];
				if (v === undefined) throw new Error("--base needs a revision");
				o.base = v;
				break;
			}
			case "--apply":
				o.apply = true;
				break;
			case "--manifests":
				o.manifestsOnly = true;
				break;
			case "--record-base":
				o.recordBase = true;
				break;
			case "--no-gates":
				o.gates = false;
				break;
			case "--quiet":
				quiet = true;
				break;
			default:
				throw new Error(`unknown flag: ${argv[i]}`);
		}
	}
	return o;
}

function main(): number {
	const opts = parseArgs(process.argv.slice(2));

	run("git", ["fetch", UPSTREAM_REMOTE, "--quiet"]);
	const theirs = git(["rev-parse", `${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`]).trim();
	const ours = git(["rev-parse", "HEAD"]).trim();
	const recorded = loadRecord();
	const base = opts.base ?? recorded?.base ?? detectBase();
	const shared = git(["merge-base", theirs, "HEAD"], { allowFail: true }).trim();

	heading("Upstream pull plan");
	log(`  base    ${base}   (upstream ${upstreamVersionAt(base)})`);
	log(`  ours    ${ours}`);
	log(`  theirs  ${theirs}   (upstream ${upstreamVersionAt(theirs)})`);
	log(
		`  ancestry ${shared ? `shared (${shared.slice(0, 10)})` : "UNRELATED — git merge impossible, entity merge in use"}`,
	);
	if (!recorded && !opts.base)
		log("  note    fork point detected, not pinned — pass --record-base to make later pulls deterministic");

	if (opts.recordBase) {
		const rec: SyncRecord = {
			base,
			baseVersion: upstreamVersionAt(base),
			theirs,
			recordedAt: new Date().toISOString(),
		};
		writeFileSync(SYNC_RECORD, `${JSON.stringify(rec, null, "\t")}\n`);
		log(`\nrecorded fork point -> ${relative(REPO_ROOT, SYNC_RECORD)}`);
		return 0;
	}

	// Always run this: the tree that has to be coherent is the one on disk, and
	// it costs one directory walk.
	heading("Manifest coherence (package.json first class)");
	const before = checkManifestCoherence(REPO_ROOT);
	reportManifests(before);
	if (opts.manifestsOnly) return before.length ? 1 : 0;

	const engines: Engines = {
		weave: which(["/usr/bin/weave-driver", homeBin("weave-driver")], ["--version"]) ?? "",
		suture: which([homeBin("suture"), "/usr/bin/suture"], ["--version"]),
	};
	if (!engines.weave)
		throw new Error("no working weave driver found (tried /usr/bin/weave-driver and ~/.cargo/bin/weave-driver)");
	if (!engines.suture)
		warn("note: suture not found — the fast path is unavailable, every changed path falls back to weave");
	log(`\n  engines: weave ${engines.weave}${engines.suture ? ` | suture ${engines.suture}` : " | suture (missing)"}`);

	const stage = mkdtempSync(join(tmpdir(), "weave-pull-"));
	const outDir = join(stage, "merged");
	const scratch = join(stage, "remerged");
	let code = 0;
	try {
		heading("Exporting trees");
		for (const [name, rev] of [
			["base", base],
			["ours", ours],
			["theirs", theirs],
		] as const) {
			exportTree(rev, at(stage, name));
			log(`  ${name.padEnd(7)} ${rev.slice(0, 10)}`);
		}
		mkdirSync(outDir, { recursive: true });

		const changed = new Set<string>();
		for (const [a, b] of [
			[base, ours],
			[base, theirs],
		] as const) {
			for (const line of git(["diff", "--name-only", a, b]).split("\n")) if (line) changed.add(line);
		}
		const targets = [...changed].filter(p => !p.startsWith("node_modules/")).sort();
		log(`\n  ${targets.length} path(s) differ from the fork point`);

		// ---- layer 1: realign our renames so the merge sees one vocabulary ----
		const renames = { ...deriveRenames(at(stage, "base"), at(stage, "ours")), ...recorded?.renames };
		heading("Realign (invert our renames so the merge sees one vocabulary)");
		if (Object.keys(renames).length === 0) {
			log("  no renames detected — merging as-is");
		} else {
			for (const [oursName, theirsName] of Object.entries(renames)) log(`  ${oursName}  ->  ${theirsName}`);
			const n = rewriteTree(at(stage, "ours"), targets, renames);
			log(`  realigned ${n} of our file(s); ours and upstream now speak the same names`);
		}

		heading("Merge");
		const outcomes: Outcome[] = [];
		for (const rel of targets) outcomes.push(mergeOne(engines, stage, rel, outDir));

		const counts: Partial<Record<PathKind, number>> = {};
		for (const o of outcomes) counts[o.kind] = (counts[o.kind] ?? 0) + 1;
		const label: Record<PathKind, string> = {
			suture: "suture  (digest-verified fast path)",
			weave: "weave   (entity merge, both sides changed)",
			conflict: "CONFLICT",
			"keep-ours": "ours    (upstream untouched)",
			"upstream-only": "upstream (added, or we never touched it)",
			"deleted-upstream": "deleted upstream",
			binary: "binary  (upstream bytes)",
		};
		for (const k of [
			"suture",
			"weave",
			"upstream-only",
			"keep-ours",
			"binary",
			"deleted-upstream",
			"conflict",
		] as PathKind[]) {
			if (counts[k]) log(`  ${String(counts[k]).padStart(5)}  ${label[k]}`);
		}

		// Gates run in the realigned vocabulary, which is the space weave
		// actually merged in and the only space where the sides are comparable.
		if (opts.gates) {
			heading("Correctness gates (parsable + universal + idempotent)");
			mkdirSync(scratch, { recursive: true });
			const findings: Finding[] = [];
			for (const o of outcomes) {
				if (o.kind === "conflict" || o.kind === "deleted-upstream") continue;
				const merged = at(outDir, o.rel);
				if (!existsSync(merged)) continue;
				const p = gateParsable(o.rel, merged);
				if (p) findings.push(p);
				findings.push(
					...gateUniversal(
						o.rel,
						has(at(stage, "base"), o.rel) ? at(stage, "base", o.rel) : null,
						at(stage, "ours", o.rel),
						at(stage, "theirs", o.rel),
						merged,
					),
				);
				const i = gateIdempotent(engines, stage, o.rel, merged, scratch);
				if (i) findings.push(i);
			}
			reportFindings(findings);
			if (findings.length) code = 1;
		}

		// ---- replay: put our vocabulary back before anything is written ----
		heading("Replay (restore our names)");
		const replayed = Object.keys(renames).length
			? rewriteTree(
					outDir,
					outcomes.map(o => o.rel),
					invert(renames),
				)
			: 0;
		log(replayed ? `  restored our names in ${replayed} merged file(s)` : "  nothing to replay");

		// A manifest can merge cleanly and still leave the workspace broken, so
		// the post-merge coherence pass runs over the whole merged tree.
		heading("Manifest coherence after merge");
		reportManifests(checkManifestCoherence(outDir));

		const conflicts = outcomes.filter(o => o.kind === "conflict");
		if (conflicts.length) {
			code = 1;
			heading(`Conflicts needing a human (${conflicts.length})`);
			for (const c of conflicts) log(`  ${c.rel}${c.detail ? `\n      ${c.detail}` : ""}`);
			log(`\n  merged tree with markers: ${outDir}`);
			log("  resolve them there, then re-run with --apply");
		} else {
			log(`\n  no conflicts — merged tree at ${outDir}`);
		}

		if (opts.apply) {
			if (conflicts.length || code !== 0) {
				warn("refusing to --apply while conflicts or gate findings are outstanding — clear them first");
			} else {
				heading("Applying");
				let written = 0;
				for (const o of outcomes) {
					if (o.kind === "deleted-upstream") continue;
					const src = at(outDir, o.rel);
					if (!existsSync(src)) continue;
					const dest = at(REPO_ROOT, o.rel);
					mkdirSync(dirname(dest), { recursive: true });
					writeFileSync(dest, readFileSync(src));
					written++;
				}
				log(`  wrote ${written} path(s) into the working tree`);
				heading("Manifest coherence in the working tree");
				const after = checkManifestCoherence(REPO_ROOT);
				reportManifests(after);
				if (after.length) code = 1;
			}
		}
	} finally {
		if (opts.apply) rmSync(stage, { recursive: true, force: true });
		else log(`\nstaging kept for inspection: ${stage}`);
	}
	return code;
}

process.exit(main());
