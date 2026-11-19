import { describe, expect, it } from "bun:test";
import {
	FREEINFERENCE_TOOL_MODELS,
	FREEINFERENCE_THINKING_BUDGET_RATIO,
	parseMarkdownItem,
	parseMarkdownList,
	coerceFreeInferenceValue,
	resolveFreeInferenceThinkingBudget,
} from "../src/dialect/freeinference-coercion";

// Real tool-call `arguments` captured live from FreeInference 2026-11-02 for
// each text model (bge-m3 is embeddings-only, no tool calling). All three emit
// flat string-array args as per-item markdown checklist lines inside the JSON.
const REAL_DEEPSEEK = {
	op: "init",
	list: [
		{
			phase: "Investigation",
			items: [
				"- [ ] Reproduce the reported issue locally",
				"- [ ] Identify root cause of the bug",
				"- [ ] Write failing test cases that capture the bug",
			],
		},
		{
			phase: "Shipping",
			items: ["- [ ] Implement the fix / feature changes", "- [ ] Ensure all tests pass (unit, integration, regression)"],
		},
	],
};

const REAL_GLM = {
	list: [
		{
			items: ["- [ ] Write report draft", "- [ ] Review pull requests", "- [ ] Schedule team meeting"],
			phase: "Work",
		},
	],
	op: "init",
};

const REAL_QWEN = {
	op: "init",
	list: [
		{
			phase: "Work",
			items: [
				"- [ ] Draft project proposal",
				"- [ ] Review team feedback",
				"- [ ] Schedule client meeting",
				"- [ ] Update project timeline",
			],
		},
	],
};

const REAL_PAYLOADS: Record<string, { list: Array<{ phase?: string; items: string[]; name?: string }> }> = {
	"deepseek-v4-flash": REAL_DEEPSEEK,
	"glm-5.3-flash": REAL_GLM,
	"qwen3.6-35b": REAL_QWEN,
};

const SCHEMA = {
	type: "array",
	items: { type: "string" },
};

describe("FREEINFERENCE_TOOL_MODELS", () => {
	it("lists exactly the three text models, skipping bge (embeddings-only)", () => {
		expect(FREEINFERENCE_TOOL_MODELS).toEqual(["deepseek-v4-flash", "glm-5.3-flash", "qwen3.6-35b"]);
		expect(FREEINFERENCE_TOOL_MODELS).not.toContain("bge-m3");
	});
});

describe("freeinference per-model tool-call coercion", () => {
	for (const model of FREEINFERENCE_TOOL_MODELS) {
		it(`${model}: strips markdown prefixes from array-item elements (real capture)`, () => {
			const { list } = REAL_PAYLOADS[model]!;
			for (const entry of list) {
				for (const item of entry.items) {
					expect(parseMarkdownItem(item)).toEqual(item.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "").trim());
				}
			}
		});

		it(`${model}: recovered items carry no literal '- [ ] ' prefix`, () => {
			const { list } = REAL_PAYLOADS[model]!;
			const items = list.flatMap(entry => entry.items).map(parseMarkdownItem);
			expect(items.every(item => !item.startsWith("- [ ] "))).toBe(true);
			expect(items.length).toBeGreaterThan(0);
		});
	}
});

describe("coerceFreeInferenceValue", () => {
	it("recovers a whole-checklist array value (Dots/family shape)", () => {
		const result = coerceFreeInferenceValue("## Work\n- [ ] one\n- [ ] two", SCHEMA);
		expect(result).toEqual(["one", "two"]);
	});

	it("falls back to raw text for a non-list, non-JSON value", () => {
		expect(coerceFreeInferenceValue("a task, no list", SCHEMA)).toBe("a task, no list");
	});
});

describe("parseMarkdownList vs parseMarkdownItem parity", () => {
	it("both recover the same contents from a whole-checklist string", () => {
		const raw = "- [ ] alpha\n- [ ] beta\n1. gamma";
		expect(parseMarkdownList(raw)).toEqual(["alpha", "beta", "gamma"]);
		expect(raw.split("\n").map(parseMarkdownItem)).toEqual(["alpha", "beta", "gamma"]);
	});
});

describe("resolveFreeInferenceThinkingBudget (reasoning-at-1/3)", () => {
	it("caps the thinking budget at ~1/3 of the model max-token ceiling", () => {
		// deepseek-v4-flash exposes an 8192 max-output ceiling on freeinference;
		// 1/3 ≈ 2730 — reasoning must not spend the whole completion budget.
		const budget = resolveFreeInferenceThinkingBudget(8192);
		expect(budget).toBe(Math.floor(8192 * FREEINFERENCE_THINKING_BUDGET_RATIO));
		expect(budget).toBeLessThan(8192);
	});

	it("prefers an explicit caller budget over the derived cap", () => {
		expect(resolveFreeInferenceThinkingBudget(8192, 4096)).toBe(4096);
	});

	it("returns the platform floor when the model reports no cap", () => {
		expect(resolveFreeInferenceThinkingBudget(null, undefined, 1024)).toBe(1024);
	});

	it("never returns a budget below the platform floor", () => {
		expect(resolveFreeInferenceThinkingBudget(512)).toBeGreaterThanOrEqual(1024);
	});
});
