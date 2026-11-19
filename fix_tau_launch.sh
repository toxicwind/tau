#!/usr/bin/env bash
set -euo pipefail

TOOLS_DIR="${1:-/home/toxic/pens/estate/ranch/tau/packages/coding-agent/src/tools}"

echo "=============================================================================="
echo "  TAU TOOL IMPORT AUDITOR & LAUNCH REPAIR"
echo "  Target: $TOOLS_DIR"
echo "=============================================================================="

python3 - << 'PY_EOF' "$TOOLS_DIR"
import sys, os, re, pathlib

tools_dir = pathlib.Path(sys.argv[1]).resolve()

def fix_imports_in_file(p: pathlib.Path):
    try:
        src = p.read_text(encoding="utf-8")
    except Exception as e:
        return

    # Check if readFileSync or join are referenced as bare function calls
    calls_read_file = bool(re.search(r'\breadFileSync\s*\(', src))
    calls_join = bool(re.search(r'(?<!\bpath\.)\bjoin\s*\(', src))

    # Check if they are actually imported
    has_read_file_import = bool(re.search(r'import\s+.*?\breadFileSync\b.*?from\s+["\'](?:node:)?fs["\']', src)) or \
                           bool(re.search(r'require\([\"\'](?:node:)?fs[\"\']\)', src) and 'readFileSync' in src)
    has_join_import = bool(re.search(r'import\s+.*?\bjoin\b.*?from\s+["\'](?:node:)?path["\']', src)) or \
                      bool(re.search(r'require\([\"\'](?:node:)?path[\"\']\)', src) and 'join' in src)

    injections = []
    if calls_read_file and not has_read_file_import:
        injections.append('import { readFileSync } from "node:fs";')
    if calls_join and not has_join_import:
        injections.append('import { join } from "node:path";')

    if injections:
        patched = "\n".join(injections) + "\n" + src
        p.write_text(patched, encoding="utf-8")
        print(f"  [patched] Injected {injections} into {p.relative_to(tools_dir)}")

# Check all TS/JS files under tools_dir
for root, _, files in os.walk(tools_dir):
    for f in files:
        if f.endswith((".ts", ".js")) and not f.endswith((".test.ts", ".macro.ts")):
            fix_imports_in_file(pathlib.Path(root) / f)

print("[✓] Import validation complete.")
PY_EOF

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
