/**
 * Run a package's typecheck from its real path.
 *
 * This checkout is reachable through a symlink (`projects/tau` →
 * `projects/range/ranch/stockyard/tau`) and `node_modules/@tau/*` are
 * symlinks back into `packages/*`. A typechecker started from the symlinked
 * path resolves `include: ["src"]` to that spelling while resolving imports to
 * the realpath, so one source file is loaded twice as two distinct modules.
 * Nominal identity then fails — private `#field` brands, "cannot simultaneously
 * extend" — producing errors that look like real defects but are not. The same
 * duplication buries genuine errors: a real `TS2322` sat inside 904 lines of
 * this and read as pre-existing noise.
 *
 * The offending input is the inherited `PWD`, not `process.cwd()` (Bun already
 * canonicalizes the latter). Spawning with an explicit physical `cwd` collapses
 * both spellings to one, making the output trustworthy. CI is unaffected — it
 * has no symlink — so this matters only for symlinked local checkouts.
 *
 * Usage: `bun scripts/typecheck.ts <project-dir-or-tsconfig>` — a dir holding
 * a `tsconfig.json` (relative to the package root), or a tsconfig path for the
 * few projects that name theirs differently.
 */
import { realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const [target = "."] = process.argv.slice(2);
// `PWD` is the logical path the shell cd'd through; `process.cwd()` is already
// physical, so it cannot detect the condition this script exists to fix.
const base = process.env.PWD ?? process.cwd();
const requested = join(base, target);
const isTsconfig = requested.endsWith(".json");
// The project dir is what the typechecker runs *in*, since that is what
// resolves the `include` roots — the tsconfig path alone is not enough.
const projectDir = isTsconfig ? dirname(requested) : requested;
const logical = isTsconfig ? requested : join(projectDir, "tsconfig.json");
const resolved = realpathSync(logical);
if (resolved !== logical) {
	// Say so once: every path in the output below will be the physical one.
	console.log(`typecheck: ${relative(base, logical)} → ${relative(base, resolved)} (symlink resolved)`);
}

// Inherit stdio so diagnostics stream unchanged, and take the child's exit code
// as our own so `check:ts` still fails the build.
const child = Bun.spawn(["bunx", "tsgo", "-p", resolved, "--noEmit"], {
	cwd: realpathSync(projectDir),
	stdout: "inherit",
	stderr: "inherit",
});
process.exit(await child.exited);
