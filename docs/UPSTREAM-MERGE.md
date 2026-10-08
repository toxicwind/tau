# Upstream Merge Workflow — tau ↔ tau

**Upstream:** https://github.com/toxicwind/tau
**Fork point:** base `dacdef24a37f40b55601d2394372b6898c439e57` (upstream 18.3.0)
**Our HEAD:** `9c7643f918` (2026-10-08)
**Upstream HEAD:** `40e9368ef0` (upstream 18.8.4, as of 2026-10-08)

> Live SHAs are pinned in `.upstream-sync.json`; the values above are the
> snapshot that produced the current merge plan. Re-run `bun scripts/upstream-pull.ts`
> to refresh them.

> **Correction (2026-09-30):** `MIRROR-DIFF-vs-upstream.md` (2026-09-19) names
> `v18.1.18` as the fork point. This is wrong. Our initial commit
> (`141e270e2c`, "Initial commit: Tau 18.3.0 monorepo") is a squash-import of
> upstream `v18.3.0`. The true sovereign delta is **234 paths** (+2,111/−2,197
> lines, excluding docs), not 398.

## Why `git merge` doesn't work

This fork was created by **squashing upstream into a single commit** — there is
no shared git history. `git merge-base origin/main upstream/main` returns empty.

```
$ git merge-base origin/main upstream/main
(empty — no common ancestor)
```

A standard `git merge upstream/main` would treat every file as an add/add
conflict. Don't try it.

## The workflow: `scripts/upstream-pull.ts`

We have a purpose-built merge tool: **`scripts/upstream-pull.ts`** (953 lines).
It performs an ancestry-free three-way merge using the fork point as base.

### How it works (4 layers)

1. **Fork-point detection** — Recovers the base from upstream's version-bump
   history (not ancestry). Currently detects `dacdef24a3` (upstream 18.3.0).
   Pass `--record-base` to pin it in `.upstream-sync.json` for determinism.

2. **Realign / Replay** — Our tree renames upstream packages
   (`@tau/tau-coding-agent` → `tau`, 1,137 imports). The script rewrites our
   names back to upstream's in a staging copy, merges, then replays ours forward.
   The rename becomes invisible to the merge engine.

3. **Weave + Suture** (per path, cheapest correct tool):
   - **Upstream untouched** → keep ours
   - **We untouched** → `suture` (byte-exact patch with blake3 verification)
   - **Both touched** → `weave` (entity-level three-way merge)
   - **Manifests** (`package.json`, `tsconfig`, `Cargo.toml`) → always `weave`

4. **Manifest coherence** — Validates workspace manifests after merge
   (version formats, catalog: ranges, workspace links).

### Usage

```bash
# 1. Add the upstream remote (one-time)
git remote add upstream https://github.com/toxicwind/tau.git

# 2. Fetch upstream
git fetch upstream

# 3. Dry run (default) — plan, gates, conflicts, no writes
bun scripts/upstream-pull.ts

# 4. Pin the fork point for deterministic future pulls
bun scripts/upstream-pull.ts --record-base

# 5. Apply (writes result into working tree — review before committing)
bun scripts/upstream-pull.ts --apply
```

### ⚠️ External tool dependencies (BLOCKER as of 2026-09-30)

The merge engines are **not installed**:

| Tool | Expected at | Purpose |
|------|-------------|---------|
| `weave-driver` | `/usr/bin/weave-driver` or `~/.cargo/bin/weave-driver` | Entity-level 3-way merge |
| `suture` | `~/.cargo/bin/suture` or `/usr/bin/suture` | Byte-exact patch application |

Without these, the script fails after the planning phase:
```
error: no working weave driver found
```

**The dry-run planning phase works** (fork detection, manifest checks) but the
actual merge cannot proceed until these tools are sourced. See "Manual fallback"
below for merging without them.

### What the dry-run tells you (2026-09-30 test)

```
Upstream pull plan
  base    dacdef24a3 (upstream 18.3.0)
  ours    9c7643f91
  theirs  40e9368ef (upstream 18.8.4)
  ancestry UNRELATED — git merge impossible, entity merge in use

Manifest coherence:
  - packages/coding-agent/package.json: non-semver version
    "tau/main-18.3.0-sovereign-tau-d83c686" breaks catalog: ranges
  - packages/metaharness/package.json: link: spec bypasses workspace
  - packages/typescript-edit-benchmark/package.json: link: spec bypasses workspace
```

The manifest issues are pre-existing and should be fixed independently of any
upstream pull.

## Manual fallback (without weave-driver/suture)

If the merge tools aren't available, pull upstream changes manually:

1. **Identify what changed upstream** since our fork point:
   ```bash
   git fetch upstream
   # List upstream commits since 18.3.0
   git log --oneline v18.3.0..upstream/main | head -50
   ```

2. **For each upstream change**, decide:
   - **Security/bug fix** → cherry-pick the specific commit's changes manually
   - **Feature we want** → port it, adapting to our renames (`tau` vs `@tau/...`)
   - **Feature we don't need** → skip, note in `.upstream-sync.json`

3. **Our protected areas** (never overwrite with upstream):
   - `packages/catalog/src/compat/tack.ts` (our provider)
   - `packages/coding-agent/scripts/tau` (our launcher)
   - `scripts/` utilities (`fix-external-deps.mjs`, `upstream-pull.ts`, etc.)
   - `assets/tau-hero.png` (branding)
   - All 128 modified files — review each upstream change for conflicts

4. **Verify after manual merge**:
   ```bash
   bun install
   bun run typecheck
   bun test packages/coding-agent/test/
   ```

## Our patch inventory (vs v18.3.0, 2026-09-30)

| Category | Count | Details |
|----------|-------|---------|
| New files (ours) | 23 | `tack.ts`, `tau` launcher, `sm86-moe-bench.ts`, scripts, assets, docs |
| Modified files | 128 | Our patches to upstream code (+2,111/−2,197 lines) |
| Dropped | ~1 | `crates/tau-natives/tools/cache` (build artifact) |
| Docs (ours, not tracked upstream) | ~82 | We maintain our own `docs/` |

Full file lists: run the diff yourself —
```bash
git archive v18.3.0 | tar -x -C /tmp/upstream-base
diff -r -q . /tmp/upstream-base --exclude=.git --exclude=node_modules \
  --exclude=dist --exclude=build --exclude=vendor
```

## Merge cadence recommendation

- **Check upstream monthly** for security fixes (or when upstream cuts a minor version)
- **Don't chase every patch release** — our delta is small and stable
- **Always dry-run first**, review the plan, then `--apply` on a feature branch
- **Never merge directly to main** — use a `upstream-merge-YYYYMMDD` branch, test, then merge

## Files

- `scripts/upstream-pull.ts` — the merge tool
- `.upstream-sync.json` — pinned fork point (created by `--record-base`)
- `MIRROR-DIFF-vs-upstream.md` — 2026-09-19 audit (fork point is wrong, see correction above)
- This file — the workflow
