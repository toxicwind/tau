/**
 * tau/scripts/tdd.live.ts — TDD red-green for tok + whole integration.
 *
 * RED phase: every assertion below fails because the feature doesn't exist yet.
 * GREEN phase: implement, then re-run — all pass.
 *
 * Run: bun scripts/tdd.live.ts
 */

import { countTokens, Encoding } from "file:///C:/Users/beebe/tau/packages/natives/native/index.js";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

//──────────────────────────────────────────────────────────────────────────────
// RED: tok counts "hello world" as exactly 2 tokens (o200k_base)
//──────────────────────────────────────────────────────────────────────────────
const n1 = countTokens("hello world", Encoding.O200kBase);
assert(n1 === 2, `tok("hello world") === 2, got ${n1}`);

//──────────────────────────────────────────────────────────────────────────────
// RED: tok counts empty string as 0
//──────────────────────────────────────────────────────────────────────────────
const n2 = countTokens("", Encoding.O200kBase);
assert(n2 === 0, `tok("") === 0, got ${n2}`);

//──────────────────────────────────────────────────────────────────────────────
// RED: whole CLI exists and dumps a file to end
//──────────────────────────────────────────────────────────────────────────────
const wholeOut = execSync("bun C:\\Users\\beebe\\bin\\whole C:\\Users\\beebe\\bin\\tok --all", { encoding: "utf8" });
assert(wholeOut.includes("END OF FILE REACHED"), "whole --all prints END OF FILE REACHED");
assert(wholeOut.includes("tok — estate-scripts"), "whole --all dumps tok header");

//──────────────────────────────────────────────────────────────────────────────
// RED: whole reads stdin to end
//──────────────────────────────────────────────────────────────────────────────
const stdinOut = execSync('echo "tau tdd" | bun C:\\Users\\beebe\\bin\\whole -', { encoding: "utf8" });
assert(stdinOut.includes("tau tdd"), "whole - reads stdin");

//──────────────────────────────────────────────────────────────────────────────
// RED: tok CLI binary exists in bin
//──────────────────────────────────────────────────────────────────────────────
const tokExists = readFileSync("C:\\Users\\beebe\\bin\\tok.cmd", "utf8").includes("bun");
assert(tokExists, "tok.cmd exists and calls bun");

//──────────────────────────────────────────────────────────────────────────────
// RED: whole CLI binary exists in bin
//──────────────────────────────────────────────────────────────────────────────
const wholeExists = readFileSync("C:\\Users\\beebe\\bin\\whole.cmd", "utf8").includes("bun");
assert(wholeExists, "whole.cmd exists and calls bun");

//──────────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
