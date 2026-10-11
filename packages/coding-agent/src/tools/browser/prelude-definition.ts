import type { EvalPreludeDefinition } from "../../eval/preludes";
import browserDescription from "../../prompts/tools/browser.md" with { type: "text" };
import type { ToolSession } from "../../sdk";
import preludeJsTemplate from "./prelude.js" with { type: "text" };
import preludePyTemplate from "./prelude.py" with { type: "text" };
import declarationsTypes from "./declarations.d.ts" with { type: "text" };

import {
  generateDirectMethods,
  generateElementMethods,
  generateFrameMethods,
  generatePyMethods,
  generateDeclarations,
} from "./browser-surface-macro.ts";

function substituteJs(template: string): string {
  return template
    .replace("/*__GENERATED_directMethods__*/[]",  generateDirectMethods())
    .replace("/*__GENERATED_elementMethods__*/[]", generateElementMethods())
    .replace("/*__GENERATED_frameMethods__*/[]",   generateFrameMethods());
}

function substitutePy(template: string): string {
  return template.replace("(__GENERATED_PY__)", generatePyMethods());
}

/**
 * Build the browser eval facade after an eval runtime first requests
 * preludes. Called once per (session, kernel-language) pair.
 */
export function createBrowserPreludeDefinition(
  session: ToolSession,
  host: Pick<EvalPreludeDefinition, "invoke" | "status">,
): EvalPreludeDefinition {
  return {
    name: "browser",
    documentation: browserDescription,
    javascript: substituteJs(preludeJsTemplate),
    python: substitutePy(preludePyTemplate),
    exports: ["browser"],
    codeModeDeclarations: declarationsTypes + "\n\n" + generateDeclarations(),
    approval: "exec",
    enabled: () => session.settings.get("browser.enabled"),
    invoke: host.invoke,
    status: host.status,
  };
}
