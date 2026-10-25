import { describe, expect, test } from "bun:test";
import { applyGroqRequestShaping, isGroqRouted, stripGroqReasoningContent } from "../src/providers/groq-coercion";

describe("isGroqRouted", () => {
	test("true only when compat says Groq host", () => {
		expect(isGroqRouted({ isGroqHost: true })).toBe(true);
		expect(isGroqRouted({ isGroqHost: false })).toBe(false);
		expect(isGroqRouted(undefined)).toBe(false);
	});
});

describe("stripGroqReasoningContent", () => {
	test("assistant reasoning_content stripped, other fields kept", () => {
		const msgs = [
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "thinking out loud", reasoning_content: "internal chain", tool_calls: [] },
		];
		const out = stripGroqReasoningContent(msgs);
		expect("reasoning_content" in out[1]).toBe(false);
		expect(out[1].content).toBe("thinking out loud");
		expect((out[1] as { tool_calls: unknown[] }).tool_calls).toEqual([]);
		expect(out[0]).toBe(msgs[0]);
		// input not mutated
		expect("reasoning_content" in msgs[1]).toBe(true);
	});

	test("user messages with reasoning_content untouched", () => {
		const user = { role: "user", content: "x", reasoning_content: "y" };
		const msgs = [user];
		const out = stripGroqReasoningContent(msgs);
		expect(out).toBe(msgs);
		expect((out[0] as { reasoning_content: string }).reasoning_content).toBe("y");
	});

	test("tool messages untouched", () => {
		const tool = { role: "tool", content: "result" };
		const msgs = [tool];
		expect(stripGroqReasoningContent(msgs)).toBe(msgs);
	});

	test("returns same reference when nothing needs stripping", () => {
		const msgs = [
			{ role: "assistant", content: "clean" },
			{ role: "user", content: "hi" },
		];
		expect(stripGroqReasoningContent(msgs)).toBe(msgs);
	});

	test("strips from every assistant message carrying it", () => {
		const msgs = [
			{ role: "assistant", content: "a", reasoning_content: "r1" },
			{ role: "assistant", content: "b", reasoning_content: "r2" },
			{ role: "assistant", content: "c" },
		];
		const out = stripGroqReasoningContent(msgs);
		for (const m of out) expect("reasoning_content" in m).toBe(false);
		expect(out[2]).toBe(msgs[2]);
	});
});

describe("applyGroqRequestShaping", () => {
	test("no-op when not Groq-routed", () => {
		const params: Record<string, unknown> = { repetition_penalty: 1.1 };
		applyGroqRequestShaping(params, { isGroqHost: false });
		expect(params.repetition_penalty).toBe(1.1);
	});

	test("drops repetition_penalty on Groq, keeps the rest", () => {
		const params: Record<string, unknown> = {
			repetition_penalty: 1.1,
			presence_penalty: 0.5,
			frequency_penalty: 0.3,
			temperature: 0.7,
		};
		applyGroqRequestShaping(params, { isGroqHost: true });
		expect("repetition_penalty" in params).toBe(false);
		expect(params.presence_penalty).toBe(0.5);
		expect(params.frequency_penalty).toBe(0.3);
		expect(params.temperature).toBe(0.7);
	});

	test("absent repetition_penalty is a no-op", () => {
		const params: Record<string, unknown> = { temperature: 0.7 };
		applyGroqRequestShaping(params, { isGroqHost: true });
		expect(params).toEqual({ temperature: 0.7 });
	});

	test("repetitionPenalty:false keeps the field", () => {
		const params: Record<string, unknown> = { repetition_penalty: 1.1 };
		applyGroqRequestShaping(params, { isGroqHost: true }, { repetitionPenalty: false });
		expect(params.repetition_penalty).toBe(1.1);
	});
});
