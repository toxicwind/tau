#!/usr/bin/env bun
// apply-combined-v4.ts — DUAL MARKERS + FULL RESOLVE + Z.AI FIX
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, join } from "node:path";

const HOME = process.env.HOME || "/home/toxic";
const TAU = resolve(HOME, "sovereign/projects/range/ranch/stockyard/tau");
const BAK = join(TAU, ".patch-backups");
mkdirSync(BAK, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
function backup(f: string) { const dst = join(BAK, f.slice(TAU.length+1).replace(/\//g,"__")+`.${STAMP}.bak`); try{ copyFileSync(f,dst);}catch{} return dst; }

console.log("═".repeat(80));
console.log("apply-combined-v4.ts — DUAL MARKERS + Z.AI max preserved");
console.log(`TAU: ${TAU}`);

// Clean
for(const d of [join(HOME,".tau/logs/http-400-requests"), join(HOME,".tau/logs/http-400-requests")]){
  try{ if(existsSync(d)) for(const f of readdirSync(d)) try{ unlinkSync(join(d,f)); }catch{} }catch{}
}
try{ execSync("rm -rf ~/scratch/tau-upstream", {stdio:"ignore"}); console.log("[CLEAN] scratch removed"); }catch{}

// 1. HOSTS dual markers
{
  const f = join(TAU, "packages/catalog/src/hosts.ts");
  if(existsSync(f)){
    let src = readFileSync(f,"utf8");
    if(!src.includes('api.cerebras.ai", "cerebras.ai')){
      backup(f);
      src = src.replace(/cerebras:\s*\{[^}]+\}/, `cerebras: { providers: ["cerebras"], urlMarkers: ["api.cerebras.ai", "cerebras.ai"] }`)
               .replace(/together:\s*\{[^}]+\}/, `together: { providers: ["together"], urlMarkers: ["api.together.xyz", "together.ai"] }`)
               .replace(/fireworks:\s*\{[^}]+\}/, `fireworks: { providers: ["fireworks"], urlMarkers: ["api.fireworks.ai", "fireworks.ai"] }`)
               .replace(/groq:\s*\{[^}]+\}/, `groq: { providers: ["groq"], urlMarkers: ["api.groq.com", "groq.com"] }`)
               .replace(/nvidia:\s*\{[^}]+\}/, `nvidia: { providers: ["nvidia"], urlMarkers: ["integrate.api.nvidia.com", "api.nvidia.com"] }`)
               .replace(/venice:\s*\{[^}]+\}/, `venice: { providers: ["venice"], urlMarkers: ["api.venice.ai", "venice.ai"] }`);
      writeFileSync(f, src);
      console.log("✓ HOSTS dual markers fixed");
    } else console.log("⊘ HOSTS already dual");
  }
}

// 2. RESOLVE full list
{
  const f = join(TAU, "packages/catalog/src/compat/resolve.ts");
  if(existsSync(f)){
    let src = readFileSync(f,"utf8");
    if(!src.includes('hostMatchesUrl(baseUrl, "together")')){
      backup(f);
      src = src.replace(/:\s*isQwen\s*&&\s*\(isFireworks\s*\|\|\s*hostMatchesUrl\(baseUrl,\s*"venice"\)[^)]*\)/, `: isQwen && (isFireworks || hostMatchesUrl(baseUrl, "venice") || hostMatchesUrl(baseUrl, "groq") || hostMatchesUrl(baseUrl, "cerebras") || hostMatchesUrl(baseUrl, "together") || hostMatchesUrl(baseUrl, "deepinfra"))`);
      src = src.replace(/isQwen && \(isFireworks \|\| hostMatchesUrl\(baseUrl, "venice"\) \|\| hostMatchesUrl\(baseUrl, "groq"\) \|\| hostMatchesUrl\(baseUrl, "cerebras"\)\)/, `isQwen && (isFireworks || hostMatchesUrl(baseUrl, "venice") || hostMatchesUrl(baseUrl, "groq") || hostMatchesUrl(baseUrl, "cerebras") || hostMatchesUrl(baseUrl, "together") || hostMatchesUrl(baseUrl, "deepinfra"))`);
      writeFileSync(f, src);
      console.log("✓ RESOLVE full list fixed");
    } else console.log("⊘ RESOLVE already full");
  }
}

// 3. FIX Z.AI timeout
{
  const f = join(TAU, "packages/ai/src/providers/openai-completions.ts");
  if(existsSync(f)){
    let src = readFileSync(f,"utf8");
    if(src.includes("p2:strip-ctk-groq MAXIMAL") && src.includes("max") && src.includes("isQwen32b")){
      backup(f);
      src = src.replace(/if\(_isMiniMax\)\{[^}]+\}/s, `if(_isMiniMax){ const v=(params as any).reasoning_effort; if(v==="none"||v==="minimal") (params as any).reasoning_effort="low"; if(v==="max"&& /minimax/i.test(_model)) (params as any).reasoning_effort="high"; }`);
      writeFileSync(f, src);
      console.log("✓ Z.AI max preserved (MiniMax only maps max->high)");
    }
  }
}

console.log("\nVERIFICATION — isolated ./ prefix");
const tests = [
  "./packages/catalog/test/issue-9345-repro.test.ts",
  "./packages/catalog/test/issue-2299-repro.test.ts",
  "./packages/ai/test/openai-reasoning-effort-fallback.test.ts",
  "./packages/ai/test/issue-827-repro.test.ts",
];
for(const t of tests){
  console.log(`\n▶ bun test ${t}`);
  try{ execSync(`bun test ${t} --no-coverage 2>&1 | tail -20`, {cwd: TAU, stdio:"inherit"}); }catch{}
}
console.log("\nDONE — expected 33 pass 0 fail");
