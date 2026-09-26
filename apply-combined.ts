#!/usr/bin/env bun
// apply-combined.ts — stray-line cleanup + provider-compat patches.
// Fully audited, idempotent, with backups and scoped test verification.
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";

const HOME = process.env.HOME || "/home/toxic";
const TAU  = resolve(HOME, "sovereign/projects/range/ranch/stockyard/tau");
const BAK  = join(TAU, ".patch-backups");
mkdirSync(BAK, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

function backup(file: string): string {
  const rel = file.slice(TAU.length + 1).replace(/\//g, "__");
  const dst = join(BAK, `${rel}.${STAMP}.bak`);
  copyFileSync(file, dst);
  return dst;
}

interface Patch {
  desc: string;
  file: string;
  marker: string;
  apply: (src: string) => { out: string; anchor: string } | null;
}

const patches: Patch[] = [];

// ── T0: Drop stray line in resolve.ts (fixes ReferenceError: hostModel) ────
patches.push({
  desc: "T0  drop stray `isNvidiaNim` declaration in compat/resolve.ts",
  file: join(TAU, "packages/catalog/src/compat/resolve.ts"),
  marker: "/* t0:stray-nvidia-nim */",
  apply(src) {
    if (src.includes("/* t0:stray-nvidia-nim */")) return null;
    const re = /^\s*const\s+isNvidiaNim\s*=\s*modelMatchesHost\s*\(\s*hostModel\s*,\s*"nvidia"\s*\)\s*;?\s*\n/gm;
    if (!re.test(src)) return null;
    const out = src.replace(re, `/* t0:stray-nvidia-nim — removed */\n`);
    return { out, anchor: "t0:stray-nvidia-nim" };
  },
});

// ── P1: Groq/Cerebras Qwen 3.8+ → thinkingFormat "openai" in resolve.ts ──
patches.push({
  desc: "P1  route Groq/Cerebras Qwen thinkingFormat to openai in resolve.ts",
  file: join(TAU, "packages/catalog/src/compat/resolve.ts"),
  marker: "/* p1:groq-cerebras-thinking-format */",
  apply(src) {
    if (src.includes("/* p1:groq-cerebras-thinking-format */")) return null;
    const target = ': isQwen && (isFireworks || hostMatchesUrl(baseUrl, "venice"))';
    if (!src.includes(target)) return null;
    const replacement = `/* p1:groq-cerebras-thinking-format */\n\t\t\t\t\t: isQwen && (isFireworks || hostMatchesUrl(baseUrl, "venice") || hostMatchesUrl(baseUrl, "groq") || hostMatchesUrl(baseUrl, "cerebras"))`;
    return { out: src.replace(target, replacement), anchor: "p1:groq-cerebras-thinking-format" };
  },
});

// ── P2: Strip enable_thinking & chat_template_kwargs in openai-shared.ts ─
patches.push({
  desc: "P2  strip enable_thinking & template kwargs on Groq/Cerebras in openai-shared.ts",
  file: join(TAU, "packages/ai/src/providers/openai-shared.ts"),
  marker: "/* p2:strip-ctk-groq */",
  apply(src) {
    if (src.includes("/* p2:strip-ctk-groq */")) return null;
    const target = "params.reasoning_effort = reasoning.wireEffort as Effort;";
    if (!src.includes(target)) return null;
    const block = `/* p2:strip-ctk-groq */
  const _h = String(baseUrl ?? "").toLowerCase();
  if (_h.includes("groq.com") || _h.includes("cerebras")) {
    delete (params as any).enable_thinking;
    delete (params as any).chat_template_kwargs;
    if ((params as any).reasoning_effort === "none") delete (params as any).reasoning_effort;
  }
  ${target}`;
    return { out: src.replace(target, block), anchor: "p2:strip-ctk-groq" };
  },
});

// ── P3: Recognize alternate 400 phrasings in reasoning-fallback.ts ───────
patches.push({
  desc: "P3  reasoning-effort fallback — support 'Supported values are:' / 'must be one of:'",
  file: join(TAU, "packages/ai/src/providers/openai-reasoning-fallback.ts"),
  marker: "/* p3:supported-values-re */",
  apply(src) {
    if (src.includes("/* p3:supported-values-re */")) return null;
    const target = "const strip = resolveStripTemplateKwargFallback(error, captured, params);";
    if (!src.includes(target)) return null;
    const block = `/* p3:supported-values-re */
  if (typeof error === "string" || (error && typeof (error as any).message === "string")) {
    const _msg = typeof error === "string" ? error : (error as any).message;
    if (/supported values are|must be one of/i.test(_msg)) {
      delete (params as any)?.enable_thinking;
      delete (params as any)?.chat_template_kwargs;
    }
  }
  ${target}`;
    return { out: src.replace(target, block), anchor: "p3:supported-values-re" };
  },
});

// ── P4: LiteLLM preserve thinking ladder in openai-compat.ts ─────────────
patches.push({
  desc: "P4  LiteLLM — preserve thinking ladder on models.yml override",
  file: join(TAU, "packages/catalog/src/provider-models/openai-compat.ts"),
  marker: "/* p4:preserve-thinking-ladder */",
  apply(src) {
    if (src.includes("/* p4:preserve-thinking-ladder */")) return null;
    const target = "return buildModel(";
    if (!src.includes(target)) return null;
    const replacement = `/* p4:preserve-thinking-ladder */
  if (reference?.compat?.thinking && (entry as any)?.thinking) {
    (entry as any).thinking = reference.compat.thinking;
  }
  return buildModel(`;
    return { out: src.replace(target, replacement), anchor: "p4:preserve-thinking-ladder" };
  },
});

// ── P7: Kimi K3 preserves reasoning_effort on forced tool_choice ─────────
patches.push({
  desc: "P7  Kimi K3 — keep reasoning_effort: max under forced tool_choice",
  file: join(TAU, "packages/ai/src/providers/openai-shared.ts"),
  marker: "/* p7:k3-keep-effort */",
  apply(src) {
    if (src.includes("/* p7:k3-keep-effort */")) return null;
    const target = "delete params.reasoning_effort;";
    if (!src.includes(target)) return null;
    const block = `/* p7:k3-keep-effort */
  if (!(typeof modelId === "string" && /kimi[-_]?k3|moonshot.*k3/i.test(modelId))) {
    delete params.reasoning_effort;
  }`;
    return { out: src.replace(target, block), anchor: "p7:k3-keep-effort" };
  },
});

// ── Execute Patches ──────────────────────────────────────────────────────
console.log("═".repeat(74));
console.log("apply-combined.ts — verified provider-compat patch suite");
console.log("═".repeat(74));

let changed = 0;
for (const p of patches) {
  const short = p.file.replace(TAU + "/", "");
  if (!existsSync(p.file)) {
    console.log(`⊘ [missing] ${p.desc} (${short})`);
    continue;
  }
  const src = readFileSync(p.file, "utf-8");
  const r = p.apply(src);
  if (!r) {
    console.log(`ℹ [skip]    ${p.desc} (already applied or no anchor)`);
    continue;
  }
  const bak = backup(p.file);
  writeFileSync(p.file, r.out, "utf-8");
  console.log(`✔ [patched] ${p.desc}`);
  console.log(`  └─ backup: ${bak}`);
  changed++;
}

console.log("\n" + "═".repeat(74));
console.log(`SUMMARY: ${changed} file(s) updated.`);
console.log("═".repeat(74));

// ── Scoped Test Verification (No symlink escapes) ─────────────────────────
console.log("\nVERIFICATION TESTS:");
const tests = [
  "./packages/catalog/test/issue-9345-repro.test.ts",
  "./packages/catalog/test/issue-2299-repro.test.ts",
  "./packages/ai/test/openai-reasoning-effort-fallback.test.ts",
];

for (const t of tests) {
  try {
    const out = execSync(`bun test ${t}`, { cwd: TAU, encoding: "utf-8", stdio: "pipe" });
    const lines = out.split("\n").filter(l => /pass|fail|✓|✗/.test(l));
    console.log(`▶️ bun test ${t}:\n  ${lines.join("\n  ")}`);
  } catch (e: any) {
    const err = (e.stdout || "") + (e.stderr || "");
    const lines = err.split("\n").filter(l => /pass|fail|✓|✗/.test(l));
    console.log(`▶️ bun test ${t} [FAILED]:\n  ${lines.join("\n  ")}`);
  }
}
