#!/bin/bash
set -euo pipefail
ROOT="/home/toxic/sovereign/projects/tau"
TAU_PKG="$ROOT/packages/coding-agent/package.json"
SOV_ROOT="$HOME/sovereign"
VER_BASE=$(jq -r .version "$TAU_PKG" 2>/dev/null || echo "18.3.0")
VER_BASE=${VER_BASE#tau/main-}
VER_BASE=${VER_BASE%%-sovereign-tau-*}
if git -C "$SOV_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    SOV_MAIN_SHA=$(git -C "$SOV_ROOT" rev-parse --short=8 HEAD)
    SOV_MAIN_FULL=$(git -C "$SOV_ROOT" rev-parse HEAD)
else
    SOV_MAIN_SHA="nosov"
    SOV_MAIN_FULL="nosov"
fi
TAU_SHA=$(git -C "$ROOT" rev-parse --short=8 HEAD 2>/dev/null || echo "notau")
CANONICAL="tau/main-${VER_BASE}-sovereign-tau-${SOV_MAIN_SHA}"
CANONICAL_FULL="tau/main-${VER_BASE}-sovereign-tau-${SOV_MAIN_FULL}"
NPM_META="${VER_BASE}+sovereign.tau.${SOV_MAIN_SHA}"
mkdir -p "$ROOT/packages/coding-agent/src/generated"
cat <<JSON > "$ROOT/packages/coding-agent/src/generated/version.json"
{
  "base": "${VER_BASE}",
  "sovereignMainShort": "${SOV_MAIN_SHA}",
  "sovereignMainFull": "${SOV_MAIN_FULL}",
  "tauShort": "${TAU_SHA}",
  "canonical": "${CANONICAL}",
  "canonicalFull": "${CANONICAL_FULL}",
  "npm": "${NPM_META}",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo "[gen-version] canonical(npm:${NPM_META})"
