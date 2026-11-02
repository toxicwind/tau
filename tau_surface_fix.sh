#!/usr/bin/env bash
set -uo pipefail
TOOLS="$HOME/estate/ranch/tau/packages/coding-agent/src/tools"
BIN="$HOME/.local/bin/tau"
STAMP=$(date +%Y%m%d_%H%M%S)

echo "═══ 1. LOCATE browser-surface.macro.ts + surface/ dir ═══"
MACRO=$(find "$TOOLS" -name 'browser-surface.macro.ts' -not -path '*/node_modules/*' | head -1)
[ -z "$MACRO" ] && { echo "  FAIL: macro not found"; exit 1; }
SURF_DIR="$(dirname "$MACRO")/surface"
echo "  macro: $MACRO"
echo "  dir:   $SURF_DIR"
ls -la "$SURF_DIR" 2>/dev/null | sed 's|^|    |'

echo "═══ 2. REWRITE loadManifests AS STATIC IMPORTS ═══"
python3 - "$MACRO" "$SURF_DIR" << 'PY'
import pathlib, re, sys
macro = pathlib.Path(sys.argv[1])
surf = pathlib.Path(sys.argv[2])
src = macro.read_text()

# Collect the surface JSON files
manifests = sorted(p.name for p in surf.glob("*.json"))
if not manifests:
    print(f"  FAIL: no .json in {surf}")
    sys.exit(1)
print(f"  found {len(manifests)} manifest[s]: {', '.join(manifests)}")

# Build the static import block
import_block = "\n".join(
    f'import __manifest_{p.stem.replace("-","_")} from "./surface/{p.name}";'
    for p in surf.glob("*.json")
)

# Find and replace the loadManifests function
old_pat = re.compile(
    r'export\s+function\s+loadManifests\(\)\s*:\s*SurfaceManifest\[\]\s*\{[^}]*\}',
    re.DOTALL,
)
new_fn = (
    'export function loadManifests(): SurfaceManifest[] {\n'
    '  return [\n'
    + "".join(
        f'    __manifest_{p.stem.replace("-","_")} as SurfaceManifest,\n'
        for p in surf.glob("*.json")
    )
    + '  ];\n}'
)
new_src, n = old_pat.subn(new_fn, src)
if n == 0:
    print("  FAIL: could not find loadManifests()")
    sys.exit(1)
print(f"  replaced loadManifests()  ({n} site)")

# Insert the import block after the last import line
lines = new_src.splitlines(keepends=True)
last_import = -1
for i, line in enumerate(lines):
    if line.lstrip().startswith("import "):
        last_import = i
if last_import >= 0:
    lines.insert(last_import + 1, "\n" + import_block + "\n")
    new_src = "".join(lines)

# Remove now-unused readdirSync / readFileSync / join imports IF nothing else uses them
for sym in ("readdirSync", "readFileSync"):
    if not re.search(rf'(?<![.\w]){sym}\s*\(', new_src):
        new_src = re.sub(rf'import\s*\{{[^}}]*\b{sym}\b[^}}]*\}}\s*from\s*"node:fs";\n', "", new_src)
if not re.search(r'(?<![.\w])join\s*\(', new_src) and "join(" not in new_src:
    new_src = re.sub(r'import\s*\{[^}]*\bjoin\b[^}]*\}\s*from\s*"node:path";\n', "", new_src)

macro.write_text(new_src)
print("  wrote new macro")
PY

echo "═══ 3. VERIFY: no more readdirSync on surface ═══"
if grep -q 'readdirSync.*SURFACE_DIR\|SURFACE_DIR.*readdirSync' "$MACRO" 2>/dev/null; then
  echo "  FAIL: readdirSync still present"
  exit 1
fi
grep -nE 'SURFACE_DIR|readdirSync|loadManifests' "$MACRO" | head -10 | sed 's|^|    |'

echo "═══ 4. AUDIT surface dir still exists (should NOT be needed at runtime) ═══"
[ -d "$SURF_DIR" ] && echo "  OK: source surface dir present" || echo "  WARN: source surface dir missing"

echo "═══ 5. REBUILD ═══"
[ -x "$BIN" ] && cp "$BIN" "$BIN.bak.$STAMP"
cd "$HOME/estate/ranch/tau" || exit 1
if bun run build 2>&1 | tail -20; then
  for c in packages/coding-agent/dist/tau dist/tau bin/tau; do
    if [ -f "$c" ]; then
      cp "$c" "$BIN.new" && mv "$BIN.new" "$BIN" && chmod +x "$BIN"
      echo "  installed: $c"
      break
    fi
  done
else
  echo "  BUILD FAILED"
  [ -f "$BIN.bak.$STAMP" ] && cp "$BIN.bak.$STAMP" "$BIN" && echo "  rolled back"
  exit 1
fi

echo "═══ 6. SMOKE ═══"
S="/tmp/tau_smoke_surface_$STAMP.log"
if timeout 60 tau -p "reply with only: ok" > "$S" 2>&1; then
  if grep -qiE '(^|\s)ok(\s|$)' "$S"; then
    echo "  SMOKE OK"
  else
    echo "  SMOKE: ran, no 'ok'"
    tail -15 "$S" | sed 's|^|    |'
  fi
else
  echo "  SMOKE FAIL"
  tail -20 "$S" | sed 's|^|    |'
fi
echo
echo "  smoke log: $S"
echo "  binary:    $BIN"
echo "  backup:    $BIN.bak.$STAMP"
