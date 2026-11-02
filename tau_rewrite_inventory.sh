#!/usr/bin/env bash
set -uo pipefail
TAU="$HOME/estate/ranch/tau"
CA="$TAU/packages/coding-agent"
OUT="$HOME/.tau_fix/rewrite_inventory_$(date +%Y%m%d_%H%M%S).txt"
mkdir -p "$(dirname "$OUT")"

exec > >(tee "$OUT") 2>&1

echo "════════════════════════════════════════════════════════════════"
echo "  REWRITE INVENTORY  $(date -u +%FT%TZ)"
echo "  target: $CA"
echo "  output: $OUT"
echo "════════════════════════════════════════════════════════════════"

echo; echo "── 1. EVERY RUNTIME-FS SITE IN src/tools ──"
grep -rnE 'readFileSync|readdirSync|existsSync|statSync|import\.meta\.dir|__dirname|process\.cwd' \
  "$CA/src/tools" 2>/dev/null \
  | grep -vE '\.bak\.|\.prelude-backup' \
  | sed "s|$CA/||" \
  | sort

echo; echo "── 2. NON-TS ASSETS REFERENCED BY THOSE SITES ──"
grep -rhoE '"[^"]+\.(txt|json|js|py|ts|md|wasm|node)"' "$CA/src/tools" 2>/dev/null \
  | tr -d '"' | sort -u | sed 's|^|  |'

echo; echo "── 3. ASSET DIRECTORY TREE ──"
for d in \
  "$CA/src/tools/browser/surface" \
  "$CA/src/tools/browser/puppeteer" \
  "$CA/src/tools/browser/aria" \
  "$CA/src/tools/browser/a11y" \
  "$CA/src/tools/browser/relay/extension-assets" \
  "$CA/src/tools/computer"; do
  [ -d "$d" ] || continue
  echo "  $d:"
  ls -la "$d" 2>/dev/null | tail -n +2 | awk '{print "    "$5"  "$9}'
done

echo; echo "── 4. BUILD PIPELINE ──"
for f in \
  "$CA/scripts/build-binary.ts" \
  "$CA/scripts/compile-binary.ts" \
  "$CA/package.json"; do
  [ -f "$f" ] || continue
  echo; echo "--- $f ---"
  cat "$f"
done

echo; echo "── 5. SOURCE FILES TO REWRITE (each runtime-fs reader) ──"
SRC=$(grep -rlE 'readFileSync|readdirSync|import\.meta\.dir' \
  "$CA/src/tools" 2>/dev/null | grep -vE '\.bak\.|\.prelude-backup' | sort)
printf '%s\n' "$SRC" | sed "s|$CA/||" | sed 's|^|  |'

echo; echo "── 6. CAT EACH SOURCE ──"
for f in $SRC; do
  echo; echo "════════════════════════════════════════════════════════════════"
  echo "  $f"
  echo "════════════════════════════════════════════════════════════════"
  cat "$f"
done

echo
echo "════════════════════════════════════════════════════════════════"
echo "  full inventory written to: $OUT"
echo "  size: $(wc -c < "$OUT") bytes   lines: $(wc -l < "$OUT")"
echo "════════════════════════════════════════════════════════════════"
