/**
 * coercion-freeinference-deepseek.test.ts — REAL-LIVE provider TDD for the
 * coercion layer (architect order 2026-11-02: "coercion.ts needs more real life
 * freeinference/deepseek tdd").
 *
 * These tests pin the CONTRACT against real model output shapes from the two
 * lanes the estate actually runs: freeinference (primary fast inference) and
 * deepseek (memory/reasoning lanes). The fixtures are REAL observed output
 * shapes (from session history + the estate's live traces), not invented
 * "should" contracts — code is absolute (AGENTS.md §1.6).
 *
 * The LIVE network probe (marked test.skipIf) runs only when
 * FREEINFERENCE_API_KEY is resolvable — so the suite stays deterministic in CI
 * while proving the live lane in dev (TDD-first ground truth rule).
 */
import { describe, expect, test } from "bun:test";
import {
	coerceValue,
	decodeValue,
	isMarkdownList,
	parseMarkdownItem,
	parseMarkdownList,
	isArraySchema,
} from "../src/dialect/coercion";

// ---------- provider fixture shapes (REAL observed output) ----------

// DeepSeek V4 (FreeInference lane) renders flat string arrays with per-item
// checklist prefixes INSIDE the JSON array — the exact bug class the todo board
// hit (tasks persisted with literal "- [ ] " prefixes).
const DEEPSEEK_V4_ITEM_PREFIXED_ARRAY = {
	raw: `["- [ ] Reproduce the reported issue locally", "- [x] Fix coercion at the root", "1. Verify contract test green"]`,
	schema: { type: "array", items: { type: "string" } },
	expected: [
		"Reproduce the reported issue locally",
		"Fix coercion at the root",
		"Verify contract test green",
	],
};

// FreeInference GLM-5.3-flash renders arrays as a WHOLE markdown checklist
// string (no JSON wrapper) — the Dots shape.
const GLM_CHECKLIST_WHOLE = {
	raw: "## Tasks\n- [ ] first task\n- [ ] second task",
	schema: { type: "array", items: { type: "string" } },
	expected: ["first task", "second task"],
};

// DeepSeek reasoning lanes sometimes double-encode JSON strings.
const DOUBLE_ENCODED = {
	raw: `"[300, 2500]"`,
	schema: { type: "array", items: { type: "number" } },
	expected: [300, 2500],
};

describe("real provider shapes: deepseek v4 item-prefixed array", () => {
	test("each array ELEMENT carries a markup prefix — decode then strip per item", () => {
		const parsed = decodeValue(DEEPSEEK_V4_ITEM_PREFIXED_ARRAY.raw, DEEPSEEK_V4_ITEM_PREFIXED_ARRAY.schema);
		expect(Array.isArray(parsed)).toBe(true);
		// The array parses as JSON fine — the PREFIXES are inside the elements.
		expect(parsed).toEqual([
			"- [ ] Reproduce the reported issue locally",
			"- [x] Fix coercion at the root",
			"1. Verify contract test green",
		]);
		// Per-item strip recovers clean tasks (the todo-board contract):
		const clean = (parsed as string[]).map(parseMarkdownItem);
		expect(clean).toEqual(DEEPSEEK_V4_ITEM_PREFIXED_ARRAY.expected);
	});

	test("array of prefixed items is NOT a whole-list string (isMarkdownList false)", () => {
		// The RAW is a JSON array — decodeValue handles it via JSON.parse first;
		// isMarkdownList is for the WHOLE-STRING shape only.
		expect(isMarkdownList(DEEPSEEK_V4_ITEM_PREFIXED_ARRAY.raw)).toBe(false);
	});
});

describe("real provider shapes: GLM whole-checklist string", () => {
	test("markdown-list recovery for array schema (Dots shape)", () => {
		const result = coerceValue(GLM_CHECKLIST_WHOLE.raw, GLM_CHECKLIST_WHOLE.schema);
		expect(result).toEqual(GLM_CHECKLIST_WHOLE.expected);
	});

	test("same raw against OBJECT schema stays a string (no false recovery)", () => {
		const result = coerceValue(GLM_CHECKLIST_WHOLE.raw, { type: "object" });
		expect(result).toBe(GLM_CHECKLIST_WHOLE.raw);
	});
});

describe("real provider shapes: deepseek double-encoded JSON", () => {
	test("nested JSON string parses through", () => {
		const result = decodeValue(DOUBLE_ENCODED.raw, DOUBLE_ENCODED.schema);
		expect(result).toEqual(DOUBLE_ENCODED.expected);
	});
});

describe("schema helpers (provider-agnostic contracts)", () => {
	test("isArraySchema across type-array and anyOf shapes", () => {
		expect(isArraySchema({ type: "array" })).toBe(true);
		expect(isArraySchema({ type: ["array", "null"] })).toBe(true);
		expect(isArraySchema({ anyOf: [{ type: "array" }, { type: "null" }] })).toBe(true);
		expect(isArraySchema({ type: "string" })).toBe(false);
	});

	test("malformed JSON container string with array schema surfaces top-level error path", () => {
		// CHANGELOG contract: "malformed JSON container strings for array schema
		// fields surface expected array, received string" — the recovery lane
		// returns the RAW string when it isn't valid JSON AND isn't a list.
		const result = decodeValue("{not json at all", { type: "array" });
		expect(result).toBe("{not json at all");
	});
});

// ---------- LIVE provider probes (skipIf no key) ----------

const hasKey = (() => {
	try {
		const p = Bun.spawnSync(["secretsmith", "env"], { stdout: "pipe", stderr: "pipe", timeout: 15000 });
		const out = new TextDecoder().decode(p.stdout || new Uint8Array());
		return /FREEINFERENCE_API_KEY=.+/i.test(out);
	} catch {
		return false;
	}
})();

describe("LIVE: freeinference + deepseek coercion round-trip", () => {
	test.skipIf(!hasKey)(
		"deepseek-v4-flash emits a todo list the coercion layer recovers verbatim",
		async () => {
			const p = Bun.spawnSync(["secretsmith", "env"], { stdout: "pipe", timeout: 15000 });
			const out = new TextDecoder().decode(p.stdout || new Uint8Array());
			let key = "";
			for (const line of out.split("\n")) {
				if (line.startsWith("FREEINFERENCE_API_KEY=")) key = line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
			}
			expect(key).toBeTruthy();

			const res = await fetch("https://freeinference.org/v1/chat/completions", {
				method: "POST",
				headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "curl/8.23.0" }, // UA needed: CF blocks default UA (anomaly #14)
				body: JSON.stringify({
					model: "deepseek-v4-flash",
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
				DEEPSEEK_V4_ITEM_PREFIXED_ARRAY.schema,
			) as unknown;
			const tasks = Array.isArray(recovered)
				? recovered.map((t) => parseMarkdownItem(String(t)))
				: (isMarkdownList(String(recovered)) ? parseMarkdownList(String(recovered)) : [String(recovered)]);
			expect(tasks.length).toBeGreaterThanOrEqual(3); // deepseek emits 3 clean tasks
			for (const t of tasks) {
				// no markup prefix survives — the todo-board display contract
				expect(t.startsWith("- [")).toBe(false);
				expect(t.startsWith("* ")).toBe(false);
				expect(t.startsWith("1. ")).toBe(false);
			}
		},
		30000,
	);
});
