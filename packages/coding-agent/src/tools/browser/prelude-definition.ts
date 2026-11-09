import { prompt } from "@oh-my-pi/pi-utils";
import type { Settings } from "../../config/settings";
import type { EvalPreludeDefinition } from "../../eval/preludes";
import { redactUrlForLog } from "../../mcp/json-rpc";
import relayGuidance from "../../prompts/system/browser-relay.md" with { type: "text" };
import browserDescription from "../../prompts/tools/browser.md" with { type: "text" };
import type { ToolSession } from "../../sdk";
// refused_by: merge_ladder_exhausted · collision: `// @ts-expect-error Bun imports this declaration source as text…` +1 more
import preludeJsTemplate from "./prelude.js" with { type: "text" };
import preludePyTemplate from "./prelude.py" with { type: "text" };
// The declaration text lives in `declarations.txt` (not `.d.ts`): TypeScript
// special-cases `.d.ts` as type-only modules, so it cannot be imported with
// `with { type: "text" }` (TS2846), and `readFileSync(new URL(...))` at module
// scope breaks inside a compiled binary where the file is absent from the bunfs.
import declarationsTypes from "./declarations.txt" with { type: "text" };

import {
	generateDirectMethods,
	generateElementMethods,
	generateFrameMethods,
	generatePyMethods,
	generateDeclarations,
} from "./browser-surface-macro.ts";

/**
 * The browser eval documentation. Its Linux X11 notes follow the browser's host: they reach agents on Linux, and
 * elsewhere when a configured browser (`browser.cdpUrl`, `browser.relayUrl`) is on another machine, which may be Linux.
 */
export function browserDocumentation(settings: Settings, platform: NodeJS.Platform = process.platform): string {
	const remoteBrowser = [cfgBrowserCdpUrl.get(settings), cfgBrowserRelayUrl.get(settings)].some(
		url => typeof url === "string" && url.trim() !== "" && !isLoopbackRelayUrl(url.trim()),
	);
	return prompt.render(browserDescription, { linux: platform === "linux" || remoteBrowser });
}

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
	host: Pick<EvalPreludeDefinition, "invoke" | "status"> & {
		/** Where an open with `app.relay: false` goes; set only while an open without `app` goes to the relay. */
		relayFallback?: BrowserKind;
	},
): EvalPreludeDefinition {
	const fallback = host.relayFallback;
	return {
		name: "browser",
		// Read per use: the definition is built once per session, while the browser settings it follows can change.
		get documentation() {
			return browserDocumentation(session.settings);
		},
		guidance: fallback
			? prompt.render(relayGuidance, {
					// The block reaches the model provider: never echo userinfo or token params.
					cdpUrl: fallback.kind === "connected" ? redactUrlForLog(fallback.cdpUrl) : undefined,
					tern: fallback.kind === "tern",
					cmux: fallback.kind === "cmux",
				})
			: undefined,
		javascript: browserJavascript,
		python: browserPython,
		exports: ["browser"],
		approval: "exec",
		enabled: () => cfgBrowserEnabled.get(session.settings),
		invoke: host.invoke,
		status: host.status,
	};
// refused_by: statement_fold · collision: none (no common ancestor text)
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
