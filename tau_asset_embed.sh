#!/usr/bin/env bash
set -uo pipefail
TAU="$HOME/estate/ranch/tau"
CA="$TAU/packages/coding-agent"
BIN="$HOME/.local/bin/tau"
STAMP=$(date +%Y%m%d_%H%M%S)

echo "═══ 1. CAT compile-binary.ts TO SEE THE ASSETS HOOK ═══"
sed -n '1,120p' "$CA/scripts/compile-binary.ts"

echo "═══ 2. PATCH compile-binary.ts — ADD assets TO Bun.build OPTIONS ═══"
python3 - "$CA/scripts/compile-binary.ts" << 'PY'
import pathlib, sys, re
p = pathlib.Path(sys.argv[1])
src = p.read_text()

# Build the asset list from the tree
assets = [
    "packages/coding-agent/src/tools/browser/surface",
    "packages/coding-agent/src/tools/browser/puppeteer",
    "packages/coding-agent/src/tools/browser/aria/aria-snapshot.bundle.txt",
    "packages/coding-agent/src/tools/browser/prelude.js",
    "packages/coding-agent/src/tools/browser/prelude.py",
    "packages/coding-agent/src/tools/browser/declarations.d.ts",
    "packages/coding-agent/src/tools/computer/prelude.js",
    "packages/coding-agent/src/tools/computer/prelude.py",
    "packages/coding-agent/src/tools/computer/declarations.d.ts",
    "packages/coding-agent/src/tools/browser/relay/extension-assets",
]
asset_ts = ",\n            ".join(f'"{a}"' for a in assets)

# Insert `assets: [...]` before `compile:` in the Bun.build call
needle = "                        compile: {"
if "assets:" not in src:
    src = src.replace(needle, f'                        assets: [\n            {asset_ts},\n        ],\n' + needle, 1)
    p.write_text(src)
    print("  OK added assets[] to Bun.build call")
else:
    print("  assets already present — skipping")
PY

echo "═══ 3. VERIFY THE PATCH ═══"
grep -n -A20 'assets:' "$CA/scripts/compile-binary.ts" | head -30 | sed 's|^|    |'

echo "═══ 4. REBUILD ═══"
[ -x "$BIN" ] && cp "$BIN" "$BIN.bak.$STAMP"
cd "$TAU" || exit 1
if bun run build 2>&1 | tail -25; then
  for c in packages/coding-agent/dist/tau dist/tau bin/tau; do
    [ -f "$c" ] && { cp "$c" "$BIN.new" && mv "$BIN.new" "$BIN" && chmod +x "$BIN"; echo "  installed $c"; break; }
  done
else
  echo "  BUILD FAILED"
  [ -f "$BIN.bak.$STAMP" ] && cp "$BIN.bak.$STAMP" "$BIN" && echo "  rolled back"
  exit 1
fi

echo "═══ 5. SMOKE ═══"
S="/tmp/tau_smoke_asset_$STAMP.log"
timeout 60 tau -p "reply with only: ok" > "$S" 2>&1
grep -qiE '(^|\s)ok(\s|$)' "$S" && echo "  SMOKE OK" || { echo "  SMOKE FAIL"; tail -20 "$S" | sed 's|^|    |'; }
