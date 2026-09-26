#!/usr/bin/env bun
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";
const TAU = resolve(process.env.HOME!, "sovereign/projects/range/ranch/stockyard/tau");

// FIX Z.AI max tier timeouts - ensure max is NOT clamped to high for Z.AI
{
  const f = join(TAU, "packages/ai/src/providers/openai-completions.ts");
  let s = readFileSync(f,"utf8");
  // Z.AI uses reasoning_effort:max native - must keep it, not map to high
  // Only MiniMax m2 should map max->high
  if(s.includes('reasoning_effort') && !s.includes('ZAI_KEEP_MAX')){
    s = s.replace(/\/\/ P2.*MAXIMAL[\s\S]*?if\(_isMiniMax\)\{[^}]+\}/, `// P2:strip-ctk-groq MAXIMAL — ZAI_KEEP_MAX v5
    if(_isMiniMax && /minimax/i.test(_model)){
      const v=(params as any).reasoning_effort;
      if(v==="none"||v==="minimal") (params as any).reasoning_effort="low";
      if(v==="max") (params as any).reasoning_effort="high";
    }`);
    writeFileSync(f,s);
    console.log("✓ Z.AI max preserved");
  }
}

// FIX first-event timeouts — PI_OPENAI_STREAM_IDLE_TIMEOUT_MS env read
{
  const f = join(TAU, "packages/ai/src/providers/openai-responses.ts");
  if(existsSync(f)){
    let s = readFileSync(f,"utf8");
    // ensure env var overrides compat timeout
    if(!s.includes('PI_OPENAI_STREAM_IDLE_TIMEOUT_MS')){
      console.log("⊘ responses file doesn't contain env var logic - checking completions");
    }
  }
  const f2 = join(TAU, "packages/ai/src/providers/openai-completions.ts");
  let s2 = readFileSync(f2,"utf8");
  // Patch: compat.streamIdleTimeoutMs should honor model.compat + env
  if(s2.includes('streamIdleTimeoutMs')){
    s2 = s2.replace(/streamIdleTimeoutMs:\s*[^,]+,/, `streamIdleTimeoutMs: Number(process.env.PI_OPENAI_STREAM_IDLE_TIMEOUT_MS)||model.compat?.streamIdleTimeoutMs||300000, // v5 fix env override`);
    writeFileSync(f2,s2);
    console.log("✓ streamIdleTimeoutMs env override added");
  }
}

console.log("\n▶ Running the 6 previously failing tests only:");
for(const t of [
  "./packages/ai/test/openai-completions-compat.test.ts -t \"Z.AI max tier\"",
  "./packages/ai/test/openai-completions-disable-reasoning.test.ts -t \"Z.AI\"",
  "./packages/ai/test/openai-first-event-timeout.test.ts -t \"PI_OPENAI_STREAM_IDLE_TIMEOUT_MS widen\""
]){
  try{ execSync(`bun test ${t} --no-coverage 2>&1 | tail -15`, {cwd: TAU, stdio:"inherit"}); }catch{}
}
