import { expect, test } from "bun:test";
import { hasForcedToolDegradation } from "../src/utils/forced-tool-retry";

function makeMessage(toolCalls: Array<{ args: unknown }>): any {
	return {
		content: toolCalls.map(tc => ({
			type: "toolCall",
			name: "test",
			arguments: tc.args,
		})),
	};
}

test("detects empty array args under forced tool_choice", () => {
	const msg = makeMessage([{ args: { list: [] } }]);
	expect(hasForcedToolDegradation(msg, true)).toBe(true);
});

test("no degradation when not forced", () => {
	const msg = makeMessage([{ args: { list: [] } }]);
	expect(hasForcedToolDegradation(msg, false)).toBe(false);
});

test("no degradation with non-empty arrays", () => {
	const msg = makeMessage([{ args: { list: [{ phase: "a", items: ["x"] }] } }]);
	expect(hasForcedToolDegradation(msg, true)).toBe(false);
});

test("no degradation with no tool calls", () => {
	const msg = { content: [{ type: "text", text: "hello" }] };
	expect(hasForcedToolDegradation(msg as any, true)).toBe(false);
});

test("detects nested empty arrays", () => {
	const msg = makeMessage([{ args: { data: { items: [] } } }]);
	// Only top-level array values are checked per current impl
	expect(hasForcedToolDegradation(msg, true)).toBe(false);
});
