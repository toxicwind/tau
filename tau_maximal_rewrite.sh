#!/usr/bin/env bash
set -uo pipefail
TAU="$HOME/estate/ranch/tau"
CA="$TAU/packages/coding-agent"
TOOLS="$CA/src/tools"
BIN="$HOME/.local/bin/tau"
STAMP=$(date +%Y%m%d_%H%M%S)

say(){ printf '  %-8s %s\n' "$1" "$2"; }
banner(){ printf '\n═══ %s ═══\n' "$*"; }

# ─────────────────────────────────────────────────────────────────────────
banner "1. REWRITE browser-surface-macro.ts — STATIC IMPORTS (compile-safe)"
# The current file does readdirSync(SURFACE_DIR). That works on disk, never in $bunfs.
# The three manifests are a fixed set. Static-import them. No walker.
cat > "$TOOLS/browser/browser-surface-macro.ts" << 'MACRO'
// browser-surface-macro.ts
//
// Compile-safe surface manifest loader.
//
// The three `surface/*.json` manifests are a FIXED set — same three files,
// same three namespaces. They are embedded at build time via static JSON
// imports so this module works identically under `bun run` and inside a
// `bun build --compile` binary. No `readdirSync`, no `$bunfs` walk.
import elementManifest from "./surface/element.json";
import frameManifest from "./surface/frame.json";
import tabManifest from "./surface/tab.json";

export interface ArgSpec {
  name: string;
  type: string;
  optional?: boolean;
  rest?: boolean;
}

export interface MethodSpec {
  name: string;
  doc?: string;
  args?: ArgSpec[];
  returns?: string;
  async?: boolean;
  generic?: string[];
}

export interface SurfaceManifest {
  namespace: string;
  receiver: string;
  doc: string;
  methods: MethodSpec[];
}

const MANIFESTS: readonly SurfaceManifest[] = [
  elementManifest as SurfaceManifest,
  frameManifest as SurfaceManifest,
  tabManifest as SurfaceManifest,
];

export function loadManifests(): SurfaceManifest[] {
  return MANIFESTS as SurfaceManifest[];
}

function names(m: SurfaceManifest): string[] {
  return m.methods.map((x) => x.name);
}

function jsonArray(values: string[]): string {
  return "[" + values.map((v) => JSON.stringify(v)).join(", ") + "]";
}

export function generateDirectMethods(): string {
  return jsonArray(
    loadManifests()
      .filter((m) => m.namespace === "tab")
      .flatMap(names),
  );
}

export function generateElementMethods(): string {
  const m = loadManifests().find((x) => x.namespace === "element");
  return jsonArray(m ? names(m) : []);
}

export function generateFrameMethods(): string {
  const m = loadManifests().find((x) => x.namespace === "frame");
  return jsonArray(m ? names(m) : []);
}

export function generatePyMethods(): string {
  return loadManifests()
    .map((m) => {
      const lines = names(m).map((n) => "    " + JSON.stringify(n) + ",");
      return "_" + m.namespace.toUpperCase() + "_METHODS = (\n" + lines.join("\n") + "\n)";
    })
    .join("\n\n");
}

function renderArgs(method: MethodSpec): string {
  if (!method.args || method.args.length === 0) return "";
  return method.args
    .map((a) => {
      const rest = a.rest ? "..." : "";
      const opt  = a.optional ? "?" : "";
      return rest + a.name + opt + ": " + a.type;
    })
    .join(", ");
}

function renderMethod(method: MethodSpec): string {
  const generics =
    method.generic && method.generic.length > 0
      ? "<" + method.generic.join(", ") + ">"
      : "";
  const args = renderArgs(method);
  const ret = method.async
    ? "Promise<" + (method.returns ?? "void") + ">"
    : method.returns ?? "void";
  const doc = method.doc ? "  /** " + method.doc + " */\n" : "";
  return doc + "  " + method.name + generics + "(" + args + "): " + ret + ";";
}

export function generateDeclarations(): string {
  return loadManifests()
    .map((m) => {
      const body = m.methods.map(renderMethod).join("\n");
      return "/** " + m.doc + " */\ninterface " + m.receiver + " {\n" + body + "\n}";
    })
    .join("\n\n");
}

export function generateAll(): {
  directMethods: string;
  elementMethods: string;
  frameMethods: string;
  pyMethods: string;
  declarations: string;
} {
  return {
    directMethods: generateDirectMethods(),
    elementMethods: generateElementMethods(),
    frameMethods: generateFrameMethods(),
    pyMethods: generatePyMethods(),
    declarations: generateDeclarations(),
  };
}
MACRO
say OK "browser-surface-macro.ts rewritten — static JSON imports"

# ─────────────────────────────────────────────────────────────────────────
banner "2. REWRITE prelude-definition.ts FILES — DROP DEAD readFileSync IMPORTS"
# browser/prelude-definition.ts already uses `with { type: "text" }`. Drop the
# dead node:fs / node:path imports so the compiler stops flagging them.
python3 - "$TOOLS/browser/prelude-definition.ts" << 'PY'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1])
src = p.read_text()
# Only strip if the symbol is not used elsewhere
if not re.search(r'(?<![.\w])readFileSync\s*\(', src):
    src = re.sub(r'import\s*\{\s*readFileSync\s*\}\s*from\s*"node:fs";\s*\n', "", src)
if not re.search(r'(?<![.\w])join\s*\(', src) and "path.join(" not in src:
    src = re.sub(r'import\s*\{\s*join\s*\}\s*from\s*"node:path";\s*\n', "", src)
p.write_text(src)
print(f"  cleaned: {p.name}")
PY

python3 - "$TOOLS/computer/prelude-definition.ts" << 'PY'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1])
src = p.read_text()
if not re.search(r'(?<![.\w])readFileSync\s*\(', src):
    src = re.sub(r'import\s*\{\s*readFileSync\s*\}\s*from\s*"node:fs";\s*\n', "", src)
if not re.search(r'(?<![.\w])join\s*\(', src) and "path.join(" not in src:
    src = re.sub(r'import\s*\{\s*join\s*\}\s*from\s*"node:path";\s*\n', "", src)
p.write_text(src)
print(f"  cleaned: {p.name}")
PY

# ─────────────────────────────────────────────────────────────────────────
banner "3. REWRITE compile-binary.ts — assets AT compile.assets WITH ABSOLUTE PATHS"
# Key change from the failed attempt:
#   • Paths must be ABSOLUTE (built from options.repoRoot) so the walker
#     resolves them from any cwd. Relative paths resolve against the CLI
#     cwd and silently miss.
#   • Directory basename becomes the $bunfs root segment. `.../surface` →
#     `/$bunfs/root/surface/...` — exactly what readdirSync(join(import.meta.dir, "surface"))
#     expects.
python3 - "$CA/scripts/compile-binary.ts" << 'PY'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1])
src = p.read_text()

# Strip any prior `assets: [...]` insert (top-level or nested) — start clean
src = re.sub(r'^\s*assets:\s*\[[\s\S]*?\],\s*\n', '', src, flags=re.MULTILINE)

assets_block = '''                        compile: {
                            assets: [
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

src = src.replace("                        compile: {", assets_block, 1)
p.write_text(src)
print("  compile-binary.ts: assets[] under compile: with absolute repoRoot paths")
PY

# ─────────────────────────────────────────────────────────────────────────
banner "4. VERIFY EACH ASSET PATH EXISTS ON DISK"
cd "$CA"
for p in \
  packages/coding-agent/src/tools/browser/surface \
  packages/coding-agent/src/tools/browser/puppeteer \
  packages/coding-agent/src/tools/browser/aria/aria-snapshot.bundle.txt \
  packages/coding-agent/src/tools/browser/prelude.js \
  packages/coding-agent/src/tools/browser/prelude.py \
  packages/coding-agent/src/tools/browser/declarations.d.ts \
  packages/coding-agent/src/tools/computer/prelude.js \
  packages/coding-agent/src/tools/computer/prelude.py \
  packages/coding-agent/src/tools/computer/declarations.d.ts \
  packages/coding-agent/src/tools/browser/relay/extension-assets; do
  if [ -e "$p" ]; then say OK "$p"; else say MISS "$p"; fi
done

# ─────────────────────────────────────────────────────────────────────────
banner "5. REBUILD"
[ -x "$BIN" ] && cp "$BIN" "$BIN.bak.$STAMP"
cd "$TAU" || exit 1
if bun run build 2>&1 | tail -30; then
  for c in packages/coding-agent/dist/tau dist/tau bin/tau; do
    [ -f "$c" ] && { cp "$c" "$BIN.new" && mv "$BIN.new" "$BIN" && chmod +x "$BIN"; say OK "installed $c"; break; }
  done
else
  say FAIL "build failed"
  [ -f "$BIN.bak.$STAMP" ] && cp "$BIN.bak.$STAMP" "$BIN" && say OK "rolled back"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────
banner "6. VERIFY ASSETS EMBEDDED (walk the graph, don't guess)"
# `Bun.embeddedFiles` lists every asset in the standalone graph. If `surface`
# is missing from it, the assets option silently no-op'd and we know to fall
# back to the CLI --asset flag.
bun -e '
const files = (Bun.embeddedFiles ?? []).map(f => typeof f === "string" ? f : f.name ?? String(f));
console.log("embedded count:", files.length);
for (const f of files.filter(x => /surface|puppeteer|prelude|aria-snapshot|extension-assets/.test(String(x)))) {
  console.log("  " + f);
}
' 2>&1 | sed 's|^|    |'

# ─────────────────────────────────────────────────────────────────────────
banner "7. SMOKE"
S="/tmp/tau_smoke_rewrite_$STAMP.log"
timeout 60 tau -p "reply with only: ok" > "$S" 2>&1
if grep -qiE '(^|\s)ok(\s|$)' "$S"; then
  say OK "SMOKE OK"
else
  say FAIL "SMOKE FAIL"
  tail -20 "$S" | sed 's|^|    |'
fi
echo
echo "  smoke:  $S"
echo "  binary: $BIN  (backup $BIN.bak.$STAMP)"
