#!/usr/bin/env bash
# ==============================================================================
# fix_tau_maximal_v2.sh
# 
# Precision path & fs import reconciler for Tau tools:
#   - Reverts mistaken imports in prelude templates and array.join callers.
#   - Injects resolve / join / readFileSync only where bare calls actually exist.
#   - Probes isolated tool loading and launches dry-run smoke test.
# ==============================================================================
set -euo pipefail

TOOLS_DIR="${1:-/home/toxic/pens/estate/ranch/tau/packages/coding-agent/src/tools}"

echo "=============================================================================="
echo "  TAU TOOL RECONCILIATION & RESOLVE REPAIR (v2)"
echo "  Target: $TOOLS_DIR"
echo "=============================================================================="

python3 - << 'PY_EOF' "$TOOLS_DIR"
import sys, os, re, pathlib

tools_dir = pathlib.Path(sys.argv[1]).resolve()

def audit_and_reconcile(p: pathlib.Path):
    try:
        src = p.read_text(encoding="utf-8")
    except Exception:
        return

    rel = p.relative_to(tools_dir)
    is_template = p.name in ("prelude.js", "prelude.py") or p.name.endswith((".txt", ".d.ts"))

    if is_template:
        # Strip any accidental node imports from guest templates
        cleaned = re.sub(r'^import\s+.*?from\s+["\'](?:node:)?(?:path|fs)["\'];\s*\n?', '', src, flags=re.M)
        if cleaned != src:
            p.write_text(cleaned, encoding="utf-8")
            print(f"  [template-clean] Removed node imports from guest asset: {rel}")
        return

    # Check for actual bare function calls (not preceded by dot or identifier chars)
    needs_join = bool(re.search(r'(?<![\.\w\$])join\s*\(', src))
    needs_resolve = bool(re.search(r'(?<![\.\w\$])resolve\s*\(', src))
    needs_read_file = bool(re.search(r'(?<![\.\w\$])readFileSync\s*\(', src))

    # Check for existing imports
    has_join = bool(re.search(r'import\s+.*?\bjoin\b.*?from\s+["\'](?:node:)?path["\']', src)) or \
               bool(re.search(r'require\([\"\'](?:node:)?path[\"\']\)', src) and 'join' in src)
    has_resolve = bool(re.search(r'import\s+.*?\bresolve\b.*?from\s+["\'](?:node:)?path["\']', src)) or \
                 bool(re.search(r'require\([\"\'](?:node:)?path[\"\']\)', src) and 'resolve' in src)
    has_read_file = bool(re.search(r'import\s+.*?\breadFileSync\b.*?from\s+["\'](?:node:)?fs["\']', src)) or \
                    bool(re.search(r'require\([\"\'](?:node:)?fs[\"\']\)', src) and 'readFileSync' in src)

    # Revert false-positive 'import { join } from "node:path";' if bare join() is NOT called
    if not needs_join and has_join and re.search(r'^import\s*\{\s*join\s*\}\s*from\s*["\']node:path["\'];\s*$', src, re.M):
        src = re.sub(r'^import\s*\{\s*join\s*\}\s*from\s*["\']node:path["\'];\s*\n?', '', src, count=1, flags=re.M)
        has_join = False
        print(f"  [revert-false-positive] Removed unneeded join import from: {rel}")

    # Revert false-positive readFileSync if not called
    if not needs_read_file and has_read_file and re.search(r'^import\s*\{\s*readFileSync\s*\}\s*from\s*["\']node:fs["\'];\s*$', src, re.M):
        src = re.sub(r'^import\s*\{\s*readFileSync\s*\}\s*from\s*["\']node:fs["\'];\s*\n?', '', src, count=1, flags=re.M)
        has_read_file = False
        print(f"  [revert-false-positive] Removed unneeded readFileSync import from: {rel}")

    # Prepare required injections
    injections = []
    if needs_resolve and not has_resolve:
        injections.append('import { resolve } from "node:path";')
    if needs_join and not has_join:
        injections.append('import { join } from "node:path";')
    if needs_read_file and not has_read_file:
        injections.append('import { readFileSync } from "node:fs";')

    if injections:
        src = "\n".join(injections) + "\n" + src
        p.write_text(src, encoding="utf-8")
        print(f"  [injected] {injections} into: {rel}")

for root, _, files in os.walk(tools_dir):
    for f in files:
        if f.endswith((".ts", ".js")) and not f.endswith((".test.ts", ".macro.ts")):
            audit_and_reconcile(pathlib.Path(root) / f)

print("[✓] AST import reconciliation complete.")
PY_EOF

# --- Run isolated Bun probes -------------------------------------------------
echo
echo "[*] Running isolated Bun probes..."
bun -e '
  try {
    require("./browser/prelude-definition");
    console.log("  ✓ [probe:browser] OK");
  } catch (e) {
    console.error("  ✗ [probe:browser] FAILED:", e.message);
    process.exit(1);
  }
  try {
    require("./computer/prelude-definition");
    console.log("  ✓ [probe:computer] OK");
  } catch (e) {
    console.error("  ✗ [probe:computer] FAILED:", e.message);
    process.exit(1);
  }
' --cwd "$TOOLS_DIR"

# --- Run TAU dry-run smoke test ----------------------------------------------
echo
echo "=============================================================================="
echo "  Running TAU dry-run smoke test..."
echo "=============================================================================="

if command -v tau >/dev/null 2>&1; then
  TAU_BIN="tau"
elif [ -f /home/toxic/.local/bin/tau ]; then
  TAU_BIN="/home/toxic/.local/bin/tau"
else
  echo "[!] tau executable not found in PATH."
  exit 1
fi

LAUNCH_LOG=$(mktemp)
if TAU_DEV_MODE=1 "$TAU_BIN" launch "prelude smoke" --dry-run > "$LAUNCH_LOG" 2>&1; then
  echo "[✓] tau launch --dry-run succeeded!"
  cat "$LAUNCH_LOG"
  rm -f "$LAUNCH_LOG"
else
  EXIT_CODE=$?
  echo "[✗] tau launch exited with code $EXIT_CODE"
  echo "---------------------- STACK TRACE / FAILURE LOG ----------------------"
  cat "$LAUNCH_LOG"
  echo "------------------------------------------------------------------------"
  
  OFFENDING_FILE=$(grep -oE '/[a-zA-Z0-9_./-]+\.(ts|js):[0-9]+' "$LAUNCH_LOG" | head -1 | cut -d: -f1 || true)
  if [ -n "$OFFENDING_FILE" ] && [ -f "$OFFENDING_FILE" ]; then
    echo
    echo "=============================================================================="
    echo "  FALLBACK DUMP: Offending file from stack trace"
    echo "  $OFFENDING_FILE"
    echo "=============================================================================="
    nl -ba "$OFFENDING_FILE"
  fi
  rm -f "$LAUNCH_LOG"
  exit "$EXIT_CODE"
fi
