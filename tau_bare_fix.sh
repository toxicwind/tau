#!/usr/bin/env bash
set -uo pipefail
TOOLS="$HOME/estate/ranch/tau/packages/coding-agent/src/tools"
BIN="$HOME/.local/bin/tau"
STAMP=$(date +%Y%m%d_%H%M%S)

# 1. Convert ANY remaining readFileSync(import.meta.dir, X) → import X with { type: "text" }
python3 - "$TOOLS" << 'PY'
import re, pathlib, sys
root = pathlib.Path(sys.argv[1])
readpat = re.compile(
    r'^(?P<i>[ \t]*)const\s+(?P<v>[A-Za-z_]\w*)\s*=\s*readFileSync\(\s*'
    r'(?:join|resolve)\(\s*import\.meta\.dir\s*,\s*'
    r'(?P<q>["\'])(?P<r>[^"\']+)(?P=q)\s*\)\s*,\s*["\']utf-?8["\']\s*\)\s*;',
    re.MULTILINE)
n1 = 0
for f in sorted(root.rglob("*.ts")):
    s = str(f)
    if "node_modules" in s or ".bak." in s or ".prelude-backup" in s: continue
    src = f.read_text()
    if "import.meta.dir" not in src: continue
    new, n = readpat.subn(lambda m: f'{m.group("i")}import {m.group("v")} from "{("." if not m.group("r").startswith((".","/")) else "")}{m.group("r")}" with {{ type: "text" }};', src)
    if n:
        f.write_text(new); print(f"  conv  {f.relative_to(root)}  ({n})"); n1 += n
print(f"  readFileSync→import: {n1}")
PY

# 2. Prefix bare relative imports in already-converted text-imports
python3 - "$TOOLS" << 'PY'
import re, pathlib, sys
root = pathlib.Path(sys.argv[1])
pat = re.compile(
    r'^(\s*import\s+[A-Za-z_]\w*\s+from\s+)(["\'])([^"\']+)(\2)(\s+with\s+\{\s*type\s*:\s*["\']text["\']\s*\}\s*;)',
    re.MULTILINE)
n2 = 0
for f in sorted(root.rglob("*.ts")):
    s = str(f)
    if "node_modules" in s or ".bak." in s or ".prelude-backup" in s: continue
    src = f.read_text()
    def fix(m):
        pre, q1, path, q2, post = m.groups()
        if path.startswith(("./", "../", "/")): return m.group(0)
        return f'{pre}{q1}./{path}{q2}{post}'
    new, n = pat.subn(fix, src)
    if n:
        f.write_text(new); print(f"  ./pre {f.relative_to(root)}  ({n})"); n2 += n
print(f"  ./prefix: {n2}")
PY

# 3. Sanity: no bare relatives left
b=$(grep -rnE 'import [A-Za-z_]\w* from "[^"./][^"]*" with \{ type: "text" \}' "$TOOLS" 2>/dev/null || true)
[ -z "$b" ] && echo "  OK no bare relatives" || { echo "  WARN:"; echo "$b"; }

# 4. Rebuild
[ -x "$BIN" ] && cp "$BIN" "$BIN.bak.$STAMP"
cd "$HOME/estate/ranch/tau" || exit 1
if bun run build 2>&1 | tail -15; then
  for c in dist/tau bin/tau packages/coding-agent/dist/tau; do
    [ -f "$c" ] && { cp "$c" "$BIN.new" && mv "$BIN.new" "$BIN" && chmod +x "$BIN"; echo "  installed $c"; break; }
  done
else
  echo "  BUILD FAILED"; [ -f "$BIN.bak.$STAMP" ] && cp "$BIN.bak.$STAMP" "$BIN"; exit 1
fi

# 5. Smoke
S=/tmp/tau_smoke_$STAMP.log
timeout 45 tau -p "reply with only: ok" > "$S" 2>&1
grep -qiE '\bok\b' "$S" && echo "  SMOKE OK" || { echo "  SMOKE FAIL:"; tail -8 "$S"; }
