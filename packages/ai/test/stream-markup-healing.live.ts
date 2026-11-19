/**
 * stream-markup-healing.live.ts — REAL-LIVE verification that the `inception`
 * healing pattern recovers mercury's mangled `<|inc_tool_call_ml|>` markers
 * from an actual response via tau's provider stack. Run manually (NOT part of
 * the bun suite):
 *
 *   bun packages/ai/test/stream-markup-healing.live.ts
 *
 * Routes through the mimetite router (:25193) — the estate's canonical entry —
 * using the bundled mercury-3 model with its baseUrl overridden to the router.
 * The router key comes from ~/.tau/router.key (or PATCHLING_ROUTER_KEY).
 *
 * Trigger: mercury-3 (OpenAI-compatible) is told the XML dialect (the WRONG
 * dialect for it) with NO native tools in the request, so it MUST emit the
 * tool call as visible text. It emits mangled `<|inc_tool_call_ml|>` markers (or clean XML)
 * into the visible-text channel. The `inception` healing pattern must turn
 * them into a structured tool call — the exact fix for the mercury flail.
 */
import { streamOpenAICompletions } from "@tau/tau-ai/providers/openai-completions";
import type { Context, Model } from "@tau/tau-ai/types";
import { getBundledModel } from "@tau/tau-catalog/models";
import { StreamMarkupHealing } from "@tau/tau-ai/utils/stream-markup-healing";

const ROUTER_URL = Bun.env.PATCHLING_ROUTER_URL ?? "http://127.0.0.1:25193/v1";

async function resolveKey(): Promise<string> {
	const envKey = Bun.env.PATCHLING_ROUTER_KEY ?? Bun.env.RHODOCHROSITE_KEY;
	if (envKey) return envKey;
	try {
		const f = Bun.env.PATCHLING_ROUTER_KEY_FILE ?? `${Bun.env.HOME}/.tau/router.key`;
		return (await Bun.file(f).text()).trim();
	} catch {
		return "";
	}
}

const TOOLS = [
	{ name: "glob", description: "List files matching a path glob", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
];

// Told the MANGLED XML dialect — the WRONG dialect for mercury. No native tools
// are sent, so mercury MUST emit the call as visible text. The prompt shows the
// mangled `<|inc_tool_call_ml|>` prefix as the expected syntax; mercury mirrors
// it back — the exact flail the inception scanner must heal.
const XML_DIALECT_PROMPT = `You may call one or more functions to assist with the user query.
Tool calls are emitted as text using the exact syntax below, not as native provider tool messages.

Available functions:
${TOOLS.map(t => JSON.stringify(t)).join("\n")}

A call is one <invoke> element whose <parameter> children carry its arguments. Every tag is prefixed with the mangled marker <|inc_tool_call_ml|>:

<|inc_tool_call_ml|invoke name="fn"><|inc_tool_call_ml|parameter name="arg">value</|inc_tool_call_ml|parameter></|inc_tool_call_ml|invoke>

TASK: List files matching the path glob 'src/main.ts'. Emit the tool call now using the mangled <|inc_tool_call_ml|> prefix on every tag.`;

async function main() {
	const apiKey = await resolveKey();
	if (!apiKey) {
		console.error("router key required: set PATCHLING_ROUTER_KEY or ~/.tau/router.key");
		process.exit(2);
	}

	// Bundled mercury-3 (kilo provider), baseUrl overridden to the mimetite router.
	const mercury = getBundledModel<"openai-completions">("kilo", "inception/mercury-3");
	const routedMercury: Model<"openai-completions"> = { ...mercury, baseUrl: ROUTER_URL };

	// NOTE: no `tools` in context → mercury cannot use native tool calling and
	// must emit the call as visible text (the flail scenario).
	const context: Context = {
		systemPrompt: [XML_DIALECT_PROMPT],
		messages: [{ role: "user", content: "List files matching src/main.ts", timestamp: Date.now() }],
	};

	console.log(`\n=== ${routedMercury.id} via ${ROUTER_URL} (no native tools) ===`);
	const stream = streamOpenAICompletions(routedMercury, context, {
		apiKey,
	});

	let text = "";
	let stopReason: string | undefined;
	let firstError: unknown;
	for await (const ev of stream) {
		if (ev.type === "text_delta") text += ev.delta;
		else if (ev.type === "done") stopReason = ev.reason;
		else if (ev.type === "error") {
			firstError = ev.error.errorMessage ?? ev.error;
			stopReason = ev.reason;
		}
	}

	console.log("raw text:", JSON.stringify(text.slice(0, 300)));
	console.log("stopReason:", stopReason);
	if (firstError) {
		console.error("stream error:", firstError);
		process.exit(1);
	}
	if (!text.length) {
		console.error("empty stream — no content to heal");
		process.exit(1);
	}

	// THE TRIGGER GUARD: the live test must actually provoke the mangled form,
	// not pass on clean XML. If mercury did not emit the mangled marker, the
	// test is not exercising the real failure path — fail loudly.
	if (!text.includes("<|inc_tool_call_ml|")) {
		console.error(`LIVE FAIL — mercury did not emit the mangled <|inc_tool_call_ml|> marker; got clean output instead:\n${JSON.stringify(text.slice(0, 300))}`);
		process.exit(1);
	}
	console.log("trigger guard: raw output contains mangled <|inc_tool_call_ml|> marker ✓");

	// THE CONTRACT: the inception healing pattern recovers the tool call
	// from whatever shape mercury actually emitted (mangled or clean).
	const healer = new StreamMarkupHealing({ pattern: "inception" });
	const events = healer.feedEvents(text);
	const calls = events.filter((e) => e.type === "toolCall");
	console.log(`healed calls: ${calls.length}`);
	for (const c of calls) {
		if (c.type === "toolCall") console.log(`- ${c.call.name} ${c.call.arguments}`);
	}
	if (calls.length < 1) {
		console.error("inception pattern failed to heal a tool call from mercury output");
		process.exit(1);
	}
	console.log("\nLIVE OK — inception pattern healed mercury tool call via tau provider stack.");
}

main().catch((err) => {
	console.error("unhandled:", err);
	process.exit(1);
});