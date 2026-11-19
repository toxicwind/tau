import { describe, expect, it } from "bun:test";
import { type } from "@tau/tautype";
import { agentLoop } from "@tau/tau-agent-core/agent-loop";
import type { AgentContext, AgentLoopConfig, AgentMessage, AgentTool } from "@tau/tau-agent-core/types";
import type { Message, ToolResultMessage } from "@tau/tau-ai";
import { createMockModel } from "@tau/tau-ai/providers/mock";
import { createUserMessage } from "./helpers";

// Simple identity converter for tests - just passes through standard messages
function identityConverter(messages: AgentMessage[]): Message[] {
	return messages.filter(m => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
}

describe("agentLoop tool chunking", () => {
	it("splits an oversized array argument into sequential chunked calls and merges the results", async () => {
		const toolSchema = type({ rows: "number[]" });
		const calls: number[][] = [];
		const tool: AgentTool<typeof toolSchema, number[]> = {
			name: "blob",
			label: "Blob",
			description: "Blob tool",
			parameters: toolSchema,
			chunking: { field: "rows", maxItems: 2 },
			async execute(_toolCallId, params) {
				calls.push([...params.rows]);
				return {
					content: [{ type: "text", text: `chunk:${params.rows.join(",")}` }],
					details: [...params.rows],
				};
			},
		};
		const context: AgentContext = { systemPrompt: [""], messages: [], tools: [tool] };
		const mock = createMockModel({
			responses: [
				{ content: [{ type: "toolCall", id: "tool-1", name: "blob", arguments: { rows: [1, 2, 3, 4, 5] } }] },
				{ content: ["done"] },
			],
		});
		const config: AgentLoopConfig = { model: mock.model, convertToLlm: identityConverter };
		const messages = await agentLoop([createUserMessage("go")], context, config, undefined, mock.stream).result();

		// Three sequential calls under the ceiling, order preserved.
		expect(calls).toEqual([[1, 2], [3, 4], [5]]);
		// A single merged tool result answers the single tool call.
		const toolResults = messages.filter(m => m.role === "toolResult") as ToolResultMessage[];
		expect(toolResults).toHaveLength(1);
		const texts = toolResults[0].content.filter(c => c.type === "text").map(c => (c as { text: string }).text);
		expect(texts).toEqual(["chunk:1,2", "chunk:3,4", "chunk:5"]);
		// Array details concatenate across chunks, in order.
		expect(toolResults[0].details).toEqual([1, 2, 3, 4, 5]);
	});

	it("does not chunk a tool that does not declare chunking", async () => {
		const toolSchema = type({ rows: "number[]" });
		const calls: number[][] = [];
		const tool: AgentTool<typeof toolSchema, number[]> = {
			name: "blob",
			label: "Blob",
			description: "Blob tool",
			parameters: toolSchema,
			async execute(_toolCallId, params) {
				calls.push([...params.rows]);
				return { content: [{ type: "text", text: "ok" }], details: [...params.rows] };
			},
		};
		const context: AgentContext = { systemPrompt: [""], messages: [], tools: [tool] };
		const mock = createMockModel({
			responses: [
				{ content: [{ type: "toolCall", id: "tool-1", name: "blob", arguments: { rows: [1, 2, 3, 4, 5] } }] },
				{ content: ["done"] },
			],
		});
		const config: AgentLoopConfig = { model: mock.model, convertToLlm: identityConverter };
		await agentLoop([createUserMessage("go")], context, config, undefined, mock.stream).result();

		expect(calls).toEqual([[1, 2, 3, 4, 5]]);
	});
});
