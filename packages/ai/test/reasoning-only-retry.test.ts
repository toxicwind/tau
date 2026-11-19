import { expect, test } from "bun:test";
import { hasReasoningOnlyEmptyContent } from "../src/utils/reasoning-only-retry";

function makeMessage(opts: { stopReason?: string; content?: any[]; reasoningDetails?: unknown[] }): any {
	return {
		stopReason: opts.stopReason ?? "stop",
		content: opts.content ?? [],
		messageReasoningDetails: opts.reasoningDetails,
	};
}

test("detects finish=stop with thinking but zero content", () => {
	const msg = makeMessage({
		content: [{ type: "thinking", thinking: "plan: answer concisely" }],
	});
	expect(hasReasoningOnlyEmptyContent(msg)).toBe(true);
});

test("detects via message-level reasoning_details", () => {
	const msg = makeMessage({
		content: [],
		reasoningDetails: [{ id: "rs_1", summary: "thinking..." }],
	});
	expect(hasReasoningOnlyEmptyContent(msg)).toBe(true);
});

test("no retry when content is present", () => {
	const msg = makeMessage({
		content: [
			{ type: "thinking", thinking: "plan" },
			{ type: "text", text: "the answer" },
		],
	});
	expect(hasReasoningOnlyEmptyContent(msg)).toBe(false);
});

test("no retry when a tool call is present", () => {
	const msg = makeMessage({
		content: [
			{ type: "thinking", thinking: "plan" },
			{ type: "toolCall", name: "exec", arguments: { cmd: "ls" } },
		],
	});
	expect(hasReasoningOnlyEmptyContent(msg)).toBe(false);
});

test("no retry when reasoning is empty", () => {
	const msg = makeMessage({ content: [] });
	expect(hasReasoningOnlyEmptyContent(msg)).toBe(false);
});

test("no retry when stopReason is length", () => {
	const msg = makeMessage({
		stopReason: "length",
		content: [{ type: "thinking", thinking: "cut off mid-plan" }],
	});
	expect(hasReasoningOnlyEmptyContent(msg)).toBe(false);
});

test("no retry when stopReason is error", () => {
	const msg = makeMessage({
		stopReason: "error",
		content: [{ type: "thinking", thinking: "plan" }],
	});
	expect(hasReasoningOnlyEmptyContent(msg)).toBe(false);
});

test("redactedThinking counts as reasoning", () => {
	const msg = makeMessage({
		content: [{ type: "redactedThinking", data: "encrypted" }],
	});
	expect(hasReasoningOnlyEmptyContent(msg)).toBe(true);
});

test("empty thinking string does not count as reasoning", () => {
	const msg = makeMessage({
		content: [{ type: "thinking", thinking: "" }],
	});
	expect(hasReasoningOnlyEmptyContent(msg)).toBe(false);
});

test("empty text block does not count as content", () => {
	const msg = makeMessage({
		content: [
			{ type: "thinking", thinking: "plan" },
			{ type: "text", text: "" },
		],
	});
	expect(hasReasoningOnlyEmptyContent(msg)).toBe(true);
});
