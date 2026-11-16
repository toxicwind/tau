/**
 * stream-markup-healing.live.ts — REAL-LIVE verification that the `inception`
 * healing pattern recovers mercury's mangled `<|inc_tool_call_ml|>` markers
 * from an actual response. Run manually (NOT part of the bun suite):
 *
 *   bun packages/ai/test/stream-markup-healing.live.ts
 *
 * Trigger: mercury-3 (OpenAI-compatible) is told the XML dialect (the WRONG
 * dialect for it). It emits mangled markers into the visible-text channel.
 * The `inception` healing pattern must turn them into a structured tool call
 * (not visible text) — the exact fix for the mercury flail.
 *
 * Model selection: STREAM_HEALING_LIVE_MODEL overrides the completion model.
 */
import { describe, expect, test } from "bun:test";
import { StreamMarkupHealing } from "../src/utils/stream-markup-healing";

const COMPLETION_MODELS = ["mercury-3"] as const;
const COMPLETION_MODEL = (Bun.env.STREAM_HEALING_LIVE_MODEL ?? "mercury-3") as (typeof COMPLETION_MODELS)[number];
if (!COMPLETION_MODELS.includes(COMPLETION_MODEL)) {
	throw new Error(
		`STREAM_HEALING_LIVE_MODEL must be one of ${COMPLETION_MODELS.join(", ")} (got '${COMPLETION_MODEL}')`,
	);
}

// Route through the mimetite router (:25193) — the estate's canonical entry.
const BASE_URL = Bun.env.PATCHLING_ROUTER_URL ?? "http://127.0.0.1:25193/v1";

const hasKey = (() => {
	try {
		const f = Bun.env.PATCHLING_ROUTER_KEY_FILE ?? `${Bun.env.HOME}/.tau/router.key`;
		const key = Bun.env.PATCHLING_ROUTER_KEY ?? Bun.env.RHODOCHROSITE_KEY;
		return Boolean(key) || Bun.file(f).exists();
	} catch {
		return false;
	}
})();

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

// Told the XML dialect — the WRONG dialect for mercury.
const XML_DIALECT_PROMPT = `You may call one or more functions to assist with the user query.
Tool calls are emitted as text using the exact syntax below, not as native provider tool messages.

Available functions:
${TOOLS.map(t => JSON.stringify(t)).join("\n")}

A call is one <invoke> element whose <parameter> children carry its arguments:
<invoke name="fn"><parameter name="arg">value</parameter></invoke>

TASK: List files matching the path glob 'src/main.ts'. Emit the tool call now.`;

describe("LIVE: StreamMarkupHealing inception pattern vs real mercury", () => {
	test.skipIf(!hasKey)(
		`${COMPLETION_MODEL} told XML dialect: mangled markers healed by inception pattern`,
		async () => {
			const key = await resolveKey();
			expect(key).toBeTruthy();

			const res = await fetch(`${BASE_URL}/chat/completions`, {
				method: "POST",
				headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "curl/8.23.0" },
				body: JSON.stringify({
					model: COMPLETION_MODEL,
					max_tokens: 2500,
					messages: [{ role: "user", content: XML_DIALECT_PROMPT }],
				}),
			});
			expect(res.ok).toBe(true);
			const j: any = await res.json();
			const raw = j.choices?.[0]?.message?.content ?? "";
			expect(raw.length).toBeGreaterThan(0);
			console.log(`\n=== ${COMPLETION_MODEL} ===\nraw:\n${raw.slice(0, 300)}\n`);

			// THE CONTRACT: the inception healing pattern recovers the tool call
			// from whatever shape mercury actually emitted (mangled or clean).
			const healer = new StreamMarkupHealing({ pattern: "inception" });
			const events = healer.feedEvents(raw);
			const calls = events.filter((e) => e.type === "toolCall");
			console.log(`healed calls: ${calls.length}`);
			for (const c of calls) {
				if (c.type === "toolCall") console.log(`- ${c.call.name} ${c.call.arguments}`);
			}
			expect(calls.length).toBeGreaterThanOrEqual(1);
		},
		30000,
	);
});