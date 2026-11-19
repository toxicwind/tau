/**
 * coercion-freeinference-deepseek.test.ts — deterministic provider-shape TDD
 * for the coercion layer (architect order 2026-11-02: "coercion.ts needs more
 * real life freeinference/deepseek tdd").
 *
 * These tests pin the CONTRACT against REAL observed model output shapes from
 * the two lanes the estate actually runs: freeinference (primary fast
 * inference) and deepseek (memory/reasoning lanes). The fixtures are REAL
 * observed output shapes (from session history + the estate's live traces),
 * not invented "should" contracts — code is absolute (AGENTS.md §1.6).
 *
 * The LIVE network probe lives in coercion-freeinference-deepseek.live.ts
 * (run manually: bun packages/ai/test/coercion-freeinference-deepseek.live.ts).
 * This file is the offline-safe unit surface: it runs in CI with no key and
 * no network.
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

const ARRAY_SCHEMA = { type: "array", items: { type: "string" } };

describe("tool-call object wrapper (the live probe path, offline-pinned)", () => {
	// The live probe coerces the `tasks` FIELD of a tool-call args object:
	// {tasks: [...]} with field schema {type:"array", items:{type:"string"}}.
	// These tests pin that exact path offline so a coercion regression is
	// caught in CI, not only on the next manual live run.
	const WRAPPER_SCHEMA = {
		type: "object",
		properties: { tasks: { type: "array", items: { type: "string" } } },
		required: ["tasks"],
	};

	test("clean JSON array inside the wrapper coerces to clean strings", () => {
		const rawArgs = JSON.stringify({ tasks: ["wash dishes", "walk dog", "write report"] });
		const parsed = JSON.parse(rawArgs) as { tasks?: unknown };
		const recovered = coerceValue(JSON.stringify(parsed.tasks), ARRAY_SCHEMA);
		expect(recovered).toEqual(["wash dishes", "walk dog", "write report"]);
	});

	test("per-item prefixed array inside the wrapper strips per item (the todo-board contract)", () => {
		const parsed = { tasks: ["- [ ] wash dishes", "- [x] walk dog", "1. write report"] };
		const recovered = coerceValue(JSON.stringify(parsed.tasks), ARRAY_SCHEMA);
		expect(Array.isArray(recovered)).toBe(true);
		const clean = (recovered as string[]).map(parseMarkdownItem);
		expect(clean).toEqual(["wash dishes", "walk dog", "write report"]);
	});

	test("whole-checklist STRING inside the wrapper recovers via list parse (live fallback lane)", () => {
		// DeepSeek sometimes emits tasks as ONE markdown string inside the JSON
		// wrapper — the live probe's isMarkdownList/parseMarkdownList branch.
		const rawArgs = JSON.stringify({ tasks: "- [ ] wash dishes\n- [ ] walk dog\n- [ ] write report" });
		const parsed = JSON.parse(rawArgs) as { tasks?: unknown };
		const coerced = coerceValue(String(parsed.tasks), ARRAY_SCHEMA);
		const tasks = Array.isArray(coerced)
			? coerced.map((t) => parseMarkdownItem(String(t)))
			: (isMarkdownList(String(coerced)) ? parseMarkdownList(String(coerced)) : [String(coerced)]);
		expect(tasks).toEqual(["wash dishes", "walk dog", "write report"]);
	});
});