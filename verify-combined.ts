#!/usr/bin/env bun
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

const TAU = process.env.TAU
  || resolve(process.env.HOME!, "sovereign/projects/range/ranch/stockyard/tau");

const tests = [
  "packages/catalog/test/issue-9345-repro.test.ts",
  "packages/catalog/test/issue-2299-repro.test.ts",
  "packages/ai/test/openai-reasoning-effort-fallback.test.ts",
  "packages/ai/test/issue-827-repro.test.ts",
];

let passed = 0, failed = 0, missing = 0;
for (const t of tests) {
  if (!existsSync(join(TAU, t))) {
    missing++;
    console.log(`\n⊘ ${t} (missing)`);
    continue;
  }
  console.log(`\n${"─".repeat(74)}\n▶ bun test ${t}\n${"─".repeat(74)}`);
  try {
    execSync(`bun test "${t}"`, { cwd: TAU, stdio: "inherit" });
    passed++;
  } catch {
    failed++;
  }
}
console.log(`\n══ ${passed} passed / ${failed} failed / ${missing} missing ══`);
