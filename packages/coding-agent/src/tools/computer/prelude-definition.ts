import computerDescription from "../../prompts/tools/computer.md" with { type: "text" };
// The declaration text lives in `declarations.txt` (not `.d.ts`): TypeScript
// special-cases `.d.ts` as type-only modules, so it cannot be imported with
// `with { type: "text" }` (TS2846), and `readFileSync(new URL(...))` at module
// scope breaks inside a compiled binary where the file is absent from the bunfs.
import computerCodeModeDeclarations from "./declarations.txt" with { type: "text" };
import computerJavascript from "./prelude.js" with { type: "text" };
import computerPython from "./prelude.py" with { type: "text" };

/** Static eval-facade assets loaded only when a kernel first requests computer preludes. */
export const computerPreludeAssets = {
	documentation: computerDescription,
	javascript: computerJavascript,
	python: computerPython,
	codeModeDeclarations: computerCodeModeDeclarations,
} as const;
