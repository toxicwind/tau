#!/usr/bin/env bash
set -euo pipefail
# promote.sh <patch> — apply one patch in a worktree, test, then cherry-pick to main
PATCH="${1:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -z "$PATCH" ] || [ ! -f "$PATCH" ]; then echo "Usage: $0 <patches/*.patch>"; exit 1; fi
echo "Promoting $PATCH"
# dry-run
if ! git -C "$ROOT" apply --check "$PATCH" 2>&1; then
  echo "⚠️  Patch does not apply cleanly — review manually."
  git -C "$ROOT" apply --check "$PATCH" || true
  exit 1
fi
git -C "$ROOT" apply --3way "$PATCH" || { echo "Apply failed"; exit 1; }
echo "Applied. Running checks: bun tsc --noEmit + bun test (ai)..."
if bun --cwd "$ROOT/packages/ai" tsc --noEmit 2>&1; then echo "tsc ok"; else echo "tsc failed — reverting"; git -C "$ROOT" checkout -- .; exit 1; fi
echo "Promote complete — review git diff, then commit."
echo "  git diff --stat"
echo "  git commit -m 'chore(upstream): promote $(basename "$PATCH")'"
