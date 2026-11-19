import { describe, expect, test } from "bun:test";
import {
	applyOpenRouterRequestShaping,
	applyOpenRouterStrictToolSchemas,
	isOpenRouterRouted,
	normalizeOpenRouterMessages,
	OPENROUTER_REASONING_MAX_TOKENS,
	OPENROUTER_STOP_SEQUENCES,
	OPENROUTER_TEMPERATURE,
} from "../src/providers/openrouter-coercion";

describe("isOpenRouterRouted", () => {
	test("true only when compat says OpenRouter host", () => {
		expect(isOpenRouterRouted({ isOpenRouterHost: true })).toBe(true);
		expect(isOpenRouterRouted({ isOpenRouterHost: false })).toBe(false);
		expect(isOpenRouterRouted(undefined)).toBe(false);
	});
});

describe("normalizeOpenRouterMessages", () => {
	test("assistant content null -> empty string", () => {
		const msgs = [
			{ role: "user", content: "hi" },
			{ role: "assistant", content: null, tool_calls: [] },
		];
		const out = normalizeOpenRouterMessages(msgs);
		expect(out[1].content).toBe("");
		expect(out[0]).toBe(msgs[0]);
	});

	test("assistant content undefined -> empty string", () => {
		const msgs: Array<{ role: string; content?: unknown }> = [{ role: "assistant" }];
		const out = normalizeOpenRouterMessages(msgs);
		expect(out[0].content).toBe("");
	});

	test("non-assistant messages untouched, input not mutated", () => {
		const tool = { role: "tool", content: null };
		const msgs = [tool];
		const out = normalizeOpenRouterMessages(msgs);
		expect(out[0].content).toBe(null);
		expect(out).toBe(msgs);
	});

	test("returns same reference when nothing needs patching", () => {
		const msgs = [{ role: "assistant", content: "text" }];
		expect(normalizeOpenRouterMessages(msgs)).toBe(msgs);
	});
});

describe("applyOpenRouterStrictToolSchemas", () => {
	test("injects strict + additionalProperties:false, deep-copied", () => {
		const tool = {
			type: "function",
			function: { name: "todo", parameters: { type: "object", properties: {} } },
		};
		type Shaped = { function: { strict?: boolean; parameters?: Record<string, unknown> } };
		const out = applyOpenRouterStrictToolSchemas([tool]) as Shaped[];
		expect(out[0].function.strict).toBe(true);
		expect(out[0].function.parameters?.additionalProperties).toBe(false);
		// original untouched
		expect((tool.function as Record<string, unknown>).strict).toBe(undefined);
		expect((tool.function.parameters as Record<string, unknown>).additionalProperties).toBe(undefined);
	});

	test("non-function tools pass through", () => {
		const other = { type: "custom", foo: 1 };
		expect(applyOpenRouterStrictToolSchemas([other])[0]).toBe(other);
	});

	test("function tool without parameters keeps strict, no parameters added", () => {
		const out = applyOpenRouterStrictToolSchemas([{ type: "function", function: { name: "x" } }]) as Array<{
			function: Record<string, unknown>;
		}>;
		expect(out[0].function.strict).toBe(true);
		expect(out[0].function.parameters).toBe(undefined);
	});
});

describe("applyOpenRouterRequestShaping (generalized estate-scriptsDotsClient coercions)", () => {
	test("no-op when not OpenRouter-routed", () => {
		const params: Record<string, unknown> = {};
		applyOpenRouterRequestShaping(params, { isOpenRouterHost: false });
		expect(params).toEqual({});
	});

	test("shapes ANY OpenRouter model: temperature + provider constraints", () => {
		const params: Record<string, unknown> = {};
		applyOpenRouterRequestShaping(params, { isOpenRouterHost: true });
		expect(params.temperature).toBe(OPENROUTER_TEMPERATURE);
		expect(params.provider).toEqual({ require_parameters: true, allow_fallbacks: false });
	});

	test("stop sequences skipped when require_parameters is in effect (unroutable combo)", () => {
		// Measured 2026-10-13: stop + require_parameters:true -> OpenRouter 404
		// "no endpoints found" on dots-3-note-preview:free. Provider wins.
		const params: Record<string, unknown> = {};
		applyOpenRouterRequestShaping(params, { isOpenRouterHost: true });
		expect(params.stop).toBe(undefined);
	});

	test("stop sequences applied when require_parameters is explicitly false", () => {
		const params: Record<string, unknown> = { provider: { require_parameters: false } };
		applyOpenRouterRequestShaping(params, { isOpenRouterHost: true });
		expect(params.stop).toEqual(OPENROUTER_STOP_SEQUENCES);
		expect(OPENROUTER_STOP_SEQUENCES).toContain("</tool_call>");
	});

	test("explicit caller values always win", () => {
		const params: Record<string, unknown> = {
			temperature: 0.7,
			reasoning: { effort: "high" },
			provider: { order: ["a"], allow_fallbacks: true },
		};
		applyOpenRouterRequestShaping(params, { isOpenRouterHost: true }, { reasoning: true });
		expect(params.temperature).toBe(0.7);
		// explicit reasoning config passes through 1:1 even with reasoning opt-in
		expect(params.reasoning).toEqual({ effort: "high" });
		expect(params.provider).toEqual({
			order: ["a"],
			require_parameters: true,
			allow_fallbacks: true,
		});
	});

	test("reasoning cap is opt-in and fill-in only", () => {
		const params: Record<string, unknown> = {};
		applyOpenRouterRequestShaping(params, { isOpenRouterHost: true }, { reasoning: true });
		expect(params.reasoning).toEqual({
			max_tokens: OPENROUTER_REASONING_MAX_TOKENS,
			exclude: true,
		});
		expect(OPENROUTER_REASONING_MAX_TOKENS).toBe(128);

		const off: Record<string, unknown> = {};
		applyOpenRouterRequestShaping(off, { isOpenRouterHost: true });
		expect(off.reasoning).toBe(undefined);
	});

	test("options can disable temperature/stop (Responses API)", () => {
		const params: Record<string, unknown> = { provider: { order: ["x"] } };
		applyOpenRouterRequestShaping(params, { isOpenRouterHost: true }, { temperature: false, stopSequences: false });
		expect(params.temperature).toBe(undefined);
		expect(params.stop).toBe(undefined);
		expect(params.provider).toEqual({
			order: ["x"],
			require_parameters: true,
			allow_fallbacks: false,
		});
	});
});
