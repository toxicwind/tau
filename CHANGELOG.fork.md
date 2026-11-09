# Changelog — Tau Fork Architectural Deltas

All real architectural modifications in this fork relative to upstream (`can1357/oh-my-pi`), verified via Trio AST comparison and git log forensics.

---

## 1. Native Loader & Modularization (`packages/natives`)
- **Loader Modularization**: Decomposed monolithic 1,136-line `loader-state.js` into 5 clean TypeScript submodules under 310 lines each:
  - `loader-cache.ts`: Cache directory lifecycle, version ordering, cleanup grace windows.
  - `loader-candidates.ts`: Candidate resolution, filename preferences, Windows staging predicates.
  - `loader-variant.ts`: Pure AVX2 detection across Linux (`/proc/cpuinfo`), macOS (`sysctl`), and Windows (`bun:ffi` + `pwsh`).
  - `loader-validation.ts`: Binding validation, version sentinels (`__tauNativesV*`), and stale addon stubs.
  - `loader-state.ts`: Orchestrator and `loadNative()` entrypoint.
- **Bug Fix**: Fixed undefined `version` reference in `describeLoadedAddon` that caused native addon loading failure.
- **Multi-prefix Addon Embedding**: Updated `embed-native.ts` to locate both `tau_natives` and `pi_natives` binary artifacts across platforms.

## 2. Dynamic Workspace CWD Resolution (`packages/utils`)
- **Config-Driven Project Root**: Added `resolveConfiguredDefaultDir()` in `dirs.ts`.
- **Zero-Hardcoding Doctrine**: Reads `workspace.defaultDir` dynamically from `~/.tau/agent/config.yml` (and `TAU_WORKSPACE_DIR` / `TAU_DEFAULT_DIR` env vars). When launched from `~`, `~/tmp`, or `/tmp`, tau automatically anchors to the configured workspace root (`~/pens`) rather than scratch directories.

## 3. Local Model Routing & Freeinference Coercion (`packages/ai`, `packages/catalog`)
- **Mimetite Catalog Integration**: Bound `@toxicwind/mimetite` (`geode/products/mimetite`) into `@tau/tau-catalog` as the single source of truth for model context lengths and provider definitions.
- **Estate Router Loopback**: Replaced external API dependencies (Groq/OpenRouter) in AI conflict resolution with the local estate router (`127.0.0.1:25193` with `freeinference/qwen3.6-35b`), featuring automatic fallback to local policy.
- **Payload Coercion**: Built-in request normalization for Freeinference and DeepSeek endpoints, including thinking-budget clamping and in-flight concurrency queues with 429 backoff.

## 4. Turn-Storm Defense (TTSR) (`packages/coding-agent`, `packages/tui`)
- **Turn-Storm Gate**: Settled-per-turn gating preventing recursive self-reinforcing prompt-injection loops (48/48 TDD test coverage).
- **Tool Result Safety**: Suppressed redundant retry storms on transient provider timeouts.

## 5. Virtual Tool Devices (`xd://`) & MCP Bridge (`packages/coding-agent`)
- **Virtual Devices**: Zero-overhead URI-based tool discovery and execution via `read xd://<tool>` and `write xd://<tool>`.
- **Stdio MCP Server (`tau-mcp`)**: Native stdio MCP server exposing `tau_prompt` and `tau_status` directly to orchestration tools (Thresher, Argos).
- **Headless SDK**: Exported `createAgentSession`, `discoverModels`, `ModelRegistry`, `SessionManager`, and `SettingsManager` from `@tau/tau-coding-agent`.

## 6. Upstream Pull Engine (`scripts/upstream-pull.ts`)
- **Hermetic TDD Suite**: Extracted pure merge and gate logic into `scripts/upstream-pull-core.ts` with unit tests (`scripts/upstream-pull-core.test.ts`).
- **Conflict Resilience**: Enhanced marker parser to recognize trailing weave annotations (`<<<<<<< ours — scope ...`) and automatically strip merge residue comments.
- **Manifest Coherence Gate**: Automated validation ensuring workspace dependencies, catalogs, and versions agree before and after merges.

## 7. Desktop & Hyprland Automation (`crates/tau-natives`, `packages/coding-agent`)
- **Hyprland IPC**: Native Wayland socket automation, window focusing (`focusaddr`), and `grim` region capture.
- **Wayland Pipewire Screencast**: Native screencast feature flag support in `tau-natives`.

## 8. Session Persistence & Detached Keeper (`packages/coding-agent`)
- **Detached Session Keeper**: Live sessions survive terminal/TUI exits and detachments without aborting background execution.
- **Machine-Wide Agent Registry**: Multi-process discovery via Unix domain sockets in `~/.tau/run/world-agents` for `agent://` cross-session visibility.
