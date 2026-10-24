#!/bin/bash
# Regenerates packages/coding-agent/src/generated/version.json from the
# current tau fork HEAD. Fork root resolves from this script's location
# (helpers/gen-version.sh -> repo root); no hardcoded paths.
set -euo pipefail
SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT="$(cd -P -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"
OUT_DIR="$ROOT/packages/coding-agent/src/generated"
BASE="${TAU_VERSION_BASE:-18.8.4}"
SHORT="$(git -C "$ROOT" rev-parse --short=8 HEAD)"
FULL="$(git -C "$ROOT" rev-parse HEAD)"
mkdir -p "$OUT_DIR"
cat > "$OUT_DIR/version.json" <<JSON
{
  "base": "${BASE}",
  "estate-scriptsMainShort": "${SHORT}",
  "estate-scriptsMainFull": "${FULL}",
  "tauShort": "${SHORT}",
  "canonical": "${BASE}+estate-scripts.tau.${SHORT}",
  "canonicalFull": "${BASE}+estate-scripts.tau.${FULL}",
  "npm": "${BASE}+estate-scripts.tau.${SHORT}",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo "[gen-version] ${BASE}+estate-scripts.tau.${SHORT}"
