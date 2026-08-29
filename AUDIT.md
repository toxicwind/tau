# Oh My Pi (`pi-agent`) — Fork Audit & Architecture Map

## Verdict
**Status: Healthy & Operational.** The fork suffered from configuration drift, dead model endpoints in subagent defaults, restrictive advisor tool whitelisting, and a split between `~/.pi` and canonical `~/.omp` paths. With model routing re-anchored to active 1M-context models (`gemini-3.7-flash-tiered`, local `llama-swap`), thinking efforts corrected, and launcher CWD-awareness restored, the agent runtime is fully functional across native and MCP tools.

---

## Package Map

| Package / Crate | Role |
|---|---|
| `packages/coding-agent` | **Main CLI & TUI Agent application** (primary focus). Handles turns, prompts, tool execution, session persistence. |
| `packages/agent-core` | Low-level agent loop, tool dispatch protocol, context compaction, and append-only context manager. |
| `packages/ai` | Multi-provider streaming LLM client (OpenAI, Gemini CLI, Anthropic, Ollama, DeepSeek). |
| `packages/catalog` | Model registry, thinking config derivation, token pricing, and model capability classifier. |
| `packages/tui` | Terminal UI library with differential line rendering and ANSI sanitization. |
| `packages/natives` | JS bindings to high-performance native text/grep/image routines. |
| `packages/omptype` | ArkType-compatible lazy JIT schema validator. |
| `packages/utils` | Shared runtime utilities (centralized logger, stream handlers, path resolvers). |
| `packages/stats` | Local metrics dashboard (`omp stats`). |
| `crates/pi-natives` | Performance-critical Rust crate (SIMD grep, token estimation, string searching). |

---

## Architecture & Data Flow

```
[User / Terminal / Web]
         │
         ▼
[/home/toxic/.local/bin/pi] (CWD-aware launcher)
         │
         ▼
[packages/coding-agent/src/cli.ts] (Bun Runtime)
         │
    ┌────┴───────────────────────────────┐
    ▼                                    ▼
[Native Tools]                 [mcpproxy-go Gateway :25127]
(read, edit, write, bash,      (231 tools across 18 MCP servers)
 grep, glob, task, hub, todo)            │
                                ┌────────┴────────┐
                                ▼                 ▼
                         [ghas :25112/3]   [stdio servers]
                                           (desktop, ast, redis)
    ┌────────────────────────────────────┐
    ▼                                    ▼
[LLM Provider: google-antigravity]  [Local LLM: llama-swap :25100]
(gemini-3.7-flash 1M context)       (RTX 3090 GGUFs / AST Matrix)
```

---

## Root-Cause Analysis (Why the Fork Failed)

### 1. Subagent HTTP 400 Crash
- **Symptom**: Spawning background subagents via `task` immediately failed with `HTTP 400 Invalid JSON format For Tool Calling`.
- **Cause**: `~/.omp/agent/config.yml` had `smol: fastrouter/nvidia/nemotron-3-super:free:auto`. That free fastrouter endpoint was decommissioned.
- **Fix**: Re-routed `smol` and `default` model roles to `google-antigravity/gemini-3.7-flash-tiered`.

### 2. Gemini 3.7 Flash Thinking Effort Rejection
- **Symptom**: `completion()` calls failed with `Thinking level MINIMAL is not supported for this model`.
- **Cause**: `packages/catalog/src/model-thinking.ts` mapped `Effort.Minimal` for Gemini 3 Flash, which sent `MINIMAL` over the wire. Google API only supports `LOW`, `MEDIUM`, `HIGH`.
- **Fix**: Updated `GEMINI_3_FLASH_EFFORTS` to `[Effort.Low, Effort.Medium, Effort.High]` in `model-thinking.ts` and `models.json`.

### 3. Advisor Tool Lockdown
- **Symptom**: Watchdog advisors could not modify files or inspect build output.
- **Cause**: `ADVISOR_DEFAULT_TOOL_NAMES` in `packages/coding-agent/src/advisor/advise-tool.ts` was hardcoded to `Set(["read", "grep", "glob"])`.
- **Fix**: Expanded default advisor tools to include `bash`, `edit`, `write`, `eval`, `web_search`, `task`, `hub`, and `todo`.

### 4. Launcher CWD Drift
- **Symptom**: Running `pi` from external project directories wrote session files into `pi-agent` instead of the active directory.
- **Cause**: Old wrapper hardcoded `--cwd="/home/toxic/projects/pi-agent"`.
- **Fix**: Rewrote `/home/toxic/.local/bin/pi` to invoke `bun run <cli.ts>` without forcing `--cwd`.

### 5. `~/.pi` vs `~/.omp` State Split
- **Symptom**: Conflicting settings and blocked tools.
- **Cause**: `pi-utils` resolves configuration to `~/.omp/agent/`. An ad-hoc `~/.pi/agent/config.yaml` locked `allowed-tools` to gateway-only calls.
- **Fix**: Synchronized `~/.pi` with `~/.omp` and restored native tool declarations.

---

## Build & Runtime Commands

```bash
# Type check (Never use tsc)
bun check

# Run tests
bun test
bun run test:rs

# Launch CLI locally
bun run packages/coding-agent/src/cli.ts

# Global launcher
pi
omp --version
```

---

## Key Gotchas

1. **Bun Over Node**: Use `Bun.file()`, `Bun.write()`, `` $`cmd` ``, and `Bun.spawn()` — never Node sync primitives in async paths.
2. **No Generated File Hand-Edits**: Never edit `packages/catalog/src/models.json` directly; edit `packages/catalog/src/provider-models/` or generator scripts, then `bun run gen:models`.
3. **Class Privacy**: Use ES `#private` fields; no `private`/`public` keywords on class methods.
4. **No `ReturnType<>`**: Always declare explicit, concrete type annotations.
