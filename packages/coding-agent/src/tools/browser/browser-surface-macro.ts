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
