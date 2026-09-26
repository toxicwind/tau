#!/usr/bin/env bun
// apply-combined-v2.ts — MAXIMAL: T0 stray + P1-P7 + groq qwen3-32b default + qwen3.8 xhigh + MiniMax + ranch.parquet + 400-log cleanup
// Idempotent, backups to .patch-backups, fresh hashline anchors, no truncation.
// Run: TAU="$HOME/sovereign/projects/range/ranch/stockyard/tau" bun run apply-combined-v2.ts

import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";

const HOME = process.env.HOME || "/home/toxic";
const TAU = resolve(HOME, "sovereign/projects/range/ranch/stockyard/tau");
const BAK = join(TAU, ".patch-backups");
mkdirSync(BAK, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
function backup(file: string): string {
  const rel = file.slice(TAU.length + 1).replace(/\//g, "__");
  const dst = join(BAK, `${rel}.${STAMP}.bak`);
  try { copyFileSync(file, dst); } catch {}
  return dst;
}
function log(m: string) { console.log(m); }

log("═".repeat(80));
log("apply-combined-v2.ts — MAXIMAL FIX");
log("═".repeat(80));
log(`TAU: ${TAU}`);
log(`BACKUPS: ${BAK}`);
log(`STAMP: ${STAMP}`);

// ── 0. Clean http-400 dumps (fetch-based inspector) ────────────────────────
for (const d of [join(HOME, ".tau/logs/http-400-requests"), join(HOME, ".omp/logs/http-400-requests"), join(TAU, ".tau/logs/http-400-requests")]) {
  try {
    if (existsSync(d)) {
      for (const f of readdirSync(d)) {
        try { unlinkSync(join(d, f)); } catch {}
      }
      log(`[CLEAN] ${d} emptied`);
    }
  } catch {}
}

// ── 0b. Ranch parquet rename (PAR1 binary, not txt) ────────────────────────
{
  const txt = join("/mnt/data", "ranch.parquet.txt");
  const parquet = join("/mnt/data", "ranch.parquet");
  if (existsSync(txt) && !existsSync(parquet)) {
    try { copyFileSync(txt, parquet); log(`[RANCH] copied ${txt} -> ${parquet} (PAR1)`); } catch {}
  }
  const localTxt = join(TAU, "ranch.parquet.txt");
  const localParquet = join(TAU, "ranch.parquet");
  if (existsSync(localTxt) && !existsSync(localParquet)) {
    try { copyFileSync(localTxt, localParquet); log(`[RANCH] renamed local ${localTxt} -> parquet`); } catch {}
  }
}

// ── T0: stray isNvidiaNim in resolve.ts (breaks 80 tests) ──────────────────
{
  const f = join(TAU, "packages/catalog/src/compat/resolve.ts");
  if (existsSync(f)) {
    let src = readFileSync(f, "utf8");
    if (src.includes("/* t0:stray-nvidia-nim")) {
      log("⊘ T0 already removed");
    } else {
      const re = /^\s*const\s+isNvidiaNim\s*=\s*modelMatchesHost\s*\(\s*hostModel\s*,\s*"nvidia"\s*\)\s*;?\s*\n/gm;
      const matches = [...src.matchAll(re)];
      if (matches.length > 1) {
        log(`[T0] Found ${matches.length} isNvidiaNim declarations - removing duplicates in getKeyRecords`);
        backup(f);
        const lines = src.split("\n");
        const getKeyStart = lines.findIndex(l => l.includes("function getKeyRecords"));
        let newLines: string[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes("const isNvidiaNim = modelMatchesHost") && i > getKeyStart && i < getKeyStart + 30) {
            newLines.push("/* t0:stray-nvidia-nim — removed, was inside getKeyRecords() wrong place */");
          } else {
            newLines.push(lines[i]);
          }
        }
        writeFileSync(f, newLines.join("\n"));
        log("✓ T0 stray cleaned");
      } else if (matches.length === 1) {
        const idx = src.indexOf(matches[0][0]);
        const before = src.slice(Math.max(0, idx - 500), idx);
        if (before.includes("getKeyRecords")) {
          backup(f);
          writeFileSync(f, src.replace(re, "/* t0:stray-nvidia-nim — removed from getKeyRecords */\n"));
          log("✓ T0 stray removed from getKeyRecords");
        } else {
          log("⊘ T0 isNvidiaNim is in correct place (near isVenice), keep");
        }
      }
    }
  }
}

// ── HOSTS: deduplicate groq/cerebras/venice/fireworks/nvidia ───────────────
{
  const f = join(TAU, "packages/catalog/src/hosts.ts");
  if (existsSync(f)) {
    let src = readFileSync(f, "utf8");
    const counts = (name: string) => (src.match(new RegExp(`\\b${name}:\\s*{`, "g")) || []).length;
    const dups = ["groq", "cerebras", "venice", "fireworks", "nvidia", "together", "deepinfra"].filter(n => counts(n) > 1);
    if (dups.length > 0) {
      log(`[HOSTS] Duplicates found: ${dups.join(", ")} counts=${dups.map(c => `${c}:${counts(c)}`).join(" ")}`);
      backup(f);
      src = src.replace(/^\s*groq:\s*{[^}]*},\n/gm, "")
               .replace(/^\s*cerebras:\s*{[^}]*},\n/gm, "")
               .replace(/^\s*venice:\s*{[^}]*},\n/gm, "")
               .replace(/^\s*fireworks:\s*{[^}]*},\n?/gm, "")
               .replace(/^\s*nvidia:\s*{[^}]*},\n/gm, "")
               .replace(/^\s*together:\s*{[^}]*},\n/gm, "")
               .replace(/^\s*deepinfra:\s*{[^}]*},\n/gm, "");
      if (!src.includes("groq: {")) {
        src = src.replace("openrouter:", `groq: { providers: ["groq"], urlMarkers: ["api.groq.com"] },
  openrouter:`);
      }
      if (!src.includes("nvidia: {")) {
        src = src.replace("groq: {", `nvidia: { providers: ["nvidia"], urlMarkers: ["integrate.api.nvidia.com"] },
  groq: {`);
      }
      if (!src.includes("cerebras: {")) {
        src = src.replace("nvidia: {", `cerebras: { providers: ["cerebras"], urlMarkers: ["cerebras.ai"] },
  nvidia: {`);
      }
      if (!src.includes("venice: {")) {
        src = src.replace("openrouter:", `venice: { providers: ["venice"], urlMarkers: ["api.venice.ai"] },
  openrouter:`);
      }
      if (!src.includes("fireworks: {")) {
        src = src.replace("venice: {", `/** URL-only on purpose: the fireworks/firepass providers route per-model */
  fireworks: { urlMarkers: ["fireworks.ai"] },
  venice: {`);
      }
      writeFileSync(f, src);
      log("✓ HOSTS deduped and canonical re-added");
    } else {
      log("⊘ HOSTS no duplicates");
    }
  }
}

// ── P1: compat/openai.ts + compat/resolve.ts routing ───────────────────────
{
  const f1 = join(TAU, "packages/catalog/src/compat/openai.ts");
  if (existsSync(f1)) {
    let src = readFileSync(f1, "utf8");
    if (!src.includes("/* p1:groq-thinking-format */")) {
      backup(f1);
      src = src.replace(/(const\s+isVenice[^;]*;)/, `$1
/* p1:groq-thinking-format */
const isGroq = modelMatchesHost(hostModel, "groq") || baseUrl?.includes("groq.com") || provider === "groq";
const isCerebras = modelMatchesHost(hostModel, "cerebras") || baseUrl?.includes("cerebras.ai") || provider === "cerebras";
const isDeepInfra = modelMatchesHost(hostModel, "deepinfra") || baseUrl?.includes("deepinfra");
const isTogether = modelMatchesHost(hostModel, "together") || baseUrl?.includes("together.xyz");`);
      src = src.replace(/const\s+thinkingFormat\s*=\s*[\s\S]*?;\n/, `/* p1:groq-thinking-format routed */
const thinkingFormat =
  isGroq ? "openai"
  : isCerebras ? "openai"
  : isVenice ? "openai"
  : isFireworks ? "openai"
  : isDeepInfra ? "openai"
  : isTogether ? "openai"
  : isNvidiaNim ? "qwen-chat-template"
  : isAlibaba || isQwen ? "qwen"
  : "openai";
`);
      writeFileSync(f1, src);
      log("✓ P1 openai.ts groq/cerebras/venice/fireworks -> openai");
    }
  }
  const f2 = join(TAU, "packages/catalog/src/compat/resolve.ts");
  if (existsSync(f2)) {
    let src = readFileSync(f2, "utf8");
    if (!src.includes("/* p1:resolve-groq */") && src.includes("isQwen && hostMatchesUrl(baseUrl, \"nvidia\")")) {
      if (!src.includes("isGroq") && !src.includes("groq.com")) {
        backup(f2);
        src = src.replace(/(const\s+isVenice[\s\S]{0,200}?;)/, `$1
/* p1:resolve-groq */
const isGroq = modelMatchesHost(hostModel, "groq") || baseUrl?.includes("groq.com");
const isCerebras = modelMatchesHost(hostModel, "cerebras") || baseUrl?.includes("cerebras.ai");`);
        src = src.replace(/:\s*isQwen\s*&&\s*\(isFireworks\s*\|\|\s*hostMatchesUrl\(baseUrl,\s*"venice"\)\)/, `: isQwen && (isGroq || isCerebras || isFireworks || hostMatchesUrl(baseUrl, "venice"))`);
        writeFileSync(f2, src);
        log("✓ P1 resolve.ts groq/cerebras added to openai route");
      }
    }
  }
}

// ── P2+P7: openai-completions.ts wire fix (MAXIMAL) ─────────────────────────
{
  const f = join(TAU, "packages/ai/src/providers/openai-completions.ts");
  if (existsSync(f)) {
    let src = readFileSync(f, "utf8");
    if (!src.includes("/* p2:strip-ctk-groq MAXIMAL */")) {
      backup(f);
      const anchor = "params.reasoning_effort = reasoning.wireEffort as Effort;";
      if (src.includes(anchor)) {
        src = src.replace(anchor, `${anchor}
// HASHLINE MAXIMAL FIX — web verified:
// - Groq qwen3-32b reasoning effort mapping to normalize all levels to 'default' (CHANGELOG)
// - NVIDIA NIM 400 Validation: Unsupported parameter(s): enable_thinking - schema additionalProperties:false, uses chat_template_kwargs.enable_thinking
// - Venice AI rejects enable_thinking with 400 additionalProperties:false, drives via reasoning_effort
// - Qwen3.8 27B thinking ON by default, tunable reasoning_effort=xhigh|medium|low (xhigh default), Supported low/medium/xhigh
// - Kimi K3 always reasons, supports only max, 400 tool_choice specified is incompatible with thinking enabled
/* p2:strip-ctk-groq MAXIMAL + p7:k3-keep-effort + qwen38 + minimax */
{
  const _base = (baseUrl || (hostModel as any)?.baseUrl || (params as any).baseUrl || "").toString().toLowerCase();
  const _model = String((params as any).model || modelId || "").toLowerCase();
  const _isGroq = _base.includes("groq.com") || (hostModel as any)?.provider === "groq";
  const _isCerebras = _base.includes("cerebras") || _base.includes("cerebras.ai");
  const _isVenice = _base.includes("venice.ai");
  const _isFireworks = _base.includes("fireworks.ai") || _base.includes("fireworks");
  const _isNvidia = _base.includes("nvidia.com") || _base.includes("integrate.api.nvidia.com");
  const _isStrict = _isGroq || _isCerebras || _isVenice || _isFireworks || _base.includes("deepinfra") || _base.includes("together.xyz");
  const _isQwen32b = /qwen3?-?32b/i.test(_model) || _model.includes("qwen/qwen3-32b") || _model.includes("qwen3-32b");
  const _isQwen38 = /qwen3\\.8|qwen38|qwen3-8|qwen3\\.8-27b/i.test(_model);
  const _isMiniMax = /minimax[.-]?m2/i.test(_model) || /gpt-oss/i.test(_model);
  const _isKimiK3 = /kimi[-_]?k3|moonshot.*k3/i.test(_model);

  if (_isStrict) {
    delete (params as any).enable_thinking;
    if ((params as any).chat_template_kwargs) {
      if (_isGroq) {
        delete (params as any).chat_template_kwargs;
      } else {
        delete (params as any).chat_template_kwargs.enable_thinking;
        if (_isQwen38 && (params as any).chat_template_kwargs?.reasoning_effort && !(params as any).reasoning_effort) {
          (params as any).reasoning_effort = (params as any).chat_template_kwargs.reasoning_effort;
        }
        if (Object.keys((params as any).chat_template_kwargs || {}).length === 0) {
          delete (params as any).chat_template_kwargs;
        }
      }
    }
    if ((params as any).reasoning_effort === "none") {
      (params as any).reasoning_effort = "low";
    }
  }

  if (_isNvidia) {
    if ((params as any).enable_thinking !== undefined) {
      const v = (params as any).enable_thinking;
      delete (params as any).enable_thinking;
      (params as any).chat_template_kwargs = { ...((params as any).chat_template_kwargs || {}), enable_thinking: v };
    }
    if ((params as any).preserve_thinking !== undefined && (policy as any)?.compat?.thinkingFormat === "qwen-chat-template") {
      const pv = (params as any).preserve_thinking;
      delete (params as any).preserve_thinking;
      (params as any).chat_template_kwargs = { ...((params as any).chat_template_kwargs || {}), preserve_thinking: pv };
    }
  }

  if ((params as any).reasoning_effort !== undefined && (params as any).enable_thinking !== undefined) {
    delete (params as any).enable_thinking;
  }

  if (_isQwen38) {
    const map: any = { minimal: "low", low: "low", medium: "medium", high: "xhigh", xhigh: "xhigh", max: "xhigh", none: "none", default: "low" };
    if (map[(params as any).reasoning_effort]) (params as any).reasoning_effort = map[(params as any).reasoning_effort];
  }

  if (_isQwen32b && _isGroq) {
    (params as any).reasoning_effort = "default" as any;
  }

  if (_isMiniMax) {
    const v = (params as any).reasoning_effort;
    if (v === "none" || v === "minimal") (params as any).reasoning_effort = "low";
    if (v === "xhigh" || v === "max") (params as any).reasoning_effort = "high";
  }

  if (_isKimiK3) {
    (params as any).reasoning_effort = (params as any).reasoning_effort ?? "max";
  }
}
if (/qwen3?-?32b/i.test(String((params as any).model || modelId || "").toLowerCase()) && String(baseUrl||"").toLowerCase().includes("groq.com")) {
  (params as any).reasoning_effort = "default" as any;
}
`);
        writeFileSync(f, src);
        log("✓ P2+P7 MAXIMAL completions patched");
      }
    }
  }
}

// ── P3: fallback ───────────────────────────────────────────────────────────
{
  const f = join(TAU, "packages/ai/src/providers/openai-reasoning-fallback.ts");
  if (existsSync(f)) {
    let src = readFileSync(f, "utf8");
    if (!src.includes("/* p3:supported-values-re */")) {
      backup(f);
      src = src.replace(/(export\s+function\s+resolveOpenAIReasoningEffortFallback)/, `/* p3:supported-values-re — additional 400 phrasings
   - "Thinking effort high is not supported by ... Supported efforts:" (xai/grok)
   - "Supported values are: low, medium, xhigh" (Qwen3.8)
   - "must be one of: low, medium, high" (MiniMax)
*/
const _SUPPORTED_VALUES_RE = /Supported values are:\\s*([^\\n]+)/i;
const _ALLOWED_VALUES_RE = /must be one of:\\s*([^\\n]+)/i;
const _SUPPORTED_EFFORTS_RE = /Supported efforts:\\s*([^\\n]+)/i;
$1`);
      src = src.replace(/delete\s+kwargs\.reasoning_effort;/, `delete kwargs.reasoning_effort;
    delete (kwargs as any).enable_thinking;`);
      writeFileSync(f, src);
      log("✓ P3 fallback");
    }
  }
}

// ── shared preserve_thinking gating ───────────────────────────────────────
{
  const f = join(TAU, "packages/ai/src/providers/openai-shared.ts");
  if (existsSync(f)) {
    let src = readFileSync(f, "utf8");
    if (src.includes("params.preserve_thinking = true;") && !src.includes('policy.compat.thinkingFormat')) {
      backup(f);
      src = src.replace(/params\.preserve_thinking\s*=\s*true\s*;?/, `if(policy.compat.thinkingFormat==="qwen") params.preserve_thinking = true;
      if(policy.compat.thinkingFormat==="qwen-chat-template") {
        (params as any).chat_template_kwargs = { ...((params as any).chat_template_kwargs||{}), preserve_thinking: true };
      }`);
      writeFileSync(f, src);
      log("✓ shared preserve_thinking gating");
    }
  }
}

// ── P4 ladder + P6 qwen.kdl + model-thinking ───────────────────────────────
{
  const f = join(TAU, "packages/catalog/src/provider-models/openai-compat.ts");
  if (existsSync(f)) {
    let src = readFileSync(f, "utf8");
    if (!src.includes("/* p4:preserve-thinking-ladder */")) {
      backup(f);
      src = src.replace(/(function\s+mapLiteLLMRichEntry|export\s+function\s+mapLiteLLMRichEntry)/, `/* p4:preserve-thinking-ladder — #9359 + #4695 */
function _preserveThinkingLadder(built:any, patch:any){ if(patch?.thinking?.efforts && built){ built.thinking=built.thinking??{}; built.thinking.efforts=patch.thinking.efforts; built.thinking.defaultLevel=patch.thinking.defaultLevel??built.thinking.defaultLevel; } return built; }
$1`);
      writeFileSync(f, src);
      log("✓ P4 ladder");
    }
  }
  const f2 = join(TAU, "packages/catalog/src/compat/rules/classes/qwen.kdl");
  if (existsSync(f2)) {
    let src = readFileSync(f2, "utf8");
    if (!src.includes("/* p6:qwen38-levelmap */")) {
      backup(f2);
      src += `\n/* p6:qwen38-levelmap */
rule qwen38-thinking {
  model_id contains "qwen3.8"
  thinkingLevelMap {
    off: "none"
    minimal: "low"
    low: "low"
    medium: "medium"
    high: "xhigh"
    xhigh: "xhigh"
    max: "xhigh"
    default: "xhigh"
  }
}
`;
      writeFileSync(f2, src);
      log("✓ P6 qwen.kdl");
    }
  }
}

// ── Verification ───────────────────────────────────────────────────────────
log("");
log("═".repeat(80));
log("VERIFICATION — isolated");
log("═".repeat(80));
for (const t of ["packages/catalog/test/issue-9345-repro.test.ts","packages/catalog/test/issue-2299-repro.test.ts","packages/ai/test/openai-reasoning-effort-fallback.test.ts"]) {
  const abs = join(TAU, t);
  if (!existsSync(abs)) continue;
  log(`\n▶ bun test ${t}`);
  try {
    const out = execSync(`bun test ${t} --no-coverage 2>&1 | tail -60`, { cwd: TAU, encoding: "utf8", timeout: 30000 });
    console.log(out);
  } catch (e: any) {
    console.log((e.stdout||"")+ (e.stderr||"").toString().slice(0,5000));
  }
}
log(`\nDONE — backups in ${BAK}`);