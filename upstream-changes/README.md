# upstream-changes — Modular Upstream Ingestion

> **Keep sovereign work isolated from upstream churn.** Every `git fetch upstream` lands here first, not in `main`.

Upstream: `earendil-works/pi` (→ `can1357/oh-my-pi` + `badlogic/pi-mono`) is the moving target. Tau tracks it but never lets it overwrite sovereign deltas. This folder is the **airlock**.

## Layout
```
upstream-changes/
  README.md                # this file — the contract
  config.yaml              # sources + branch + auto-merge policy
  scripts/
    ingest.sh              # 1-command fetch → diff → patch
    promote.sh             # promote vetted change to main
    status.sh              # what’s pending from upstream?
  modules/
    pi/                    # mirror of earendil-works/pi main
    pi-mono/               # mirror of badlogic/pi-mono (if needed)
  patches/
    *.patch                # cherry-picked or adapted upstream commits
  log/
    ingestion-*.md         # per-ingestion decision log
```

## Sources (`config.yaml`)
```yaml
upstreams:
  pi:
    url: https://github.com/earendil-works/pi.git
    branch: main
    local_mirror: modules/pi
  pi-mono:
    url: https://github.com/badlogic/pi-mono.git
    branch: main
    local_mirror: modules/pi-mono
policy:
  auto_merge: false   # never — human promotes
  keep_sovereign: [packages/ai/src/registry/*, packages/ai/src/providers/anthropic*]
```

## Workflow — 3 commands, no surprises

**1) Ingest (fetch + diff, no merge)**
```bash
./upstream-changes/scripts/ingest.sh
# -> fetches pi/main into modules/pi, writes log/ingestion-YYYY-MM-DD.md
#    with: new commits, file-list, conflict risk, sovereign-overlap
```

**2) Review**
```bash
./upstream-changes/scripts/status.sh
# shows: pending patches in patches/, unapplied commits, overlap with sovereign files
# open log/ingestion-*.md and patches/*.patch — decide keep / adapt / drop
```

**3) Promote (one patch at a time)**
```bash
./upstream-changes/scripts/promote.sh patches/2026-09-02-pi-abc1234.patch
# -> applies to a temp worktree, runs bun tsc --noEmit + bun test, then cherry-picks to main
```

## Rules (modular, not monolithic)
- **No direct `git merge upstream/main` into `main`.** Always via `modules/pi` + `patches/`.
- **One upstream commit = one patch** in `patches/` (or a squashed logical group with `Co-authored-by: upstream`).
- **Sovereign files never auto-overwritten**: `packages/ai/src/registry/cloudflare*`, `AGENTS.md`, `sovereign/` etc. are in `policy.keep_sovereign`.
- **Every promotion has a log** in `log/` — what changed, why kept/dropped, test result.
- **Full tasks stay visible**: ingestion does NOT hide local work — `git status` + `status.sh` surface both.

## Adding a new upstream
1. Add entry to `config.yaml` under `upstreams`
2. `mkdir -p modules/<name> && git clone --bare <url> modules/<name>.git` (or let `ingest.sh` do it)
3. Run `ingest.sh` — new source appears in next log.

---
*Created 2026-09-02 as part of full-grade push. See tau `README.md` → Credits & Lineage for upstream attribution.*
