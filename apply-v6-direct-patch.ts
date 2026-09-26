#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const TAU = resolve(process.env.HOME!, "sovereign/projects/range/ranch/stockyard/tau");

// 1. FIX $env live proxy - check env.ts
{
  const f = join(TAU, "packages/ai/src/utils/env.ts");
  let s = readFileSync(f,"utf8");
  console.log("env.ts snippet:", s.slice(0,500));
  // The $env object must read Bun.env live, not cached process.env
  // Patch: ensure PI_OPENAI_STREAM_IDLE_TIMEOUT_MS reads Bun.env
  if(s.includes("PI_OPENAI_STREAM_IDLE_TIMEOUT_MS")){
    // add live getter if it's a plain object
    if(!s.includes("get PI_OPENAI_STREAM_IDLE_TIMEOUT_MS")){
      s = s.replace(/PI_OPENAI_STREAM_IDLE_TIMEOUT_MS:\s*process\.env\.PI_OPENAI_STREAM_IDLE_TIMEOUT_MS/, `get PI_OPENAI_STREAM_IDLE_TIMEOUT_MS(){ return (globalThis as any).Bun?.env?.PI_OPENAI_STREAM_IDLE_TIMEOUT_MS ?? process.env.PI_OPENAI_STREAM_IDLE_TIMEOUT_MS }`);
      writeFileSync(f,s);
      console.log("✓ env.ts live proxy patched");
    }
  }
}

// 2. FIX Z.AI max tier - ensure payload fires
{
  const f = join(TAU, "packages/ai/src/providers/openai-completions.ts");
  let s = readFileSync(f,"utf8");
  // Find where reasoning_effort is set and ensure max is kept
  // Look for tool_stream logic
  const idx = s.indexOf("tool_stream");
  console.log("tool_stream found at", idx);
  if(idx>0){
    const snippet = s.slice(Math.max(0,idx-500), idx+500);
    console.log(snippet);
  }
  // Ensure Z.AI models don't have reasoning_effort stripped
  // The bug is in compat check: if model has max tier, keep max
  if(s.includes('reasoning_effort') && s.includes('zai')){
    // Don't map max->high for zai
    s = s.replace(/if\(.*minimax.*\)\{\s*const v=\(params as any\)\.reasoning_effort;[^}]+\}/s, 
      `if(/minimax/i.test(_model) && !_model.includes("glm") && !_model.includes("zai")){
        const v=(params as any).reasoning_effort;
        if(v==="none"||v==="minimal") (params as any).reasoning_effort="low";
        if(v==="max") (params as any).reasoning_effort="high";
      }`);
    writeFileSync(f,s);
    console.log("✓ Z.AI max kept");
  }
}

// 3. DEBUG: show full idle-iterator.ts
{
  const f = join(TAU, "packages/ai/src/utils/idle-iterator.ts");
  let s = readFileSync(f,"utf8");
  console.log("\n=== FULL idle-iterator.ts ===");
  console.log(s);
}
