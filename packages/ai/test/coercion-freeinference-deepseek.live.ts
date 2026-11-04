/**
 * coercion-freeinference-deepseek.live.ts — REAL-LIVE provider probe for the
 * coercion layer. Run manually (NOT part of the bun suite):
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
 * Model selection: COERCION_LIVE_MODEL overrides the completion model. The
 * FreeInference text family (deepseek-v4-flash, glm-5.3-flash, qwen3.6-35b)
 * all share the tool-call coercion surface; deepseek-v4-flash is the default.
 */
import { describe, expect, test } from "bun:test";
import {
	coerceValue,
	isMarkdownList,
	parseMarkdownItem,
	parseMarkdownList,
} from "../src/dialect/coercion";
import { getDesktopCommander } from "./desktop-commander-mcp-shim";

const COMPLETION_MODELS = ["deepseek-v4-flash", "glm-5.3-flash", "qwen3.6-35b"] as const;
const COMPLETION_MODEL = (Bun.env.COERCION_LIVE_MODEL ?? "deepseek-v4-flash") as (typeof COMPLETION_MODELS)[number];
if (!COMPLETION_MODELS.includes(COMPLETION_MODEL)) {
	throw new Error(
		`COERCION_LIVE_MODEL must be one of ${COMPLETION_MODELS.join(", ")} (got '${COMPLETION_MODEL}')`,
	);
}

const hasKey = (() => {
	try {
		const p = Bun.spawnSync(["secretsmith", "env"], { stdout: "pipe", stderr: "pipe", timeout: 15000 });
		const out = new TextDecoder().decode(p.stdout || new Uint8Array());
		return /FREEINFERENCE_API_KEY=.+/i.test(out);
	} catch {
		return false;
	}
})();

function resolveKey(): string {
	const p = Bun.spawnSync(["secretsmith", "env"], { stdout: "pipe", timeout: 15000 });
	const out = new TextDecoder().decode(p.stdout || new Uint8Array());
	for (const line of out.split("\n")) {
		if (line.startsWith("FREEINFERENCE_API_KEY=")) {
			return line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
		}
	}
	return "";
}

const ARRAY_SCHEMA = { type: "array", items: { type: "string" } };

describe("LIVE: freeinference coercion round-trip", () => {
	test.skipIf(!hasKey)(
		`${COMPLETION_MODEL} emits a todo list the coercion layer recovers verbatim`,
		async () => {
			const key = resolveKey();
			expect(key).toBeTruthy();

			const res = await fetch("https://freeinference.org/v1/chat/completions", {
				method: "POST",
				headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "curl/8.23.0" }, // UA needed: CF blocks default UA (anomaly #14)
				body: JSON.stringify({
					model: COMPLETION_MODEL,
					max_tokens: 2500, // reasoning-budget trap rule (#1): ≥2500
					messages: [
						{ role: "system", content: "You must call the add_tasks tool. Use it once." },
						{ role: "user", content: "Add three tasks: wash dishes, walk dog, write report" },
					],
					tools: [{
						type: "function",
						function: {
							name: "add_tasks",
							parameters: {
								type: "object",
								properties: { tasks: { type: "array", items: { type: "string" } } },
								required: ["tasks"],
							},
						},
					}],
				}),
			});
			expect(res.ok).toBe(true);
			const j: any = await res.json();
			const call = j.choices?.[0]?.message?.tool_calls?.[0];
			expect(call).toBeTruthy();
			const rawArgs = typeof call.function.arguments === "string"
				? call.function.arguments
				: JSON.stringify(call.function.arguments);
			// THE CONTRACT: whatever shape the model emitted (JSON array, prefixed
			// items, or whole checklist), the coercion layer recovers clean strings.
			// The tool schema wraps the array in an object (`{tasks: [...]}`), so
			// coerce against the `tasks` field's array schema — not the wrapper.
			const parsed = JSON.parse(rawArgs) as { tasks?: unknown };
			const recovered = coerceValue(
				typeof parsed.tasks === "string" ? parsed.tasks : JSON.stringify(parsed.tasks),
				ARRAY_SCHEMA,
			) as unknown;
			const tasks = Array.isArray(recovered)
				? recovered.map((t) => parseMarkdownItem(String(t)))
				: (isMarkdownList(String(recovered)) ? parseMarkdownList(String(recovered)) : [String(recovered)]);
			expect(tasks.length).toBeGreaterThanOrEqual(3); // model emits 3 clean tasks
			for (const t of tasks) {
				// no markup prefix survives — the todo-board display contract
				expect(t.startsWith("- [")).toBe(false);
				expect(t.startsWith("* ")).toBe(false);
				expect(t.startsWith("1. ")).toBe(false);
			}

			// DESKTOP COMMANDER WITNESS: the recovered tasks must LAND — write
			// them to disk via desktop-commander MCP (local shim fallback) and
			// read them back verbatim. Coercion that survives only in memory is
			// not proven; the file round-trip is the receipt.
			const dc = await getDesktopCommander();
			const witnessPath = `/tmp/coercion-live-witness-${Date.now()}.md`;
			const written = await dc.writeFile(witnessPath, tasks.map((t) => `- [ ] ${t}`).join("\n"));
			expect(written.ok).toBe(true);
			const readBack = await dc.readFile(witnessPath);
			expect(readBack).not.toBeNull();
			const reRecovered = (readBack as string).split("\n").map(parseMarkdownItem);
			expect(reRecovered).toEqual(tasks); // verbatim round-trip
			console.log(`[dc:${dc.via}] witness ${witnessPath}: ${tasks.length} tasks verbatim`);
		},
		30000,
	);
});