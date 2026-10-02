#!/usr/bin/env bun
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const TAU = resolve(process.env.HOME!, "sovereign/projects/range/ranch/stockyard/tau");
const BAK = join(TAU, ".patch-backups");
mkdirSync(BAK, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

function backup(rel: string): string {
  const src = join(TAU, rel);
  const dst = join(BAK, rel.replace(/\//g, "__") + "." + STAMP + ".bak");
  if (existsSync(src)) copyFileSync(src, dst);
  return dst;
}

// ── env.ts — four fixes ─────────────────────────────────────────────────────
const ENV = join(TAU, "packages/utils/src/env.ts");
backup("packages/utils/src/env.ts");
let env = readFileSync(ENV, "utf-8");
const envApplied: string[] = [];
const envSkipped: string[] = [];

// F1: statSync import
if (!env.includes('import { statSync }')) {
  env = env.replace('import * as fs from "node:fs";', 'import * as fs from "node:fs";\nimport { statSync } from "node:fs";');
  envApplied.push("F1: import statSync");
} else envSkipped.push("F1: statSync already imported");

// F2: parseEnvFile memoization on (path, mtime)
{
  const HEADER = 'export function parseEnvFile(filePath: string): Record<string, string> {';
  const MEMO = `const __parseEnvFileCache = new Map<string, { mtime: number; data: Record<string, string> }>();

export function parseEnvFile(filePath: string): Record<string, string> {
	// Memoize on (path, mtime). filterChildShellEnvInternal reads 4 dotenv files per
	// child-shell spawn; without this, every subprocess pays 4 synchronous reads.
	let mtime = 0;
	try { mtime = statSync(filePath).mtimeMs; } catch { /* missing -> empty */ }
	const cached = __parseEnvFileCache.get(filePath);
	if (cached && cached.mtime === mtime) return cached.data;`;
  if (env.includes(HEADER) && !env.includes("__parseEnvFileCache")) {
    env = env.replace(HEADER, MEMO);
    // cache before the final return of parseEnvFile
    const oldRet = `	// TAU_ overrides PI_
	for (const k in result) {
		if (k.startsWith("TAU_")) {
			result[\`PI_\${k.slice(4)}\`] = result[k];
		}
	}

	return result;
}`;
    const newRet = `	// TAU_ overrides PI_
	for (const k in result) {
		if (k.startsWith("TAU_")) {
			result[\`PI_\${k.slice(4)}\`] = result[k];
		}
	}

	__parseEnvFileCache.set(filePath, { mtime, data: result });
	return result;
}`;
    if (env.includes(oldRet)) {
      env = env.replace(oldRet, newRet);
      envApplied.push("F2: parseEnvFile memoized by (path, mtime)");
    } else envSkipped.push("F2: parseEnvFile return site did not match (skipped)");
  } else envSkipped.push("F2: parseEnvFile header not found or already memoized");
}

// F3: $env undefined-safe proxy
{
  const OLD = 'export const $env: Record<string, string> = Bun.env as Record<string, string>;';
  const NEW = `/**
 * Re-export of Bun.env with undefined-safe indexing.
 *
 * Bun.env's runtime type is Record<string, string | undefined>; the historical
 * export asserted Record<string, string> and every caller assumes string.
 * Rather than a mass signature change, we proxy the underlying object so
 * reading an unset name returns "" instead of undefined.
 */
export const $env: Record<string, string> = new Proxy(
	Bun.env as Record<string, string | undefined>,
	{
		get(target, prop: string) {
			const v = target[prop];
			return v === undefined ? "" : v;
		},
	},
);`;
  if (env.includes(OLD)) {
    env = env.replace(OLD, NEW);
    envApplied.push("F3: $env proxy returns '' for missing keys");
  } else envSkipped.push("F3: $env export line not matched");
}

// F4: provenance via WeakSet identity, not reference equality
{
  const MARKER = 'const projectEnvNamesLoadedByOmp = new Set<string>();';
  const WITH_ID = `const projectEnvNamesLoadedByOmp = new Set<string>();
const __projectEnvIdentity = new WeakSet<object>();
function __isProjectEnv(file: object): boolean { return __projectEnvIdentity.has(file); }`;
  const PARSE = 'const projectEnv = parseEnvFile(path.join(getProjectDir(), ".env"));';
  const PARSE_FIXED = `const projectEnv = parseEnvFile(path.join(getProjectDir(), ".env"));
__projectEnvIdentity.add(projectEnv);`;
  const REF = 'if (file === projectEnv) projectEnvNamesLoadedByOmp.add(key);';
  const REF_FIXED = 'if (__isProjectEnv(file)) projectEnvNamesLoadedByOmp.add(key);';
  if (env.includes(MARKER) && !env.includes("__projectEnvIdentity")) {
    env = env.replace(MARKER, WITH_ID);
    env = env.replace(PARSE, PARSE_FIXED);
    env = env.replace(REF, REF_FIXED);
    if (env.includes("__isProjectEnv(file)")) envApplied.push("F4: project-env provenance via WeakSet identity");
    else envSkipped.push("F4: replacement applied to marker but not to reference site");
  } else envSkipped.push("F4: already patched or marker changed");
}

// F5: escaped-dollar fix (narrow: only unescape a single literal backslash)
{
  const OLD = `if (escaped) return match.slice(1);`;
  const NEW = `if (escaped) {
				const dollarIdx = match.indexOf("$");
				if (dollarIdx === 1) return match.slice(1);
				// double-escape: leave as-is so \\\\$FOO stays \\\\$FOO
			}`;
  if (env.includes(OLD) && !env.includes("dollarIdx")) {
    env = env.replace(OLD, NEW);
    envApplied.push("F5: escaped-dollar off-by-one corrected");
  } else envSkipped.push("F5: escape callback already updated or pattern changed");
}

writeFileSync(ENV, env);

// ── Verify env.ts still parses ──────────────────────────────────────────────
let envOk = "unknown";
try {
  const r = Bun.spawnSync(["bun", "build", "--target=bun", "--no-bundle", ENV], {
    cwd: TAU, stdout: "pipe", stderr: "pipe",
  });
  envOk = r.exitCode === 0 ? "PASS" : "FAIL";
} catch { envOk = "spawn-failed"; }

// ── Scan: dump exactly the ranges I need for the next batch ─────────────────
const dumpRanges: Array<[string, number, number, string]> = [
  ["packages/ai/src/providers/google-gemini-cli.ts", 305, 345, "gemini-cli-first-event-timeout"],
  ["packages/utils/src/dirs.ts", 130, 220, "dirs-empty-catches-1"],
  ["packages/utils/src/dirs.ts", 270, 380, "dirs-empty-catches-2"],
  ["packages/utils/src/dirs.ts", 1090, 1140, "dirs-empty-catches-3"],
  ["packages/coding-agent/src/discovery/vscode.ts", 80, 100, "vscode-cast"],
  ["packages/coding-agent/src/discovery/windsurf.ts", 45, 65, "windsurf-cast"],
  ["packages/coding-agent/src/discovery/claude.ts", 108, 130, "claude-cast"],
  ["packages/coding-agent/src/discovery/gemini.ts", 100, 125, "gemini-discovery-cast"],
  ["packages/coding-agent/src/discovery/cursor.ts", 55, 75, "cursor-cast"],
  ["packages/utils/src/procmgr.ts", 25, 55, "procmgr-cast"],
  ["packages/utils/src/ptree.ts", 40, 55, "ptree-catch-1"],
  ["packages/utils/src/ptree.ts", 240, 260, "ptree-catch-2"],
  ["packages/utils/src/ptree.ts", 370, 385, "ptree-catch-3"],
  ["packages/coding-agent/src/stream/server-client.ts", 1, 40, "stream-client-timeouts"],
  ["packages/coding-agent/src/hindsight/client.ts", 1, 40, "hindsight-timeouts"],
  ["packages/ai/src/providers/gitlab-duo-workflow.ts", 40, 80, "gitlab-duo-timeouts"],
];

const DUMP = join(BAK, `context-dump.${STAMP}.txt`);
let dump = `══ context dump @ ${STAMP} ══\n\n`;

for (const [rel, from, to, label] of dumpRanges) {
  const f = join(TAU, rel);
  if (!existsSync(f)) { dump += `── MISSING: ${rel} ──\n\n`; continue; }
  const lines = readFileSync(f, "utf-8").split("\n");
  const lo = Math.max(0, from - 1);
  const hi = Math.min(lines.length, to);
  dump += `── ${label} :: ${rel}:${from}-${to} ──\n`;
  for (let i = lo; i < hi; i++) {
    dump += `${String(i + 1).padStart(5)} | ${lines[i]}\n`;
  }
  dump += `\n`;
}

writeFileSync(DUMP, dump);

// ── Report ──────────────────────────────────────────────────────────────────
console.log("═".repeat(78));
console.log("fix-env-and-scan.ts");
console.log("═".repeat(78));
console.log(`env.ts: ${envApplied.length} applied, ${envSkipped.length} skipped  [build ${envOk}]`);
for (const a of envApplied) console.log(`  ✓ ${a}`);
for (const s of envSkipped) console.log(`  ⊘ ${s}`);
console.log();
console.log(`context dump: ${DUMP}`);
console.log(`  bytes: ${statSync(DUMP).size}`);
console.log();
console.log("Next: cat " + DUMP);
