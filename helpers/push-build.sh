#!/bin/bash
set -euo pipefail
set -a; source "$HOME/sovereign/config/.secrets" 2>/dev/null || true; set +a
ROOT="/home/toxic/sovereign/projects/tau"
REPO=$(basename "$ROOT")
PKG="$ROOT/packages/coding-agent/package.json"
VER_BASE=$(jq -r .version "$PKG" 2>/dev/null || echo "18.3.0")
VER_BASE=${VER_BASE#tau/main-}
VER_BASE=${VER_BASE%%-sovereign-tau-*}
SOV_ROOT="$HOME/sovereign"
SOV_SHA=$(git -C "$SOV_ROOT" rev-parse --short=8 HEAD 2>/dev/null || echo "nosov")
SOV_FULL=$(git -C "$SOV_ROOT" rev-parse HEAD 2>/dev/null || echo "nosov")
TAU_SHA=$(git -C "$ROOT" rev-parse --short=8 HEAD 2>/dev/null || echo "notau")
CANONICAL="tau/main-${VER_BASE}-sovereign-tau-${SOV_SHA}"
QUEUE_DIR="$HOME/buildsrv/queue"
mkdir -p "$QUEUE_DIR"
bash "$ROOT/helpers/gen-version.sh"
HASH=$(tar -cf - -C "$ROOT" packages/coding-agent/src/generated/version.json 2>/dev/null | sha256sum | cut -c1-8)
TS=$(date -u +%Y%m%dT%H%M%SZ)
SAFE_CANONICAL=$(echo "$CANONICAL" | tr '/' '_')
QF="$QUEUE_DIR/${SAFE_CANONICAL}-${TAU_SHA}-${TS}.json"
cat <<JSON > "$QF"
{
  "repo": "${REPO}",
  "root": "${ROOT}",
  "versionBase": "${VER_BASE}",
  "canonical": "${CANONICAL}",
  "canonicalFull": "tau/main-${VER_BASE}-sovereign-tau-${SOV_FULL}",
  "sovereignMainShort": "${SOV_SHA}",
  "sovereignMainFull": "${SOV_FULL}",
  "tauShort": "${TAU_SHA}",
  "artifactHash": "${HASH}",
  "timestamp": "${TS}",
  "build": {
    "command": "bun install && bun run build",
    "cwd": "${ROOT}",
    "output": "packages/coding-agent/dist"
  },
  "deploy": {
    "strategy": "npm-publish-and-bun-link",
    "bin": "/.local/bin/omp",
    "forks": ["/.tau"]
  }
}
JSON
echo "[buildsrv] queued $QF"
echo "[buildsrv] canonical=$CANONICAL"
ls -lh "$QF"
