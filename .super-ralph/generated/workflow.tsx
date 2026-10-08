import React from "react";
import { createSmithers, ClaudeCodeAgent, CodexAgent, Sequence, Ralph } from "smthrs";
import { SuperRalph } from "/home/toxic/estate/ranch/corral/src";
import { InterpretConfig, FinalReport, CompletionValidator } from "/home/toxic/estate/ranch/corral/src/components";
import { ralphOutputSchemas } from "/home/toxic/estate/ranch/corral/src";

const REPO_ROOT = "/home/toxic/tau";
const DB_PATH = "/home/toxic/tau/.smithers/workflow.db";
const HAS_CLAUDE = true;
const HAS_CODEX = true;
const PROMPT_TEXT = "Fixing tau build warnings";
const PROMPT_SPEC_PATH = null;
const PACKAGE_SCRIPTS = {
  "setup": "bun scripts/setup.ts",
  "dev": "bun --cwd=packages/coding-agent src/cli.ts",
  "dev:timing": "PI_TIMING=x bun --cwd=packages/coding-agent --preload ../utils/src/module-timer.ts src/cli.ts",
  "stats": "bun --cwd=packages/coding-agent src/cli.ts stats",
  "collab:web:dev": "bun --cwd=packages/collab-web run dev",
  "collab:relay": "bun --cwd=packages/collab-web run relay",
  "collab:mock-host": "bun --cwd=packages/collab-web run mock-host",
  "collab:web:build": "bun --cwd=packages/collab-web run build",
  "meta": "bun --cwd=packages/metaharness run dev",
  "claude:trace": "bun scripts/claude-trace.ts",
  "build": "bun run --workspaces --if-present build",
  "build:native": "bun --cwd=packages/natives run build",
  "test": "bun run test:ts && bun run test:rs && bun run test:py",
  "test:ts": "bun scripts/ci-test-ts.ts local-ts",
  "test:scripts": "bun test scripts/ci-test-ts.test.ts scripts/ci-release-build-binaries.test.ts scripts/musl-release.test.ts scripts/ci-release-publish.test.ts scripts/release.test.ts",
  "test:rs": "bun scripts/run-rs-task.ts test:rs",
  "check": "bun run --parallel check:ts check:rs",
  "check:ts": "bun run check:tools && bun run --filter './packages/*' --sequential --if-present check:types",
  "check:tools": "oxlint . && oxfmt --check 'packages/*/src/**/*.{ts,tsx}' 'packages/*/{test,bench,examples,scripts}/**/*.ts' 'packages/*/*.ts' 'scripts/**/*.ts'",
  "check:rs": "bun scripts/run-rs-task.ts check:rs",
  "lint": "bun run --parallel lint:ts lint:rs",
  "lint:ts": "bun run --parallel lint:tools && bun run --workspaces --if-present lint",
  "lint:tools": "oxlint .",
  "lint:rs": "bun scripts/run-rs-task.ts lint:rs",
  "fmt": "bun run --parallel fmt:ts fmt:rs",
  "fmt:ts": "bun run fmt:tools && bun run --workspaces --if-present fmt",
  "fmt:tools": "oxfmt 'packages/*/src/**/*.{ts,tsx}' 'packages/*/{test,bench,examples,scripts}/**/*.ts' 'packages/*/*.ts' 'scripts/**/*.ts'",
  "fmt:rs": "bun scripts/run-rs-task.ts fmt:rs",
  "fix": "bun run --parallel fix:ts fix:rs",
  "fix:all": "bun run --parallel fix:ts:all fix:rs fix:changelogs",
  "fix:ts": "bun run fix:tools && bun run --workspaces --if-present fix",
  "fix:ts:all": "bun run fix:tools:all && bun run --workspaces --if-present fix",
  "fix:tools": "oxlint --fix --fix-suggestions . && bun run fmt:tools",
  "fix:tools:all": "oxlint --fix --fix-suggestions . && bun run fmt:tools",
  "fix:changelogs": "bun scripts/fix-changelogs.ts",
  "fix:rs": "bun scripts/run-rs-task.ts fix:rs",
  "ci:check:full": "bun run check:ts",
  "ci:test:full": "bun run ci:test:ts && bun run test:rs",
  "ci:test:ts": "bun scripts/ci-test-ts.ts all",
  "ci:test:ts:workspace": "bun scripts/ci-test-ts.ts workspace",
  "ci:test:ts:native": "bun scripts/ci-test-ts.ts native",
  "ci:test:coding-agent:singleton": "bun scripts/ci-test-ts.ts coding-agent-singleton",
  "ci:test:coding-agent:ui": "bun scripts/ci-test-ts.ts coding-agent-ui",
  "ci:test:coding-agent:runtime": "bun scripts/ci-test-ts.ts coding-agent-runtime",
  "ci:test:coding-agent:native": "bun scripts/ci-test-ts.ts coding-agent-native",
  "ci:test:coding-agent:heavy": "bun scripts/ci-test-ts.ts coding-agent-heavy",
  "ci:test:smoke": "bun packages/coding-agent/src/cli.ts --version && bun packages/coding-agent/src/cli.ts --help && bun packages/coding-agent/src/cli.ts stats --help && bun packages/coding-agent/src/cli.ts --smoke-test",
  "ci:test:install-methods": "bash scripts/install-tests/run-ci.sh",
  "ci:release:build-binaries": "bun scripts/ci-release-build-binaries.ts",
  "ci:release:checksums": "bun scripts/ci-release-checksums.ts",
  "ci:release:publish": "bun scripts/ci-release-publish.ts",
  "ci:release:publish-native-leaf": "bun scripts/ci-release-publish.ts --native-leaf",
  "bench:gen-fixtures": "bun --cwd=packages/typescript-edit-benchmark run src/generate.ts --typescript-dir /tmp/typescript-source --count-per-type 8",
  "stats:sync": "python3 scripts/session-stats/sync.py",
  "stats:tools": "python3 scripts/session-stats/analyze.py tools",
  "stats:edits": "python3 scripts/session-stats/analyze.py edits",
  "stats:followups": "python3 scripts/session-stats/analyze.py followups",
  "stats:audit": "bun scripts/session-stats/audit.ts",
  "tau:image": "docker build -t \"${TAU_IMAGE:-tau/tau:dev}\" .",
  "tau:run": "docker run --rm -it \"${TAU_IMAGE:-tau/tau:dev}\"",
  "lint:py": "ruff check python && ruff format --check python",
  "fix:py": "ruff check --fix python && ruff format python",
  "prepublishOnly": "bun run check",
  "prepare": "bun run gen:tool-views",
  "publish": "bun run prepublishOnly && npm publish -ws --access public",
  "publish:dry": "bun run prepublishOnly && npm publish -ws --access public --dry-run",
  "release": "bun scripts/release.ts",
  "gen:compat": "bun --cwd=packages/catalog run gen:compat",
  "gen:models": "bun --cwd=packages/catalog run gen:models",
  "gen:clippy": "bun scripts/gen-clippy-bazelrc.ts",
  "gen:stats": "bun --cwd=packages/stats run gen:stats",
  "gen:stats:reset": "bun --cwd=packages/stats run gen:stats:reset",
  "gen:changelog": "bun scripts/rewrite-changelog.ts",
  "gen:nix": "bun scripts/gen-nix-bun.ts",
  "gen:tool-views": "bun --cwd=packages/collab-web run gen:tool-views",
  "gen:bundle": "bun --cwd=packages/coding-agent run gen:bundle",
  "gen:native": "bun --cwd=packages/natives run gen:native",
  "gen:native:reset": "bun --cwd=packages/natives run gen:native:reset",
  "check-spoofed-versions": "bun scripts/check-spoofed-versions.ts",
  "build:all": "bun run build",
  "docker": "docker compose up -d",
  "health": "curl -sf http://127.0.0.1:25100/health",
  "install:all": "bun install",
  "ws:build": "turbo run build",
  "ws:dev": "turbo run dev",
  "ws:lint": "turbo run lint",
  "ws:test": "turbo run test",
  "ws:typecheck": "turbo run typecheck",
  "postinstall": "node scripts/fix-effect-bytesize.js || true"
};
const FALLBACK_CONFIG = {
  "projectName": "tau",
  "projectId": "tau",
  "focuses": [
    {
      "id": "core",
      "name": "Core Platform"
    },
    {
      "id": "api",
      "name": "API and Data"
    },
    {
      "id": "workflow",
      "name": "Workflow and Automation"
    }
  ],
  "specsPath": "",
  "referenceFiles": [
    "README.md",
    "docs"
  ],
  "buildCmds": {
    "build": "bun run build",
    "lint": "bun run lint",
    "rust": "cargo build"
  },
  "testCmds": {
    "test": "bun run test",
    "rust": "cargo test"
  },
  "preLandChecks": [
    "bun run build",
    "bun run lint",
    "cargo build"
  ],
  "postLandChecks": [
    "bun run test",
    "cargo test"
  ],
  "codeStyle": "Follow existing project conventions and keep changes minimal and test-driven.",
  "reviewChecklist": [
    "Spec compliance",
    "Tests cover behavior changes",
    "No regression risk in existing flows",
    "Error handling and observability"
  ],
  "maxConcurrency": 8,
  "maxIterations": 25
};
const CLARIFICATION_SESSION = null;
// Finite-by-default: Ralph loops exit on a real done predicate; this ceiling
// is the backstop (onMaxReached="fail" makes exhaustion loud, exit non-zero).
const MAX_ITERATIONS = 25;
const { smithers, outputs, Workflow } = createSmithers(
  ralphOutputSchemas,
  { dbPath: DB_PATH }
);

function createClaude(systemPrompt: string) {
  return new ClaudeCodeAgent({
    model: process.env.NIM_MODEL || "claude-sonnet-4-6",
    systemPrompt,
    cwd: REPO_ROOT,
    dangerouslySkipPermissions: true,
    timeoutMs: 60 * 60 * 1000,
  });
}

function createCodex(systemPrompt: string) {
  return new CodexAgent({
    model: "gpt-5.3-codex",
    systemPrompt,
    cwd: REPO_ROOT,
    yolo: true,
    timeoutMs: 60 * 60 * 1000,
  });
}

function choose(primary: "claude" | "codex", systemPrompt: string) {
  if (primary === "claude" && HAS_CLAUDE) return createClaude(systemPrompt);
  if (primary === "codex" && HAS_CODEX) return createCodex(systemPrompt);
  if (HAS_CLAUDE) return createClaude(systemPrompt);
  return createCodex(systemPrompt);
}

const planningAgent = choose("claude", "Plan and research next tickets.");
const implementationAgent = choose("claude", "Implement with test-driven development and jj workflows.");
const testingAgent = choose("claude", "Run tests and validate behavior changes.");
const reviewingAgent = choose("codex", "Review for regressions, spec drift, and correctness.");
const reportingAgent = choose("claude", "Write concise, accurate ticket status reports.");
const finalAgent = choose("claude", "Write the final reply for a completed autonomous workflow run. Follow the task instructions exactly; when asked for an exact reply, output only that.");
const validatorAgent = choose("claude", "Validate that a completed autonomous workflow run actually satisfied the original goal. Be strict, literal, and evidence-driven.");

export default smithers((ctx) => (
  <Workflow name="super-ralph-full">
    <Sequence>
      {/* Step 1: Interpret Config (clarification session already collected by CLI) */}
      <InterpretConfig
        prompt={PROMPT_TEXT}
        clarificationSession={CLARIFICATION_SESSION}
        repoRoot={REPO_ROOT}
        fallbackConfig={FALLBACK_CONFIG}
        packageScripts={PACKAGE_SCRIPTS}
        detectedAgents={{
          claude: HAS_CLAUDE,
          codex: HAS_CODEX,
          gh: false,
        }}
        agent={planningAgent}
      />

      {/* Step 2: Run the finite SuperRalph work loops (skipped for simple replies) */}
      {(ctx.latest("interpret_config", "interpret-config") as any)?.isSimpleReply !== true && (
      <SuperRalph
        ctx={ctx}
        outputs={outputs}
        {...((ctx.latest("interpret_config", "interpret-config") as any) || FALLBACK_CONFIG)}
        maxIterations={MAX_ITERATIONS}
        agents={{
          planning: { agent: planningAgent, description: "Plan and research next tickets.", isScheduler: true },
          implementation: { agent: implementationAgent, description: "Implement with test-driven development and jj workflows." },
          testing: { agent: testingAgent, description: "Run tests and validate behavior changes." },
          reviewing: { agent: reviewingAgent, description: "Review for regressions, spec drift, and correctness." },
          reporting: { agent: reportingAgent, description: "Write concise, accurate ticket status reports." },
        }}
      />
      )}

      {/* Step 3: Final report - produces the reply the CLI prints */}
      <FinalReport
        prompt={PROMPT_TEXT}
        agent={finalAgent}
        output={outputs.final_report}
      />

      {/* Step 4: Completion validation - quiescence is not completion.
          A run that stops without satisfying the original goal must never
          exit 0. valid=false fails loudly: non-zero exit, failed workflow row. */}
      <Ralph
        until={(ctx.latest("completion_validator", "completion-validator") as any)?.valid === true}
        maxIterations={1}
        onMaxReached="fail"
      >
        <CompletionValidator
          prompt={PROMPT_TEXT}
          agent={validatorAgent}
          ctx={ctx}
          output={outputs.completion_validator}
        />
      </Ralph>
    </Sequence>
  </Workflow>
));
