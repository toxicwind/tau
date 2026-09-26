# Sovereign Pre-Release Integration Engine

> **Architectural Law**: *"Production logic is integrated DIRECTLY in code. Pre-release staging overrides resolve via clean indirection."*
> **Engine**: `/home/toxic/sovereign/src/lib/pre_release_integration.ts`
> **Integration Store**: `/home/toxic/sovereign/integrations/`
---

## 1. The Anti-Pattern vs. The Pattern

### The Anti-Pattern (Monkey Patching)
```typescript
// Fragile runtime mutation in arbitrary files:
module.someService = myCustomService; // Untracked, unversioned, lost on restart
```

### The Sovereign Pattern (Resolution Indirection)
The core codebase is designed to resolve its implementation from a persistent registry:

```text
┌────────────────────────────────────────────────────────┐
│ Core Code (Unmodified by hotfixes)                     │
│ Calls: hotfixRegistry.resolve(target, defaultImpl)     │
└───────────────────────────┬────────────────────────────┘
                            │ Queries
                            ▼
┌────────────────────────────────────────────────────────┐
│ HotfixRegistry (src/lib/hotfix_registry.ts)            │
│ In-memory overrides map + live fs.watch file reloader  │
└───────────────────────────┬────────────────────────────┘
                            │ Loads on boot & on-change
                            ▼
┌────────────────────────────────────────────────────────┐
│ Persistent Patches Directory (patches/*.ts)            │
│ Permanent, deliverable, versioned TypeScript modules   │
└────────────────────────────────────────────────────────┘
```

---

## 2. Anatomy of a Deliverable Hotfix Patch

Every patch in `sovereign/patches/` is a real, committed TypeScript module:

```typescript
// sovereign/patches/services_tau.ts
import type { ServiceDef } from "../src/types/index.ts";

export const TARGET = "services.tau";
export const VERSION = "1.1.0";
export const AUTHOR = "sovereign";
export const REASON = "Permanent .tau path resolution without monkey patching";
export const ENABLED = true;

export const impl: ServiceDef = {
  id: "tau",
  name: "tau",
  portKey: "PI_AGENT_PORT",
  run: "exec /home/toxic/sovereign/agent",
  dir: "/home/toxic",
  readyCmd: "sleep 1 && echo ready",
  group: "agents",
  autoStart: true,
  mise: true,
  env: {
    PI_CONFIG_DIR: "/home/toxic/.tau",
    PI_AGENT_DIR: "/home/toxic/.tau/agent",
    PI_CODING_AGENT: "true",
    PI_REASONING_LEVEL: "high",
    PI_SUBAGENT_MODEL: "thinkingmachines/inkling",
  },
};
```

---

## 3. Core Consumer Integration

Core modules ask the registry rather than hardcoding mutable state:

```typescript
// sovereign/src/services/registry.ts
import { hotfixRegistry } from "../lib/hotfix_registry.ts";

export const ALL_SERVICES: ServiceDef[] = [
  ...
  // Core never gets monkey patched; it resolves via the extension point:
  hotfixRegistry.resolve<ServiceDef>("services.tau", defaultTauServiceDef),
  ...
];
```

If a patch exists in `patches/`, `hotfixRegistry.resolve()` returns the live patch. If the patch is disabled or absent, it falls back to `defaultTauServiceDef` with zero runtime overhead.

---

## 4. Live Hotfix Lifecycle CLI (`hotfix`)

Management is handled via the unified `hotfix` CLI:

```bash
# List all active and disabled patches
$ hotfix list

# Temporarily or permanently disable a patch (instant fallback to core default)
$ hotfix disable services.tau

# Re-enable a patch (live reloaded into memory)
$ hotfix enable services.tau

# Check status of the registry
$ hotfix status
```

### Why This Is Permanent & Live:
1. **Permanent**: Patches are written to disk in `sovereign/patches/*.ts` and survive all daemon/process restarts.
2. **Non-Monkey-Patch**: The core codebase intentionally consumes the registry as an extension point.
3. **Zero-Downtime Live Reload**: The engine runs `fs.watch` on `sovereign/patches/`, dynamically importing updated code into memory without restarting Pitchfork or background daemons.

---

## 5. New Deliverable Hotfix — `registry.emergent_sync`

**File**: `/home/toxic/sovereign/patches/emergent_registry_sync.ts`
**Target**: `registry.emergent_sync`
**Purpose**: Connects Hindsight health (`port 25117`) with Pitchfork daemon lifecycle (`herd`, `hindsight`) through the registry resolution mechanism, only activating when both services report healthy.

```typescript
export const TARGET = "registry.emergent_sync";
export const VERSION = "1.0.0";
export const ENABLED = true;
export const impl = {
  target: TARGET,
  syncActive: true,
  guardrails: [
    "health_check: hindsight_port_25117_responds",
    "health_check: pitchfork_herd_healthy",
    "registry_resolution: uses_hotfixRegistry_resolve_not_monkey_patch",
    "persistent_store: file_written_to_patches_directory_for_restart_survival",
    "live_reload: fs_watch_with_unref_on_patch_directory_for_dsu",
  ],
};
```

This patch follows the same pattern as `services_tau.ts` and `hindsight_model.ts`: it exports `TARGET`, `VERSION`, `AUTHOR`, `REASON`, `ENABLED`, and `impl`, so the registry's `loadPatch()` and `resolve()` methods discover it automatically.

---

## 6. Live Registry Updates — Persistent Store Mechanism

The persistent store mechanism (`persistPatch` in `hotfix_registry.ts`) works as follows:
1. **Write to disk**: When `persistPatch()` is called (or a `.ts` file is placed in `patches/`), the file is written to the persistent `patchDir`. The file survives all restarts.
2. **Load on boot**: `loadAll()` scans the directory and imports every `.ts`/`.js` file (excluding `.disabled`) into `this.overrides`.
3. **Live reload (`fs.watch` + `unref`)**: `startWatcher()` creates a `fs.watch()` observer that listens for changes. When a file is edited, added, or removed, the observer calls `loadPatch()` (or deletes the override). The `.unref()` call ensures the watcher does not keep the event loop alive if it is the last active handle — this is critical for clean shutdown.
4. **Rollback**: `disablePatch()` renames the file to `.disabled` and sets `ENABLED = false`. `enablePatch()` reverses the rename and reloads.

This mechanism enables **Dynamic Software Update (DSU)**: patches apply continuously without restarting Pitchfork or any background daemon. The health-gated activation (`hindsight` port 25117 + `herd` daemon healthy) ensures partial activation never corrupts the registry state.

---

**Provider / Model References (connected to registry health-guard)**:
- **NVIDIA**: `NVIDIA_API_KEY` (configured via env / vault) → endpoint `https://integrate.api.nvidia.com/v1`.
- **OpenRouter**: `OPENROUTER_API_KEY` (configured via env / vault) → `openrouter/thinkingmachines/inkling:free` (fast tier).
- **Herd (local)**: `beellama/qwen-flash-64k` (port 25100, RTX 3090, 64K context, 119 tok/s, CUDA 86). Self-hosted, no external key.
- **Hindsight API**: `port 25117` (`/health` endpoint), verified by registry health-check guard. Independent from Herd; both must respond healthy for `registry.emergent_sync` activation.
