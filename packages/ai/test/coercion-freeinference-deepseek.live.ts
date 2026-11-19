/**
 * coercion-freeinference-deepseek.live.ts — REAL-LIVE provider probe for the
 * coercion layer, via tau's provider stack. Run manually (NOT part of the bun
 * suite):
 *
 *   bun packages/ai/test/coercion-freeinference-deepseek.live.ts
 *
 * Fires a real freeinference chat completion that MUST emit a tool call, then
 * proves the coercion layer recovers clean strings from whatever shape the
 * model actually produced (JSON array, per-item prefixed array, or whole
 * checklist). This is the ground-truth contract: the deterministic fixture
 * shapes in coercion-freeinference-deepseek.test.ts are pinned against the
 * shapes this live probe observes.
 *
 * Routes through the mimetite router (:25193) using the bundled model with
 * baseUrl overridden to the router. The router key comes from ~/.tau/router.key
 * (or PATCHLING_ROUTER_KEY).
 *
 * Model selection: COERCION_LIVE_MODEL overrides the completion model.
 */
import { streamOpenAICompletions } from "@tau/tau-ai/providers/openai-completions";
import type { Context, Model } from "@tau/tau-ai/types";
import { getBundledModel } from "@tau/tau-catalog/models";
import {
	coerceValue,
	isMarkdownList,
	parseMarkdownItem,
	parseMarkdownList,
} from "../src/dialect/coercion";
import { getDesktopCommander } from "./desktop-commander-mcp-shim";

const COMPLETION_MODELS = ["deepseek-v4-flash", "qwen3.6-35b"] as const;
const COMPLETION_MODEL = (Bun.env.COERCION_LIVE_MODEL ?? "deepseek-v4-flash") as (typeof COMPLETION_MODELS)[number];
if (!COMPLETION_MODELS.includes(COMPLETION_MODEL)) {
	throw new Error(
		`COERCION_LIVE_MODEL must be one of ${COMPLETION_MODELS.join(", ")} (got '${COMPLETION_MODEL}')`,
	);
}

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

const ARRAY_SCHEMA = { type: "array", items: { type: "string" } };

const ADD_TASKS_TOOL = {
	name: "add_tasks",
	description: "Add tasks to a todo list",
	parameters: {
		type: "object",
		properties: { tasks: { type: "array", items: { type: "string" } } },
		required: ["tasks"],
	},
};

async function main() {
	const apiKey = await resolveKey();
	if (!apiKey) {
		console.error("router key required: set PATCHLING_ROUTER_KEY or ~/.tau/router.key");
		process.exit(2);
	}

	const bundled = getBundledModel<"openai-completions">("deepseek", COMPLETION_MODEL);
	const model: Model<"openai-completions"> = { ...bundled, baseUrl: ROUTER_URL, requestModelId: COMPLETION_MODEL };

	const context: Context = {
		systemPrompt: ["You must call the add_tasks tool. Use it once."],
		messages: [{ role: "user", content: "Add three tasks: wash dishes, walk dog, write report", timestamp: Date.now() }],
		tools: [ADD_TASKS_TOOL as any],
	};

	console.log(`\n=== ${COMPLETION_MODEL} via ${ROUTER_URL} ===`);
	const stream = streamOpenAICompletions(model, context, { apiKey, maxTokens: 2500 });

	let toolCall: { name: string; arguments: string } | undefined;
	let firstError: unknown;
	for await (const ev of stream) {
		if (ev.type === "toolcall_end") {
			toolCall = { name: ev.toolCall.name, arguments: JSON.stringify(ev.toolCall.arguments) };
		} else if (ev.type === "error") {
			firstError = ev.error.errorMessage ?? ev.error;
		}
	}
	if (firstError) {
		console.error("stream error:", firstError);
		process.exit(1);
	}
	if (!toolCall) {
		console.error("no tool call emitted by model");
		process.exit(1);
	}
	console.log(`tool call: ${toolCall.name} ${toolCall.arguments.slice(0, 200)}`);

	// THE CONTRACT: whatever shape the model emitted (JSON array, prefixed
	// items, or whole checklist), the coercion layer recovers clean strings.
	const parsed = JSON.parse(toolCall.arguments) as { tasks?: unknown };
	const recovered = coerceValue(
		typeof parsed.tasks === "string" ? parsed.tasks : JSON.stringify(parsed.tasks),
		ARRAY_SCHEMA,
	) as unknown;
	const tasks = Array.isArray(recovered)
		? recovered.map((t) => parseMarkdownItem(String(t)))
		: (isMarkdownList(String(recovered)) ? parseMarkdownList(String(recovered)) : [String(recovered)]);
	if (tasks.length < 3) {
		console.error(`expected >=3 tasks, got ${tasks.length}`);
		process.exit(1);
	}
	for (const t of tasks) {
		if (t.startsWith("- [") || t.startsWith("* ") || t.startsWith("1. ")) {
			console.error(`markup prefix survived: ${JSON.stringify(t)}`);
			process.exit(1);
		}
	}

	// DESKTOP COMMANDER WITNESS: the recovered tasks must LAND — write them to
	// disk via desktop-commander MCP (local shim fallback) and read them back
	// verbatim. Coercion that survives only in memory is not proven; the file
	// round-trip is the receipt.
	const dc = await getDesktopCommander();
	const witnessPath = `/tmp/coercion-live-witness-${Date.now()}.md`;
	const written = await dc.writeFile(witnessPath, tasks.map((t) => `- [ ] ${t}`).join("\n"));
	if (!written.ok) {
		console.error("desktop-commander write failed");
		process.exit(1);
	}
	const readBack = await dc.readFile(witnessPath);
	if (readBack === null) {
		console.error("desktop-commander read-back failed");
		process.exit(1);
	}
	const reRecovered = (readBack as string).split("\n").map(parseMarkdownItem);
	if (JSON.stringify(reRecovered) !== JSON.stringify(tasks)) {
		console.error("round-trip mismatch");
		process.exit(1);
	}
	console.log(`[dc:${dc.via}] witness ${witnessPath}: ${tasks.length} tasks verbatim`);
	console.log("\nLIVE OK — coercion recovered tasks verbatim via tau provider stack.");
}

main().catch((err) => {
	console.error("unhandled:", err);
	process.exit(1);
});