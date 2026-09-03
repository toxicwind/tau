#!/usr/bin/env bash
set -euo pipefail
# ingest.sh — fetch upstreams into modules/ + generate diff log + patches (no merge to main)
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CFG="$ROOT/upstream-changes/config.yaml"
LOGDIR="$ROOT/upstream-changes/log"
PATCHDIR="$ROOT/upstream-changes/patches"
mkdir -p "$LOGDIR" "$PATCHDIR"
STAMP="$(date +%Y-%m-%d)"
LOG="$LOGDIR/ingestion-$STAMP.md"

echo "## Ingestion $STAMP — $(date -Iseconds)" | tee "$LOG"
echo "" | tee -a "$LOG"

# ensure upstream remote exists (pi)
if ! git -C "$ROOT" remote get-url upstream &>/dev/null; then
  git -C "$ROOT" remote add upstream https://github.com/earendil-works/pi.git
  echo "- added remote upstream -> earendil-works/pi" | tee -a "$LOG"
fi

echo "Fetching upstream/main..." | tee -a "$LOG"
git -C "$ROOT" fetch upstream main --prune 2>&1 | tee -a "$LOG" || true

BASE="$(git -C "$ROOT" merge-base HEAD upstream/main 2>/dev/null || git -C "$ROOT" rev-parse HEAD)"
UPSTREAM_TIP="$(git -C "$ROOT" rev-parse upstream/main 2>/dev/null || echo "unknown")"
COMMITS="$(git -C "$ROOT" log --oneline "$BASE"..upstream/main 2>/dev/null | head -50 || echo "(no new commits)")"

echo "" | tee -a "$LOG"
echo "### New upstream commits ($BASE..$UPSTREAM_TIP)" | tee -a "$LOG"
echo '```' | tee -a "$LOG"
echo "$COMMITS" | tee -a "$LOG"
echo '```' | tee -a "$LOG"

echo "" | tee -a "$LOG"
echo "### Changed files" | tee -a "$LOG"
git -C "$ROOT" diff --name-only "$BASE"..upstream/main 2>/dev/null | head -100 | tee -a "$LOG" || echo "(none)" | tee -a "$LOG"

echo "" | tee -a "$LOG"
echo "### Tau overlap warning" | tee -a "$LOG"
SOV_OVERLAP="$(git -C "$ROOT" diff --name-only "$BASE"..upstream/main 2>/dev/null | grep -E 'packages/ai/src/registry/cloudflare|AGENTS.md|tau/' || true)"
if [ -n "$SOV_OVERLAP" ]; then
  echo "⚠️ Upstream touches tau files:" | tee -a "$LOG"
  echo "$SOV_OVERLAP" | tee -a "$LOG"
else
  echo "No tau overlap." | tee -a "$LOG"
fi

# generate patches for new commits (one per commit, into patches/)
echo "" | tee -a "$LOG"
echo "### Patches generated" | tee -a "$LOG"
COUNT=0
for sha in $(git -C "$ROOT" log --reverse --pretty=format:%H "$BASE"..upstream/main 2>/dev/null | head -20); do
  short="$(git -C "$ROOT" rev-parse --short "$sha")"
  out="$PATCHDIR/$STAMP-pi-$short.patch"
  git -C "$ROOT" format-patch -1 "$sha" --stdout > "$out" 2>/dev/null && echo "- $out" | tee -a "$LOG" && COUNT=$((COUNT+1))
done
[ "$COUNT" -eq 0 ] && echo "(no patches — already up to date or no upstream)" | tee -a "$LOG"

echo "" | tee -a "$LOG"
echo "Next: ./upstream-changes/scripts/status.sh  then  ./upstream-changes/scripts/promote.sh <patch>" | tee -a "$LOG"
echo "Ingestion done. Log: $LOG"
