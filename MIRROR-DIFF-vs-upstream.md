# Tau engine/ — manual mirror-diff vs upstream oh-my-pi

Date: 2026-09-19 (MDT). Author: Hatch (subagent task 2/3).

## 1. References

- Upstream: https://github.com/can1357/oh-my-pi
- Upstream main HEAD diffed: `78b753124d11f8dd3ae73e2524125890ff7c977e` — 2026-09-18 19:27:51 +0200, `chore: bump version to 18.2.6`
- **Fork point (verified, see §2): upstream tag `v18.1.18`** — `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`, released 2026-09-11
- Our tree: `/home/toxic/sovereign/projects/tau/engine` (inside the sovereign monorepo; remote `origin` = `github.com/toxicwind/sovereign-projects`)
- Scratch: `/home/toxic/scratch/oh-my-pi-upstream-20260919` (clone of upstream main), `/home/toxic/scratch/oh-my-pi-v18.1.18` (`git archive v18.1.18`), raw diffs in `/home/toxic/scratch/mirrordiff/`

## 2. Fork-point evidence

`README-FORK.md` names **no upstream commit SHA**, so the fork point was determined empirically:

- Our `engine/packages/coding-agent/CHANGELOG.md` head is `## [18.1.18] - 2026-09-11`, byte-identical to the head of upstream `v18.1.18`'s changelog. Upstream main HEAD is at `## [18.2.6] - 2026-09-18`.
- `engine/packages/catalog/src/compat/rules/providers/anthropic.kdl` is byte-identical to upstream `v18.1.18`'s copy (upstream main HEAD's copy has since gained a `seed` block with `claude-sonnet-5`/`claude-fable-5`/`claude-mythos-5`).
- `engine/packages/catalog/src/models.json` has the identical 69-provider key set as upstream main HEAD (verified with `python3 -c json.load` on both; `set(engine) == set(upstream)`, no keys only on either side). Catalog content parity is intact at the fork.
- `engine/packages/ai/src/auth/oauth-refresh-support.ts` (sovereign, see §4.1) does **not** exist anywhere in upstream history at or before `v18.1.18`.
- `engine/packages/coding-agent/src/cli/git-tui/index.ts` **does** exist at upstream `v18.1.18` (blob `4ebbf6b1583ba1b1e9863e5d1addaaf1417a7f9b`) — it is upstream code, not a sovereign addition (earlier audits mis-attributed it).

**Conclusion: `engine/` = upstream `v18.1.18` (2026-09-11) + sovereign delta. The record diff below is computed against `v18.1.18` (the true sovereign delta). §5 additionally snapshots drift against upstream main HEAD (`78b7531…`, 7 days of upstream evolution).**

Method: `diff -r -q` of `engine/` vs the `git archive v18.1.18` tree, excluding `.git`, `node_modules`, `dist`, `build`, generated lockfiles (`bun.lock*`, `package-lock.json`, `Cargo.lock`, …), and `vendor/` (`engine/vendor/oh-my-pi` is a full `sovereign-projects` checkout, not an upstream mirror — confirmed: its HEAD is `de173502b4b0d2f8c9656b13b0d17b3129862af3` on `origin = github.com/toxicwind/sovereign-projects`).

## 3. Summary numbers

### 3a. Sovereign delta (engine/ vs upstream v18.1.18) — the fork diff

| Direction | Count | Meaning |
|---|---|---|
| Only in engine/ (sovereign additions) | **117 files** | new sovereign files/modules |
| Only in upstream v18.1.18 (dropped in fork) | **19 files** | upstream files we removed |
| Modified (differ) | **262 files** | sovereign edits |
| **Total changed paths** | **398** | |
| Diffstat | **+8,878 / −4,669 lines** | |

### 3b. Drift snapshot (engine/ vs upstream main HEAD 78b7531…, v18.2.6)

| Direction | Count |
|---|---|
| Only in engine/ | 432 files |
| Only in upstream main | 426 files |
| Modified | 1,913 files |
| **Total changed paths** | **2,771** |

§3b mixes the sovereign delta with ~7 days of upstream evolution (18.1.18 → 18.2.6). Key upstream-side moves are listed in §5 so they are not mistaken for sovereign work.

## 4. Top-10 functional sovereign diffs (vs fork point v18.1.18, all grounded in actual diffs)

### 4.1 Auth-storage refactor — 4 new sovereign modules
New: `packages/ai/src/auth/oauth-refresh-support.ts`, `storage-contract.ts`, `usage-cache-impl.ts`, `usage-metrics.ts` (plus two `.bak-20260915` copies of the cache/metrics files).
`packages/ai/src/auth-storage.ts` imports all four and re-exports their public surface (`AuthCredential`, `OAuthAccess`, `UsageCache`, …) unchanged; diffstat **+1,163/−57**. Effect: the monolithic auth-storage file is split into OAuth refresh leases (`OAUTH_REFRESH_LEASE_TTL_MS`, …), the credential storage contract, a usage-metering cache, and usage metrics/ranking. None of these four modules exists anywhere in upstream history at or before v18.1.18.

### 4.2 Hedged streaming for provider requests
New: `packages/ai/src/utils/hedged-stream.ts` + `packages/ai/test/hedged-stream.test.ts`.
HFT-inspired fail-fast policy: when the leading attempt stalls with no stream events for `hedgeStallMs` (default 5s), or no completion arrives within `hedgeAfterMs`, a duplicate of the SAME request (same model, same provider, same route, same body) is fired in parallel; first completion wins and losers are aborted. Takeover is only allowed before the leader commits replay-unsafe output (text/tool-calls/images); thinking deltas stream live from the leader. Never falls back to another model or provider. Master switch `PI_STREAM_HEDGE_ENABLED=0`.

### 4.3 BRE module divergence — deleted upstream `crates/pi-builtins/src/bre.rs`
Upstream's shared POSIX basic-regular-expression → ERE translation module (`bre.rs`, used by both `grep` and `sed`) is **deleted** in our fork (it is present in upstream v18.1.18 *and* still present at upstream main HEAD — this is a permanent, deliberate divergence).
- `crates/pi-builtins/src/grep.rs` (+254/−93): drops `use crate::bre`, adds local `normalize_basic_alternation` translating GNU BRE `\|` alternation, with a per-pattern fallback; tests rewritten (`basic_mode_is_posix_bre_and_extended_mode_is_strict` → `basic_mode_falls_back_per_pattern_but_extended_mode_is_strict`).
- `crates/pi-builtins/src/sed.rs` (+93/−154): drops `crate::bre::bre_to_ere(..., Backrefs::Supported)`, inlines its own local `fn bre_to_ere(pattern: &str) -> String` with sed-specific back-reference handling.
Re-sync risk: blindly copying upstream `grep.rs`/`sed.rs` later would resurrect the `crate::bre` import against a deleted module — this pair must be merged by hand.

### 4.4 pi-builtins `host.rs` robustness rework
`crates/pi-builtins/src/host.rs` (+243/−18): removes upstream's Sigpipe guard machinery (`Sigpipe`, `SigpipeGuard`, `ignore_sigpipe`, `sigpipe_hit`) and replaces it with panic containment at the builtin boundary (`run_caught` / `catch_unwind(AssertUnwindSafe(...))`, "containing any panic at the builtin boundary") plus a test-capture harness (`MemStream`-backed stdout/stderr capture, `StreamWriter`). The `broken_pipe_on_stdout_is_silent_and_exits_141` test survives.

### 4.5 Kimi transport for collab-web
New: `packages/collab-web/src/transports/` + `packages/collab-web/test/transports/` + `packages/collab-web/KIMI_TRANSPORT.md` (design doc, "Status: implemented, additive").
Lets Tau's existing collab-web UI drive Moonshot's kimi-code backend (`kap-server`) instead of a pi-coding-agent collab relay: REST `/api/v1` with `Authorization: Bearer <token>`, `{code, msg, data, request_id}` envelope, WS at `/api/v1/ws` with subprotocol `kimi-code.bearer.<token>`, JSON frames client→server and `EventEnvelope` server→client. Only touch to existing code: an *optional* 3rd constructor parameter on `GuestClient` (behavior-preserving).

### 4.6 RoboMP web frontend
New: `python/robomp/web/` — a Vite SPA (~30 files: `App.js`, `api.js`, `state.js`, views `Pipeline`/`Releases`/`Operations`/`Triage`/`Activity`, components `IssueCard`/`LifecycleStepper`/`Vitals`/`TopBar`/…, `work-items.js` + contract tests, `web/scripts/verify-{cards,live}.js`) plus `python/robomp/src/static`.
Note: upstream already had a `python/robomp` server at the fork point (`src/server.py`, `AGENTS.md`, `docker-compose.yml`, `Dockerfile.robomp` — all in the *modified* list, e.g. `server.py` +107/−48), so the sovereign addition is the **web UI layer**, not robomp itself.

### 4.7 Repo-identity rewrite: README, AGENTS.md, harness dirs
- `README.md` rewritten as "Tau: The Sovereign AI Agent Engine" (**+695/−41** vs upstream README; drops the upstream hero/badge marketing block).
- `AGENTS.md` **+340/−18** sovereign operator rules.
- New: `CLAUDE.md`, `AUDIT.md`, `.gitmodules` (6 sovereign submodule mirrors: `kimi-code-sovereign`, `modelbeats`, `oh-my-pi`, `pi-subagents`, `pi-upstream` → earendil-works/pi, `tinker-cookbook` — all under `github.com/toxicwind/*` except pi-upstream), `.agent/`, `.agents/`, `.claude/`, `.codex/`, `.gemini/`, `.nanocoder/`, `.env.ai`, `docs/ralph-workflow-policy`, `docs/skills/examples/{hello-extension,mini-marketplace/my-plugin,safety-hook}/index.js`, `docs/tools/inspect_image.md`.

### 4.8 `.omp` → `.tau`/`.pi` migration + file drops
- Deleted: `.omp/tools` (upstream's bundled tools dir); added `.pi/sessions`.
- Edited: `.omp/commands/fix-issues.md`, `.omp/commands/review-prs.md`, `.omp/skills/tool-prompt-optimization/SKILL.md`.
- Deleted: `.oxfmtrc.json`, `.oxlintrc.json`, `docs/tools/{context-notes,new-context}.md`, `packages/coding-agent/test/fixtures/{before-compaction,large-session}.jsonl`, `scripts/install-tests/settings-session.ts`, and the whole `crates/pi-natives/tools/cache/` tokenizer-binary set (10 files: `cl100k_base.tiktoken`, `o200k_base.tiktoken`, `ctok_v3/v4_7.bin`, `deepseek-v3/v4`, `glm-5`, `qwen3.8`, `kimi.tiktoken.model`, `tokenization_kimi.py`).

### 4.9 Nvidia provider default-model change + KDL regen
`packages/catalog/src/provider-models/descriptors.ts`: `nvidia` `defaultModel` changed `nvidia/llama-3.1-nemotron-70b-instruct` → `openai/gpt-oss-20b` (the only content change in that file vs the fork point).
`packages/catalog/src/compat/rules/{providers,auth}/nvidia.kdl` and `taxonomy/meta.kdl` edited; `compat/rules.json` regenerated (+352K vs 280K upstream — mostly pretty-print vs minified formatting). `src/models.json` is **byte-identical** to the fork point: catalog content parity (69 providers) is preserved.

### 4.10 Reconcile/build tooling + prebuilt natives
- New scripts: `scripts/reconcile.ts` (+`reconcile.ts.bak-1789200941`, `reconcile-20260912-022210.log`), `scripts/merge-workspace.ts`, `scripts/cargo-fix.ts`, `scripts/coupled-crates.json`, `scripts/fix`, `scripts/rustc-bridge`, `tau-upstream-reconcile-APPLY-20260912-014900.log`, `Cargo.toml` backups.
- New: `packages/natives/native/pi_natives.linux-x64-{baseline,modern}.node` (prebuilt native addons), `packages/coding-agent/scripts/bench-router-models.ts`, `packages/catalog/test/nvidia-wire-compat.test.ts`, `packages/tui/test/double-slash.test.ts`, `packages/ai/src/registry/api-key-login.ts`.
- Modified build plumbing: `MODULE.bazel`/`MODULE.bazel.lock` (+1,194/−145 — regenerated), `nix/bun.nix` (+454/−323), `.cargo/config.toml` (Ryzen 7 8700F build-throttle note), `bazel/toolchains/sha2-asm-cc.sh`, `Cargo.toml`, `flake.nix`, `rust-toolchain.toml`.

## 5. Upstream drift since the fork (18.1.18 → 18.2.6, 2026-09-11 → 2026-09-18) — NOT sovereign work

From the §3b drift snapshot (engine/ vs upstream main HEAD `78b7531…`):

- **Terminal UI moved to `@oh-my-pi/pi-tui`** (upstream 18.2.5 breaking change): themes, tool renderers, chat, overlay, status-line, composer, setup wizard, Git/PS/debug apps. Our `agent-session.ts` still imports `../modes/*`, `../debug/raw-sse-buffer`, `../tools/*` — the old paths. (Note: our own sovereign debug dir `packages/coding-agent/src/debug/` — `raw-sse.ts`, `raw-sse-buffer.ts`, `log-viewer.ts`, `protocol-probe.ts`, `log-formatting.ts`, `terminal-info.ts` — exists upstream only as `@oh-my-pi/pi-tui/apps/debug/*`; ours is a pre-split fork of that work.)
- New `packages/ai/src/judgment/` (chat.ts, text.ts, types.ts, typesafe.ts, text-judge*.md) — upstream text-judge tooling we don't have.
- Provider catalog: upstream `anthropic.kdl` gained a `seed` block (curated `claude-sonnet-5`/`claude-fable-5`/`claude-mythos-5` models, `default-model "claude-opus-4-8"`); new KDL providers `deepinfra`, `devin`, `gitlab-duo-agent`, `charm-hyper` (providers+auth), `stencil`, `typesafe` (auth); `anthropic-signature.ts` and `usage/charm-hyper.ts` wire additions in `packages/ai`.
- New `packages/agent/src/speculative-execution.ts` (+ compaction/speculative-commit tests).
- Upstream `crates/pi-builtins/src/bre.rs` still present (and evolved) — see §4.3.
- Cosmetic: upstream `models.json`/`rules.json` are now minified single-line (11M/280K) vs our pretty-printed copies (12M/352K) — the ~400k-line "removal" diffstat entries against main HEAD are formatting artifacts, not content loss (provider key sets are identical, 69/69).

## 6. Full changed-file list (vs fork point v18.1.18)

### 6a. Added in engine/ (117 files)

```
.agent
.agents
.backup-policy-1789241823
.cargo/config.toml.bak-1789203976
.claude
.codex
.env.ai
.gemini
.gitmodules
.nanocoder
.pi
.ralph-run.log
.recursive-excluded
AUDIT.md
CLAUDE.md
Cargo.toml.bak-20260912-020112
Cargo.toml.pre-20260912-022210
Cargo.toml.reconcile-bak-2026-09-12T08-14-08-076Z
PROMPT.md.bak-1789207487
PROMPT.md.bak-1789207616
PROMPT.md.bak-20260913-102221
PROMPT.md.bak-20260913-102749
PROMPT.md.bak-20260913-115535
PROMPT.md.pre-max-1789204690
artifacts
bazel/toolchains/sha2-asm-cc.sh
biome.json.decommissioned
bun.lock.sha256
docs/ralph-workflow-policy
docs/skills/examples/hello-extension/index.js
docs/skills/examples/mini-marketplace/my-plugin/index.js
docs/skills/examples/safety-hook/index.js
docs/tools/inspect_image.md
packages/agent/tsconfig.tsbuildinfo
packages/ai/src/auth/oauth-refresh-support.ts
packages/ai/src/auth/storage-contract.ts
packages/ai/src/auth/usage-cache-impl.ts
packages/ai/src/auth/usage-cache-impl.ts.bak-20260915
packages/ai/src/auth/usage-metrics.ts
packages/ai/src/auth/usage-metrics.ts.bak-20260915
packages/ai/src/registry/api-key-login.ts
packages/ai/src/utils/hedged-stream.ts
packages/ai/test/hedged-stream.test.ts
packages/ai/tsconfig.tsbuildinfo
packages/browser-relay/tsconfig.tsbuildinfo
packages/catalog/test/nvidia-wire-compat.test.ts
packages/catalog/tsconfig.tsbuildinfo
packages/coding-agent/bench/.boot-run-1789427092547.json
packages/coding-agent/bench/.boot-run-1789427112383.json
packages/coding-agent/scripts/bench-router-models.ts
packages/coding-agent/src/export/html/tool-views.generated.js
packages/coding-agent/tsconfig.tsbuildinfo
packages/collab-web/KIMI_TRANSPORT.md
packages/collab-web/src/transports
packages/collab-web/test/transports
packages/collab-web/tsconfig.tsbuildinfo
packages/metaharness/tsconfig.tsbuildinfo
packages/mnemopi/tsconfig.tsbuildinfo
packages/natives/native/pi_natives.linux-x64-baseline.node
packages/natives/native/pi_natives.linux-x64-modern.node
packages/omptype/tsconfig.tsbuildinfo
packages/snapcompact/tsconfig.tsbuildinfo
packages/stats/tsconfig.tsbuildinfo
packages/tui/test/double-slash.test.ts
packages/tui/tsconfig.tsbuildinfo
packages/typescript-edit-benchmark/tsconfig.tsbuildinfo
packages/utils/tsconfig.tsbuildinfo
packages/wire/tsconfig.tsbuildinfo
python/robomp/src/static
python/robomp/web/scripts/verify-cards.js
python/robomp/web/scripts/verify-live.js
python/robomp/web/src/App.js
python/robomp/web/src/api.js
python/robomp/web/src/components/Browse.js
python/robomp/web/src/components/Events.js
python/robomp/web/src/components/GlassCard.js
python/robomp/web/src/components/IssueCard.js
python/robomp/web/src/components/IssueLink.js
python/robomp/web/src/components/LifecycleStepper.js
python/robomp/web/src/components/Logs.js
python/robomp/web/src/components/Pill.js
python/robomp/web/src/components/Pipeline.js
python/robomp/web/src/components/Releases.js
python/robomp/web/src/components/ThemeToggle.js
python/robomp/web/src/components/Trigger.js
python/robomp/web/src/components/shell/Rail.js
python/robomp/web/src/components/shell/Shell.js
python/robomp/web/src/components/shell/TopBar.js
python/robomp/web/src/components/shell/Vitals.js
python/robomp/web/src/components/views/Activity.js
python/robomp/web/src/components/views/Operations.js
python/robomp/web/src/components/views/Triage.js
python/robomp/web/src/config.js
python/robomp/web/src/format.js
python/robomp/web/src/main.js
python/robomp/web/src/state.js
python/robomp/web/src/theme.js
python/robomp/web/src/types.js
python/robomp/web/src/view.js
python/robomp/web/src/work-items.contract.test.js
python/robomp/web/src/work-items.js
python/robomp/web/src/work-items.test.js
python/robomp/web/vite.config.js
runs
scripts/cargo-fix.ts
scripts/coupled-crates.json
scripts/fix
scripts/merge-workspace.ts
scripts/reconcile-20260912-022210.log
scripts/reconcile.ts
scripts/reconcile.ts.bak-1789200941
scripts/rustc-bridge
target
tau-upstream-reconcile-APPLY-20260912-014900.log
test
tools
watch_20260912-142221
```

(Cruft note: `tsconfig.tsbuildinfo`, `*.bak*`, `bench/.boot-run-*.json`, `runs/`, `test/`, `tools/`, `target/`, `watch_20260912-142221`, `.ralph-run.log` are build/scratch artifacts that were swept in — candidates for `.gitignore` or cleanup, not functional changes.)

### 6b. Removed from fork (19 files — present in upstream v18.1.18, absent in engine/)

```
.omp/tools
.oxfmtrc.json
.oxlintrc.json
crates/pi-builtins/src/bre.rs
crates/pi-natives/tools/cache/cl100k_base.tiktoken
crates/pi-natives/tools/cache/ctok_v3.bin
crates/pi-natives/tools/cache/ctok_v4_7.bin
crates/pi-natives/tools/cache/deepseek-v3.tokenizer.json
crates/pi-natives/tools/cache/deepseek-v4.tokenizer.json
crates/pi-natives/tools/cache/glm-5.tokenizer.json
crates/pi-natives/tools/cache/kimi.tiktoken.model
crates/pi-natives/tools/cache/o200k_base.tiktoken
crates/pi-natives/tools/cache/qwen3.8.tokenizer.json
crates/pi-natives/tools/cache/tokenization_kimi.py
docs/tools/context-notes.md
docs/tools/new-context.md
packages/coding-agent/test/fixtures/before-compaction.jsonl
packages/coding-agent/test/fixtures/large-session.jsonl
scripts/install-tests/settings-session.ts
```

### 6c. Modified (262 files)

```
AGENTS.md
bazel/clippy.bazelrc
bazel/toolchains/BUILD.bazel
bunfig.toml
bun.lock
.cargo/config.toml
Cargo.toml
crates/pi-ast/src/language/mod.rs
crates/pi-builtins/BUILD.bazel
crates/pi-builtins/Cargo.toml
crates/pi-builtins/src/cat.rs
crates/pi-builtins/src/command.rs
crates/pi-builtins/src/cut.rs
crates/pi-builtins/src/date.rs
crates/pi-builtins/src/fd.rs
crates/pi-builtins/src/find.rs
crates/pi-builtins/src/grep.rs
crates/pi-builtins/src/head.rs
crates/pi-builtins/src/host.rs
crates/pi-builtins/src/lib.rs
crates/pi-builtins/src/ps.rs
crates/pi-builtins/src/rg.rs
crates/pi-builtins/src/sed.rs
crates/pi-builtins/src/seq.rs
crates/pi-builtins/src/tail.rs
crates/pi-builtins/src/tee.rs
crates/pi-builtins/src/top.rs
crates/pi-builtins/src/ts.rs
crates/pi-builtins/src/yes.rs
crates/pi-iso/src/apfs.rs
crates/pi-iso/src/lib.rs
crates/pi-iso/src/linux_reflink.rs
crates/pi-iso/src/windows_block_clone.rs
crates/pi-shell/src/minimizer/filters/docker.rs
crates/pi-shell/src/process.rs
crates/pi-shell/src/shell.rs
crates/pi-vcs/Cargo.toml
crates/pi-vcs/src/git/diff.rs
crates/pi-vcs/src/git/mod.rs
crates/pi-vcs/src/git/mutate.rs
crates/pi-vcs/src/git/patch.rs
crates/pi-vcs/src/git/read.rs
crates/pi-vcs/src/jj/ops.rs
crates/pi-voice/src/device/wasapi.rs
crates/pi-walker/src/lib.rs
deny.toml
Dockerfile.dockerignore
Dockerfile.robomp
Dockerfile.robomp.dockerignore
.dockerignore
docs/advisor-watchdog.md
docs/agent-hub.md
docs/ai-schema-normalize.md
docs/approval-mode.md
docs/auth-broker-gateway.md
docs/bash-tool-runtime.md
docs/cli-reference.md
docs/collab.md
docs/compaction.md
docs/computer-use.md
docs/config-usage.md
docs/context-files.md
docs/custom-tools.md
docs/environment-variables.md
docs/ERRATA-GPT5-HARMONY.md
docs/extension-loading.md
docs/extensions.md
docs/fs-scan-cache-architecture.md
docs/hooks.md
docs/install-id.md
docs/keybindings.md
docs/local-models.md
docs/lsp-config.md
docs/macos-signing-notarization.md
docs/magic-keywords.md
docs/marketplace.md
docs/mcp-config.md
docs/mcp-runtime-lifecycle.md
docs/mcp-server-tool-authoring.md
docs/memory.md
docs/mnemosyne-memory-backend.md
docs/models.md
docs/native-crates.md
docs/natives-addon-loader-runtime.md
docs/natives-architecture.md
docs/natives-binding-contract.md
docs/natives-build-release-debugging.md
docs/natives-media-system-utils.md
docs/natives-shell-pty-process.md
docs/natives-text-search-pipeline.md
docs/non-compaction-retry-policy.md
docs/notebook-tool-runtime.md
docs/omptype-guide.md
docs/plugin-manager-installer-plumbing.md
docs/porting-from-pi-mono.md
docs/porting-to-natives.md
docs/prewalk.md
docs/provider-endpoint-constraints.md
docs/provider-quirks.md
docs/providers.md
docs/provider-streaming-internals.md
docs/python-repl.md
docs/rulebook-matching-pipeline.md
docs/sdk.md
docs/secrets.md
docs/session.md
docs/session-operations-export-share-fork-resume.md
docs/session-switching-and-recent-listing.md
docs/settings.md
docs/skills/authoring-extensions.md
docs/skills/authoring-hooks.md
docs/skills/authoring-marketplaces.md
docs/skills/examples/hello-extension/README.md
docs/skills/examples/mini-marketplace/README.md
docs/skills/examples/safety-hook/README.md
docs/skills.md
docs/slash-command-internals.md
docs/system-prompt-customization.md
docs/task-agent-discovery.md
docs/theme.md
docs/toolconv/minimax.md
docs/toolconv/pi-native.md
docs/toolconv/xml.md
docs/tools/ask.md
docs/tools/ast-grep.md
docs/tools/browser.md
docs/tools/computer.md
docs/tools/debug.md
docs/tools/eval.md
docs/tools/generate_image.md
docs/tools/github.md
docs/tools/glob.md
docs/tools/grep.md
docs/tools/hub.md
docs/tools/learn.md
docs/tools/lsp.md
docs/tools/manage_skill.md
docs/tools/memory_edit.md
docs/tools/read.md
docs/tools/recall.md
docs/tools/rewind.md
docs/tools/task.md
docs/tools/tts.md
docs/tools/web_search.md
docs/tools/write.md
docs/tree.md
docs/ttsr-injection-lifecycle.md
docs/tui.md
docs/tui-runtime-internals.md
docs/user-facing-packages.md
flake.nix
.github/PULL_REQUEST_TEMPLATE.md
.github/workflows/ci.yml
.github/workflows/nix.yml
.gitignore
MODULE.bazel
MODULE.bazel.lock
nix/bun.nix
nix/dev-shell.nix
.omp/commands/fix-issues.md
.omp/commands/review-prs.md
.omp/skills/tool-prompt-optimization/SKILL.md
package.json
packages/agent/package.json
packages/agent/tsconfig.json
packages/ai/package.json
packages/ai/README.md
packages/ai/src/auth-storage.ts
packages/ai/src/registry/cloudflare-ai-gateway.ts
packages/ai/src/stream.ts
packages/ai/src/utils/idle-iterator.ts
packages/ai/test/transform-messages-redact-sensitive.test.ts
packages/ai/tsconfig.json
packages/browser-relay/tsconfig.json
packages/catalog/package.json
packages/catalog/src/compat/rules/auth/nvidia.kdl
packages/catalog/src/compat/rules.json
packages/catalog/src/compat/rules/providers/nvidia.kdl
packages/catalog/src/compat/rules/taxonomy/meta.kdl
packages/catalog/src/provider-models/descriptors.ts
packages/catalog/test/compat-taxonomy.test.ts
packages/catalog/tsconfig.json
packages/coding-agent/package.json
packages/coding-agent/scripts/bench-title-models.ts
packages/coding-agent/src/advisor/watchdog.ts
packages/coding-agent/src/capability/index.ts
packages/coding-agent/src/capability/types.ts
packages/coding-agent/src/cli/agents-cli.ts
packages/coding-agent/src/cli/help-extra.ts
packages/coding-agent/src/config/settings-schema.ts
packages/coding-agent/src/config/settings.ts
packages/coding-agent/src/config.ts
packages/coding-agent/src/discovery/agents.ts
packages/coding-agent/src/discovery/builtin.ts
packages/coding-agent/src/discovery/helpers.ts
packages/coding-agent/src/discovery/omp-extension-roots.ts
packages/coding-agent/src/extensibility/plugins/loader.ts
packages/coding-agent/src/modes/components/extensions/inspector-model.ts
packages/coding-agent/src/session/turn-recovery.ts
packages/coding-agent/src/task/commands.ts
packages/coding-agent/src/task/discovery.ts
packages/coding-agent/src/tools/read.ts
packages/coding-agent/test/agent-session-retry-cap.test.ts
packages/coding-agent/test/secrets-obfuscator.test.ts
packages/coding-agent/tsconfig.json
packages/collab-web/package.json
packages/collab-web/src/lib/client.ts
packages/collab-web/tsconfig.json
packages/metaharness/package.json
packages/metaharness/tsconfig.json
packages/mnemopi/package.json
packages/mnemopi/tsconfig.json
packages/omptype/tsconfig.json
packages/snapcompact/package.json
packages/snapcompact/tsconfig.json
packages/stats/package.json
packages/stats/tsconfig.json
packages/tui/package.json
packages/tui/src/autocomplete.ts
packages/tui/src/tui.ts
packages/tui/src/utils.ts
packages/tui/tsconfig.json
packages/typescript-edit-benchmark/package.json
packages/typescript-edit-benchmark/tsconfig.json
packages/utils/package.json
packages/utils/src/dirs.ts
packages/utils/src/logger.ts
packages/utils/src/stderr-guard.ts
packages/utils/tsconfig.json
packages/wire/tsconfig.json
python/robomp/AGENTS.md
python/robomp/docker-compose.yml
python/robomp/.env.example
python/robomp/README.md
python/robomp/src/server.py
python/robomp/tests/test_server.py
python/robomp/web/src/work-items.contract.test.ts
README.md
rust-toolchain.toml
scripts/bazel-natives.ts
scripts/ci-release-build-binaries.test.ts
scripts/ci-release-build-binaries.ts
scripts/ci-release-publish.ts
scripts/ci-test-ts.ts
scripts/claude-trace.ts
scripts/cleanup-scan.ts
scripts/eval-bench-runs.ts
scripts/fix-changelogs.ts
scripts/fix-emit-extensions.ts
scripts/gen-clippy-bazelrc.ts
scripts/gen-nix-bun.test.ts
scripts/gen-nix-bun.ts
scripts/inline-functions.ts
scripts/install.ps1
scripts/install-tests/run-ci.sh
scripts/rewrite-changelog.ts
scripts/rewrite-system-prompt.ts
scripts/session-stats/audit.ts
scripts/session-stats/README.md
scripts/tool-prompt-usage.ts
tsconfig.json
tsconfig.tools.json
```

## 7. Diffstat — largest deltas (vs fork point v18.1.18, `path|+added|−removed`)

Top by added lines (our largest edits/additions):

```
MODULE.bazel.lock|1194|145
packages/ai/src/auth-storage.ts|1163|57
README.md|695|41
nix/bun.nix|454|323
AGENTS.md|340|18
crates/pi-builtins/src/grep.rs|254|93
crates/pi-builtins/src/host.rs|243|18
package.json|211|182
bun.lock|160|86
crates/pi-iso/src/apfs.rs|148|1
docs/provider-quirks.md|136|140
packages/ai/package.json|135|135
docs/tools/read.md|130|107
docs/tools/browser.md|129|261
crates/pi-shell/src/shell.rs|123|27
crates/pi-vcs/src/jj/ops.rs|120|122
python/robomp/tests/test_server.py|107|48
docs/compaction.md|104|46
```

Top by removed lines (largest upstream content we cut/rewrote):

```
nix/bun.nix|454|323
docs/tools/browser.md|129|261
package.json|211|182
crates/pi-vcs/src/git/diff.rs|59|160
crates/pi-builtins/src/sed.rs|93|154
MODULE.bazel.lock|1194|145
docs/provider-quirks.md|136|140
packages/ai/package.json|135|135
crates/pi-vcs/src/jj/ops.rs|120|122
crates/pi-vcs/src/git/mutate.rs|29|122
docs/tools/read.md|130|107
crates/pi-builtins/src/grep.rs|254|93
```

## 8. How to re-sync (manual procedure)

No mechanical merge is possible: `engine/` was committed as a plain tree (no oh-my-pi git history in the sovereign monorepo). Re-sync is diff-and-apply by hand:

1. **Refresh the upstream mirror.** Keep a dated clone, e.g. `/home/toxic/scratch/oh-my-pi-upstream-<YYYYMMDD>`; `git pull origin main` inside it, or clone fresh. Record the exact SHA and date (`git rev-parse HEAD`).
2. **Extract the baseline.** If re-syncing from a tag: `git archive <tag> | tar -x -C /home/toxic/scratch/oh-my-pi-<tag>`. Keep a `SYNC-BASELINE.txt` (tag + SHA + date) next to the report so the next diff starts from the right point. Current baseline: `v18.1.18` = `00085d4e7dfdcfbf302c122fa2682b410a0f43d1` (2026-09-11).
3. **Diff three ways.**
   - `diff -r -q --exclude=.git --exclude=node_modules --exclude=dist --exclude=build --exclude=bun.lock* --exclude=Cargo.lock --exclude=vendor engine/ <baseline-tree>` → **sovereign delta** (ours).
   - `diff -r -q <same excludes> <baseline-tree> <upstream-head-tree>` → **upstream evolution** (theirs).
   - Apply upstream-evolution hunks onto engine/, skipping any that collide with the sovereign delta list in §6 (sovereign-owned files win; merge conflicts by hand).
4. **Permanent divergences to merge by hand, never copy blindly:**
   - `crates/pi-builtins/src/{bre.rs,grep.rs,sed.rs}` — we deleted `bre.rs` and inlined BRE handling; upstream still ships `bre.rs`. Copying upstream `grep.rs`/`sed.rs` verbatim resurrects a `crate::bre` import against a deleted module.
   - `packages/ai/src/auth-storage.ts` + `packages/ai/src/auth/*` — upstream is evolving its own auth layout (`utils/retry-after`, `usage/charm-hyper`); our four-module split must be preserved and upstream hunks rebased onto it.
   - `packages/coding-agent/src/debug/*` vs upstream `@oh-my-pi/pi-tui` — upstream moved TUI modules to a new package in 18.2.5; our pre-split copies need a deliberate port, not a copy.
5. **Regenerate compiled artifacts** after any KDL edit: `packages/catalog/src/compat/rules.json` (compiled from `src/compat/rules/**/*.kdl`); `src/models.json` only if the model census changes. Note the formatting trap: upstream now minifies these (single-line); ours are pretty-printed — keep one convention and note it in the commit.
6. **Commit additively** in the sovereign monorepo (`projects/tau/MIRROR-DIFF-vs-upstream.md` updated each sync), push, and verify remote HEAD == local HEAD via `git ls-remote`.

Supersedes: the 2026-09-08 `engine-vendor-diff.csv` (414 differences vs `engine/vendor/oh-my-pi`) is obsolete as an upstream record — `engine/vendor/oh-my-pi` is a `sovereign-projects` checkout (origin `github.com/toxicwind/sovereign-projects`), not an upstream mirror. This report is the first direct diff against `github.com/can1357/oh-my-pi`.
