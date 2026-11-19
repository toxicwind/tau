#!/usr/bin/env bash
set -uo pipefail
CA="$HOME/estate/ranch/tau/packages/coding-agent"
BIN="$HOME/.local/bin/tau"
STAMP=$(date +%Y%m%d_%H%M%S)

python3 - "$CA/scripts/compile-binary.ts" << 'PY'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1])
src = p.read_text()

# strip whatever we previously inserted (top-level assets:[...],)
src = re.sub(r'^\s*assets:\s*\[[^\]]*\],\s*\n', '', src, flags=re.MULTILINE)

# absolute paths, using repoRoot at runtime
assets_block = '''                    assets: [
                        `${options.repoRoot}/packages/coding-agent/src/tools/browser/surface`,
                        `${options.repoRoot}/packages/coding-agent/src/tools/browser/puppeteer`,
                        `${options.repoRoot}/packages/coding-agent/src/tools/browser/aria/aria-snapshot.bundle.txt`,
                        `${options.repoRoot}/packages/coding-agent/src/tools/browser/prelude.js`,
                        `${options.repoRoot}/packages/coding-agent/src/tools/browser/prelude.py`,
                        `${options.repoRoot}/packages/coding-agent/src/tools/browser/declarations.d.ts`,
                        `${options.repoRoot}/packages/coding-agent/src/tools/computer/prelude.js`,
                        `${options.repoRoot}/packages/coding-agent/src/tools/computer/prelude.py`,
                        `${options.repoRoot}/packages/coding-agent/src/tools/computer/declarations.d.ts`,
                        `${options.repoRoot}/packages/coding-agent/src/tools/browser/relay/extension-assets`,
                    ],
'''

# insert directly inside compile: {  ... }
needle = "                        compile: {"
if "assets: [" not in src:
    src = src.replace(needle, needle + "\n" + assets_block, 1)
    p.write_text(src)
    print("  OK assets[] nested under compile:")
else:
    print("  assets already present (nested)")
PY

echo "── verify ──"
sed -n '/compile:/,/^                        }/p' "$CA/scripts/compile-binary.ts" | head -30

[ -x "$BIN" ] && cp "$BIN" "$BIN.bak.nest.$STAMP"
cd "$HOME/estate/ranch/tau" || exit 1
bun run build 2>&1 | tail -25
for c in packages/coding-agent/dist/tau dist/tau bin/tau; do
  [ -f "$c" ] && { cp "$c" "$BIN.new" && mv "$BIN.new" "$BIN" && chmod +x "$BIN"; echo "  installed $c"; break; }
done

S="/tmp/tau_smoke_nest_$STAMP.log"
timeout 60 tau -p "reply with only: ok" > "$S" 2>&1
grep -qiE '(^|\s)ok(\s|$)' "$S" && echo "  SMOKE OK" || { echo "  SMOKE FAIL"; tail -20 "$S"; }
