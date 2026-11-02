#!/usr/bin/env bash
set -uo pipefail
EXT="$HOME/estate/work/tau-extensions"
PLUG="$HOME/.tau/plugins"
REAL="$HOME/estate/ranch/tau/packages/coding-agent"
TOOLS="$REAL/src/tools"
BIN="$HOME/.local/bin/tau"
STAMP=$(date +%Y%m%d_%H%M%S)

say(){ printf '  %-8s %s\n' "$1" "$2"; }
banner(){ printf '\n═══ %s ═══\n' "$*"; }

# ─────────────────────────────────────────────────────────────────────────
banner "1. STRIP 'tau' FROM EVERY DEPENDENCY SLOT + KILL OVERRIDES"
python3 - "$EXT" << 'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
count = 0
paths = [root/"package.json", *sorted((root/"packages").glob("*/package.json"))]
for pj in paths:
    if not pj.exists(): continue
    j = json.loads(pj.read_text())
    changed = False
    for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        if section in j and "tau" in j[section]:
            del j[section]["tau"]
            changed = True
            count += 1
            if not j[section]: del j[section]
    # strip tau from overrides and resolutions too
    for key in ("overrides", "resolutions"):
        if key in j and isinstance(j[key], dict) and "tau" in j[key]:
            del j[key]["tau"]
            changed = True
            count += 1
            if not j[key]: del j[key]
    if changed:
        pj.write_text(json.dumps(j, indent=2) + "\n")
        print(f"  EDIT  {pj.relative_to(root)}")
print(f"  total: {count} slot[s] cleaned")
PY

# same treatment for the plugin node_modules the earlier scripts mangled
for pj in "$PLUG/node_modules"/*/package.json "$PLUG/node_modules/@cakriwut"/*/package.json; do
  [ -f "$pj" ] || continue
  python3 - "$pj" << 'PY' 2>/dev/null || true
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
j = json.loads(p.read_text())
changed = False
for s in ("dependencies","devDependencies","peerDependencies","optionalDependencies"):
    if s in j and "tau" in j[s]:
        del j[s]["tau"]; changed = True
        if not j[s]: del j[s]
for k in ("overrides","resolutions"):
    if k in j and isinstance(j[k], dict) and "tau" in j[k]:
        del j[k]["tau"]; changed = True
        if not j[k]: del j[k]
if changed: p.write_text(json.dumps(j, indent=2)+"\n"); print(f"  EDIT  {p}")
PY
done

# ─────────────────────────────────────────────────────────────────────────
banner "2. NUKE LOCKS + NODE_MODULES"
cd "$EXT" || exit 1
for f in bun.lock bun.lockb package-lock.json yarn.lock pnpm-lock.yaml; do
  [ -f "$f" ] && { cp "$f" "$f.bak.$STAMP"; rm -f "$f"; say OK "removed $f"; }
done
[ -d node_modules ] && rm -rf node_modules && say OK "rm node_modules"
[ -d packages/tau-shim ] && rm -rf packages/tau-shim && say OK "rm shim (no longer needed)"

# ─────────────────────────────────────────────────────────────────────────
banner "3. PLAIN bun install — no tau in the graph"
bun install 2>&1 | tee /tmp/tau_nodep_install.log | tail -10
if grep -qE '^error:' /tmp/tau_nodep_install.log; then
  say FAIL "errors remain — see /tmp/tau_nodep_install.log"
  grep -E '^error:' /tmp/tau_nodep_install.log | sort -u | head -10 | sed 's|^|         |'
else
  say OK "bun install clean — tau no longer in dependency graph"
fi

# ─────────────────────────────────────────────────────────────────────────
banner "4. HAND-PLACE node_modules/tau SYMLINKS"
for t in "$EXT/node_modules/tau" "$PLUG/node_modules/tau"; do
  mkdir -p "$(dirname "$t")"
  rm -rf "$t"
  ln -sfn "$REAL" "$t"
  say OK "$t → $REAL"
done

# also link into every extension package's own node_modules for deep resolution
for pkgdir in "$EXT"/packages/*/; do
  nm="$pkgdir/node_modules"
  [ -d "$pkgdir" ] || continue
  mkdir -p "$nm"
  rm -rf "$nm/tau"
  ln -sfn "$REAL" "$nm/tau"
done
say OK "linked tau into every packages/*/node_modules"

# ─────────────────────────────────────────────────────────────────────────
banner "5. VERIFY RUNTIME RESOLUTION"
for probe in "$EXT" "$PLUG"; do
  if ( cd "$probe" && bun -e 'import("tau").then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)})' >/tmp/probe.log 2>&1 ); then
    say OK "resolve OK from $probe"
  else
    say FAIL "resolve FAIL from $probe"
    tail -3 /tmp/probe.log | sed 's|^|         |'
  fi
done

# ─────────────────────────────────────────────────────────────────────────
banner "6. TAU BINARY — txt-embed conversions (idempotent)"
python3 - "$TOOLS" << 'PY'
import re, pathlib, sys, time
root = pathlib.Path(sys.argv[1])
pat = re.compile(
    r'^(?P<indent>[ \t]*)const\s+(?P<var>[A-Za-z_]\w*)\s*=\s*readFileSync\(\s*'
    r'(?:join|resolve)\(\s*import\.meta\.dir\s*,\s*'
    r'(?P<q>["\'])(?P<rel>[^"\']+)(?P=q)\s*\)\s*,\s*["\']utf-?8["\']\s*\)\s*;',
    re.MULTILINE,
)
n_total = 0
for f in sorted(root.rglob("*.ts")):
    s = str(f)
    if "node_modules" in s or ".prelude-backup" in s or ".bak." in s: continue
    src = f.read_text()
    if "readFileSync" not in src or "import.meta.dir" not in src: continue
    new, n = pat.subn(lambda m: f'{m.group("indent")}import {m.group("var")} from "{m.group("rel")}" with {{ type: "text" }};', src)
    if n:
        f.with_name(f.name + ".bak." + str(int(time.time()))).write_text(src)
        f.write_text(new)
        print(f"  EDIT  {f.relative_to(root)}  ({n})")
        n_total += n
print(f"  total {n_total} conversion[s]" if n_total else "  (all sites already converted)")
PY

# ─────────────────────────────────────────────────────────────────────────
banner "7. REBUILD + INSTALL BINARY"
[ -x "$BIN" ] && { cp "$BIN" "$BIN.bak.$STAMP"; say OK "backup → $BIN.bak.$STAMP"; }
cd "$HOME/estate/ranch/tau" || exit 1
if bun run build 2>&1 | tail -25; then
  say OK "build finished"
  for cand in dist/tau bin/tau packages/coding-agent/dist/tau packages/coding-agent/bin/tau; do
    [ -f "$cand" ] && { cp "$cand" "$BIN.new" && mv "$BIN.new" "$BIN" && chmod +x "$BIN"; say OK "installed $cand → $BIN"; break; }
  done
else
  say FAIL "build failed — restoring backup"
  [ -f "$BIN.bak.$STAMP" ] && cp "$BIN.bak.$STAMP" "$BIN"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────
banner "8. SMOKE"
SMOKE="/tmp/tau_smoke_nodep_$STAMP.log"
if timeout 60 tau -p "reply with only: ok" > "$SMOKE" 2>&1; then
  grep -qiE '\bok\b' "$SMOKE" && say OK "tau responds" || say WARN "no 'ok' — see $SMOKE"
else
  say WARN "nonzero exit — see $SMOKE"
fi
tail -15 "$SMOKE" | sed 's|^|         |'

# ─────────────────────────────────────────────────────────────────────────
banner DONE
echo "  install log:  /tmp/tau_nodep_install.log"
echo "  smoke log:    $SMOKE"
echo "  symlinks:"
for t in "$EXT/node_modules/tau" "$PLUG/node_modules/tau"; do
  [ -L "$t" ] && echo "    $t → $(readlink "$t")"
done
echo "  binary:       $BIN  (backup $BIN.bak.$STAMP)"
echo
echo "  NOTE: tau is no longer declared as a dependency anywhere."
echo "        If bun install ever removes the symlink, re-create with:"
echo "          ln -sfn $REAL $EXT/node_modules/tau"
echo "          ln -sfn $REAL $PLUG/node_modules/tau"
