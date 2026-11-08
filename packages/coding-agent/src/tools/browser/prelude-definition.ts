import type { EvalPreludeDefinition } from "../../eval/preludes";
import browserDescription from "../../prompts/tools/browser.md" with { type: "text" };
import type { ToolSession } from "../../sdk";
import preludeJsTemplate from "./prelude.js" with { type: "text" };
import preludePyTemplate from "./prelude.py" with { type: "text" };
import { readFileSync } from "node:fs";
// declarations.d.ts cannot be imported with `with { type: "text" }` (TS special-cases `.d.ts` as type-only modules); read it at build time like the other prelude templates.
const declarationsTypes = readFileSync(new URL("./declarations.d.ts", import.meta.url), "utf8");

import {
	generateDirectMethods,
	generateElementMethods,
	generateFrameMethods,
	generatePyMethods,
	generateDeclarations,
} from "./browser-surface-macro.ts";

function substituteJs(template: string): string {
	return template
		.replace("/*__GENERATED_directMethods__*/[]", generateDirectMethods())
		.replace("/*__GENERATED_elementMethods__*/[]", generateElementMethods())
		.replace("/*__GENERATED_frameMethods__*/[]", generateFrameMethods());
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
