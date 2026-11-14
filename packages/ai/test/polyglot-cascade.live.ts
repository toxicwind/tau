/**
 * polyglot-cascade.live.ts — REAL-LIVE multi-model A/B benchmark of the
 * polyglot cascade against the plain dialect parser. Run manually:
 *
 *   PI_POLYGLOT=1 bun test ./packages/ai/test/polyglot-cascade.live.ts
 *
 * Trigger: each model is told the WRONG dialect (XML). Models with a
 * distinctive native dialect (GLM, Qwen, Kimi, MiniMax, Gemma, mercury) tend
 * to drift back to their native form, which the plain XML parser rejects
 * (flail). The polyglot cascade recognizes the drifted dialect and recovers.
 *
 * Models: POLYGLOT_LIVE_MODELS (comma-separated) overrides the default set.
 */
import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "../src/types";
import { parseInbandToolMessage, parseInbandToolMessagePolyglot } from "../src/dialect/owned-stream";

const BASE_URL = Bun.env.POLYGLOT_ROUTER_URL ?? "http://127.0.0.1:25193/v1";
const DEFAULT_MODELS = [
	"deepseek-v4-flash",
	"qwen3.6-35b",
	"nim-deepseek-v4-flash",
	"nim-minimax",
	"mercury-3",
];
const MODELS = (Bun.env.POLYGLOT_LIVE_MODELS ?? DEFAULT_MODELS.join(","))
	.split(",").map(s => s.trim()).filter(Boolean);

const hasKey = (() => {
	try {
		const f = Bun.env.POLYGLOT_ROUTER_KEY_FILE ?? `${Bun.env.HOME}/.tau/router.key`;
		const key = Bun.env.POLYGLOT_ROUTER_KEY ?? Bun.env.RHODOCHROSITE_KEY;
		return Boolean(key) || Bun.file(f).exists();
	} catch {
		return false;
	}
})();

async function resolveKey(): Promise<string> {
	const envKey = Bun.env.POLYGLOT_ROUTER_KEY ?? Bun.env.RHODOCHROSITE_KEY;
	if (envKey) return envKey;
	try {
		const f = Bun.env.POLYGLOT_ROUTER_KEY_FILE ?? `${Bun.env.HOME}/.tau/router.key`;
		return (await Bun.file(f).text()).trim();
	} catch {
		return "";
	}
}

const TOOLS = [
	{ name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
	{ name: "grep", description: "Search file contents", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } },
];

const ALTERNATES = ["inception", "anthropic", "harmony", "hermes", "qwen3", "glm", "kimi", "minimax", "gemma", "deepseek"];

// Told the XML dialect — the WRONG dialect for most of these models.
const XML_DIALECT_PROMPT = `You may call one or more functions to assist with the user query.
Tool calls are emitted as text using the exact syntax below, not as native provider tool messages.

Available functions:
${TOOLS.map(t => JSON.stringify(t)).join("\n")}

A call is one <invoke> element whose <parameter> children carry its arguments:
<invoke name="fn"><parameter name="arg">value</parameter></invoke>

TASK: Read the file at path 'src/main.ts'. Emit the tool call now.`;

function toMessage(raw: string): AssistantMessage {
	return { role: "assistant", content: [{ type: "text", text: raw }] };
}
function toolCallNames(m: AssistantMessage): string[] {
	return m.content.filter(b => b.type === "toolCall").map(b => b.name);
}

describe("LIVE: polyglot cascade multi-model A/B", () => {
	for (const model of MODELS) {
		test.skipIf(!hasKey)(
			`${model} told XML dialect: plain vs polyglot`,
			async () => {
				const key = await resolveKey();
				expect(key).toBeTruthy();

				const res = await fetch(`${BASE_URL}/chat/completions`, {
					method: "POST",
					headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "curl/8.23.0" },
					body: JSON.stringify({
						model,
						max_tokens: 2500,
						messages: [{ role: "user", content: XML_DIALECT_PROMPT }],
					}),
				});
				expect(res.ok).toBe(true);
				const j: any = await res.json();
				const raw = j.choices?.[0]?.message?.content ?? "";
				expect(raw.length).toBeGreaterThan(0);
				console.log(`\n=== ${model} ===\nraw:\n${raw.slice(0, 300)}\n`);

				const msg = toMessage(raw);
				const plain = parseInbandToolMessage(msg, "xml", TOOLS as any);
				const plainCalls = toolCallNames(plain);
				const polyglot = parseInbandToolMessagePolyglot(msg, "xml", TOOLS as any, ALTERNATES);
				const polyCalls = toolCallNames(polyglot);

				console.log(`plain=${plainCalls.length} ${JSON.stringify(plainCalls)} | polyglot=${polyCalls.length} ${JSON.stringify(polyCalls)}`);
				expect(polyCalls.length).toBeGreaterThanOrEqual(plainCalls.length);
			},
			30000,
		);
	}

	test("deterministic: mangled mercury markers recovered by polyglot cascade", () => {
		const mangled =
			'<|inc_tool_call_ml||inc_tool_call_ml|_calls>\n' +
			'<|inc_tool_call_ml|invoke name="glob">\n' +
			'<|inc_tool_call_ml|parameter name="path" string="true">src/a.ts</|inc_tool_call_ml|parameter>\n' +
			'</|inc_tool_call_ml|invoke>\n' +
			'</|inc_tool_call_ml|tool_calls>';
		const msg = toMessage(mangled);
		const plain = parseInbandToolMessage(msg, "xml", TOOLS as any);
		const polyglot = parseInbandToolMessagePolyglot(msg, "xml", TOOLS as any, ALTERNATES);
		expect(toolCallNames(plain).length).toBe(0);
		expect(toolCallNames(polyglot)).toContain("glob");
	});

	// nim-minimax emits NESTED XML for complex args (its native dialect) instead
	// of JSON-in-parameter. omp's XML scanner reads `content` as a raw string,
	// which fails the `{lines:[...]}` schema. This is a genuine coercion flail.
	test("deterministic: minimax nested-XML args fail schema (coercion gap)", () => {
		const tools = [
			{ name: "edit", description: "edit", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "object", properties: { lines: { type: "array", items: { type: "string" } } } } } } },
		] as any;
		const minimaxOut =
			'<invoke name="edit"><parameter name="path">src/a.ts</parameter>' +
			'<parameter name="content"><lines><item>x</item><item>y</item></lines></parameter></invoke>';
		const msg = toMessage(minimaxOut);
		const result = parseInbandToolMessage(msg, "xml", tools);
		const call = result.content.find(b => b.type === "toolCall") as any;
		expect(call).toBeTruthy();
		const content = call.arguments?.content;
		console.log(`[minimax nested-XML] content arg = ${JSON.stringify(content)}`);
		// THE COERCION GAP: expected {lines:["x","y"]}, got a raw string.
		expect(typeof content).toBe("string");
		expect(content).toContain("<lines>");
	});
});