#!/usr/bin/env bash
set -uo pipefail
TOOLS="$HOME/estate/ranch/tau/packages/coding-agent/src/tools"
BIN="$HOME/.local/bin/tau"
STAMP=$(date +%Y%m%d_%H%M%S)

echo "═══ 1. FIX ./axe-core REGRESSION ═══"
grep -rl '"\./axe-core/' "$TOOLS" 2>/dev/null | while IFS= read -r f; do
  sed -i 's|"\./axe-core/|"axe-core/|g' "$f"
  echo "  fixed ${f#$TOOLS/}"
done

echo "═══ 2. AUDIT every ./text-import for real file existence ═══"
python3 - "$TOOLS" << 'PY'
import re, pathlib, sys
root = pathlib.Path(sys.argv[1])
pat = re.compile(
    r'import\s+\w+\s+from\s+["\'](\./[^"\']+)["\']\s+with\s+\{\s*type\s*:\s*["\']text["\']\s*\}'
)
reverted = 0
for f in sorted(root.rglob("*.ts")):
    s = str(f)
    if "node_modules" in s or ".bak." in s or ".prelude-backup" in s: continue
    src = f.read_text()
    changed = False
    for m in pat.finditer(src):
        rel = m.group(1)
        if not (f.parent / rel).resolve().exists():
            new = rel[2:]
            src = src.replace(f'"{rel}"', f'"{new}"').replace(f"'{rel}'", f"'{new}'")
            print(f"  revert {f.relative_to(root)}  {rel} → {new}")
            changed = True
    if changed:
        f.write_text(src)
        reverted += 1
print(f"  reverted {reverted} file[s]" if reverted else "  OK all ./text-imports resolve")
PY

echo "═══ 3. SANITY: no bare relatives, no missing ./, no dup imports ═══"
bare=$(grep -rnE 'import [A-Za-z_]\w* from "\.\.?/[^"]*" with \{ type: "text" \}' "$TOOLS" 2>/dev/null | wc -l)
nodot=$(grep -rnE 'import [A-Za-z_]\w* from "[^./][^"]*\.(txt|js|py|md|ts)" with \{ type: "text" \}' "$TOOLS" 2>/dev/null || true)
echo "  ./ and ../ prefixed: $bare"
[ -z "$nodot" ] && echo "  no bare relatives" || { echo "  bare relatives:"; echo "$nodot" | sed 's|^|    |'; }

echo "═══ 4. REBUILD ═══"
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
  [ -f "$BIN.bak.$STAMP" ] && cp "$BIN.bak.$STAMP" "$BIN" && echo "  rolled back binary"
  exit 1
fi

echo "═══ 5. SMOKE ═══"
S="/tmp/tau_smoke_$STAMP.log"
if timeout 60 tau -p "reply with only: ok" > "$S" 2>&1; then
  if grep -qiE '(^|\s)ok(\s|$)' "$S"; then
    echo "  SMOKE OK"
  else
    echo "  SMOKE: ran, no 'ok'"
    tail -12 "$S" | sed 's|^|    |'
  fi
else
  echo "  SMOKE FAIL"
  tail -12 "$S" | sed 's|^|    |'
fi
