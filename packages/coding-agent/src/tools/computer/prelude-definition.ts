import computerDescription from "../../prompts/tools/computer.md" with { type: "text" };
import { readFileSync } from "node:fs";
// `.d.ts` cannot be imported as text (TS special-cases declaration files); read at build time.
const computerCodeModeDeclarations = readFileSync(new URL("./declarations.d.ts", import.meta.url), "utf8");
import computerJavascript from "./prelude.js" with { type: "text" };
import computerPython from "./prelude.py" with { type: "text" };

/** Static eval-facade assets loaded only when a kernel first requests computer preludes. */
export const computerPreludeAssets = {
	documentation: computerDescription,
	javascript: computerJavascript,
	python: computerPython,
	codeModeDeclarations: computerCodeModeDeclarations,
} as const;
