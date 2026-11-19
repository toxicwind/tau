/**
 * polyglot-cascade.live.ts — REAL-LIVE multi-model A/B benchmark of the
 * polyglot cascade against the plain dialect parser, via tau's provider stack.
 * Run manually (NOT part of the bun suite):
 *
 *   bun packages/ai/test/polyglot-cascade.live.ts
 *
 * Trigger: each model is told the WRONG dialect (XML). Models with a
 * distinctive native dialect (GLM, Qwen, Kimi, MiniMax, Gemma, mercury) tend
 * to drift back to their native form, which the plain XML parser rejects
 * (flail). The polyglot cascade recognizes the drifted dialect and recovers.
 *
 * Routes through the mimetite router (:25193) — the estate's canonical entry —
 * using bundled models with baseUrl overridden to the router. The router key
 * comes from ~/.tau/router.key (or PATCHLING_ROUTER_KEY).
 *
 * Models: POLYGLOT_LIVE_MODELS (comma-separated) overrides the default set.
 */
import { streamOpenAICompletions } from "@tau/tau-ai/providers/openai-completions";
import type { Context, Model } from "@tau/tau-ai/types";
import { getBundledModel } from "@tau/tau-catalog/models";
import type { AssistantMessage } from "../src/types";
import { parseInbandToolMessage, parseInbandToolMessagePolyglot } from "../src/dialect/owned-stream";

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

// Router-qualified ids the mimetite router resolves. Bundled provider per id
// (where one exists) is used for the Model shape; baseUrl is overridden to the
// router and requestModelId carries the router id.
const DEFAULT_MODELS: Array<{ routerId: string; provider: string; bundledId: string }> = [
	{ routerId: "deepseek-v4-flash", provider: "deepseek", bundledId: "deepseek-v4-flash" },
	{ routerId: "qwen3.6-35b", provider: "kilo", bundledId: "qwen/qwen3.6-35b-a3b" },
	{ routerId: "nim-deepseek-v4-flash", provider: "kilo", bundledId: "inception/mercury-3" }, // shape-only; router maps
	{ routerId: "nim-minimax", provider: "kilo", bundledId: "inception/mercury-3" }, // shape-only; router maps
	{ routerId: "mercury-3", provider: "kilo", bundledId: "inception/mercury-3" },
];

const MODELS = (Bun.env.POLYGLOT_LIVE_MODELS ?? DEFAULT_MODELS.map((m) => m.routerId).join(","))
	.split(",").map((s) => s.trim()).filter(Boolean);

const TOOLS = [
	{ name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
	{ name: "grep", description: "Search file contents", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } },
];

const ALTERNATES = ["inception", "anthropic", "harmony", "hermes", "qwen3", "glm", "kimi", "minimax", "gemma", "deepseek"];

// Told the XML dialect — the WRONG dialect for most of these models.
const XML_DIALECT_PROMPT = `You may call one or more functions to assist with the user query.
Tool calls are emitted as text using the exact syntax below, not as native provider tool messages.

Available functions:
${TOOLS.map((t) => JSON.stringify(t)).join("\n")}

A call is one <invoke> element whose <parameter> children carry its arguments:
<invoke name="fn"><parameter name="arg">value</parameter></invoke>

TASK: Read the file at path 'src/main.ts'. Emit the tool call now.`;

function toMessage(raw: string): AssistantMessage {
	return { role: "assistant", content: [{ type: "text", text: raw }] };
}
function toolCallNames(m: AssistantMessage): string[] {
	return m.content.filter((b) => b.type === "toolCall").map((b) => b.name);
}

function buildModel(routerId: string): Model<"openai-completions"> {
	const entry = DEFAULT_MODELS.find((m) => m.routerId === routerId);
	if (!entry) {
		// Unknown id: construct a minimal Model routed to the router.
		return {
			id: routerId,
			name: routerId,
			api: "openai-completions",
			provider: "mimetite",
			baseUrl: ROUTER_URL,
			reasoning: false,
			identity: { class: "unknown", family: undefined, revision: undefined },
			requestModelId: routerId,
		} as Model<"openai-completions">;
	}
	const bundled = getBundledModel<"openai-completions">(entry.provider as any, entry.bundledId);
	return { ...bundled, baseUrl: ROUTER_URL, requestModelId: routerId };
}

async function main() {
	const apiKey = await resolveKey();
	if (!apiKey) {
		console.error("router key required: set PATCHLING_ROUTER_KEY or ~/.tau/router.key");
		process.exit(2);
	}

	let failures = 0;
	for (const routerId of MODELS) {
		const model = buildModel(routerId);
		const context: Context = {
			systemPrompt: [XML_DIALECT_PROMPT],
			messages: [{ role: "user", content: "Read src/main.ts", timestamp: Date.now() }],
		};

		console.log(`\n=== ${routerId} via ${ROUTER_URL} ===`);
		const stream = streamOpenAICompletions(model, context, { apiKey });

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

		console.log(`raw:\n${text.slice(0, 300)}\n`);
		if (firstError) {
			console.error(`stream error: ${firstError}`);
			failures++;
			continue;
		}
		if (!text.length) {
			console.error("empty stream — no content to parse");
			failures++;
			continue;
		}

		const msg = toMessage(text);
		const plain = parseInbandToolMessage(msg, "xml", TOOLS as any);
		const plainCalls = toolCallNames(plain);
		const polyglot = parseInbandToolMessagePolyglot(msg, "xml", TOOLS as any, ALTERNATES);
		const polyCalls = toolCallNames(polyglot);

		console.log(`plain=${plainCalls.length} ${JSON.stringify(plainCalls)} | polyglot=${polyCalls.length} ${JSON.stringify(polyCalls)}`);
		if (polyCalls.length < plainCalls.length) {
			console.error(`polyglot recovered fewer calls than plain parser for ${routerId}`);
			failures++;
		}
	}

	if (failures > 0) {
		console.error(`\n${failures} model(s) failed`);
		process.exit(1);
	}
	console.log("\nLIVE OK — polyglot cascade >= plain parser across all models.");
}

main().catch((err) => {
	console.error("unhandled:", err);
	process.exit(1);
});