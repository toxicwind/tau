#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
echo "== upstream-changes status =="
echo "-- git status (tau work) --"
git -C "$ROOT" status --porcelain | head -50
echo ""
echo "-- pending patches --"
ls -lh "$ROOT/upstream-changes/patches" 2>/dev/null || echo "(no patches/)"
echo ""
echo "-- recent ingestion logs --"
ls -lt "$ROOT/upstream-changes/log" 2>/dev/null | head -10 || echo "(no log/)"
echo ""
echo "-- upstream tip vs HEAD --"
if git -C "$ROOT" remote get-url upstream &>/dev/null; then
  git -C "$ROOT" fetch upstream main --dry-run 2>&1 | head -5 || true
  echo "HEAD: $(git -C "$ROOT" rev-parse --short HEAD)"
  echo "upstream/main: $(git -C "$ROOT" rev-parse --short upstream/main 2>/dev/null || echo 'not fetched')"
  echo "Commits behind: $(git -C "$ROOT" rev-list --count HEAD..upstream/main 2>/dev/null || echo '?')"
fi
