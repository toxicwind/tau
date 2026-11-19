import { describe, expect, it } from "bun:test";
import { convertMessages } from "@tau/tau-ai/providers/openai-completions";
import type { AssistantMessage, Model, ModelSpec } from "@tau/tau-ai/types";
import { buildModel } from "@tau/tau-catalog/build";
import { getBundledModel } from "@tau/tau-catalog/models";

/**
 * Dots 3 recon (2026-10-13): replay probes died with finish=length and zero
 * content. One cause: `reasoning_details` captured from the provider stream
 * were dropped whenever no tool call owned them (reasoning-only turns), and
 * the reasoning-only assistant turn itself was skipped from replay history.
 * These tests pin the preservation: message-level details are captured on
 * the AssistantMessage (`messageReasoningDetails`) and returned verbatim on
 * replay, merged (deduped) with any per-tool-call details.
 */

const ENCRYPTED_A = { type: "reasoning.encrypted", id: "rs_a", data: "encrypted-a" };
const ENCRYPTED_B = { type: "reasoning.encrypted", id: "rs_b", data: "encrypted-b" };

interface WireAssistant {
	role: "assistant";
	content?: unknown;
	reasoning_details?: unknown[];
	tool_calls?: unknown[];
}

function testModel(): Model<"openai-completions"> {
	const base = getBundledModel("openai", "gpt-4o-mini");
	return buildModel({
		...base,
		api: "openai-completions",
		reasoning: true,
		compat: base.compatConfig,
	} as ModelSpec<"openai-completions">);
}

function baseMessage(model: Model<"openai-completions">): Omit<AssistantMessage, "content"> {
	return {
		role: "assistant",
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function wireAssistants(messages: unknown[]): WireAssistant[] {
	return messages.filter(
		(m): m is WireAssistant => typeof m === "object" && m !== null && (m as { role?: unknown }).role === "assistant",
	);
}

describe("message-level reasoning_details replay preservation", () => {
	it("keeps a reasoning-only turn in history and returns its reasoning_details", () => {
		const model = testModel();
		const msg: AssistantMessage = {
			...baseMessage(model),
			content: [{ type: "thinking", thinking: "working through it" }],
			messageReasoningDetails: [ENCRYPTED_A],
		};
		const wire = wireAssistants(convertMessages(model, { messages: [msg] }, model.compat));
		expect(wire).toHaveLength(1);
		expect(wire[0].reasoning_details).toEqual([ENCRYPTED_A]);
		// Reasoning-only turns ship an empty string, never null (strict backends
		// reject null content before reading the reasoning payload).
		expect(wire[0].content).toBe("");
	});

	it("merges message-level details with per-tool-call details, deduped by (id, data)", () => {
		const model = testModel();
		const msg: AssistantMessage = {
			...baseMessage(model),
			stopReason: "toolUse",
			content: [
				{
					type: "toolCall",
					id: "call_1",
					name: "read",
					arguments: { path: "/tmp/test" },
					// The streaming path stashes the encrypted detail that matches a
					// tool call id in this envelope.
					thoughtSignature: JSON.stringify({ perCall: ENCRYPTED_A }),
				},
			],
			// The same detail also captured at message level (it raced ahead of
			// its tool call) plus one detail no tool call owned.
			messageReasoningDetails: [ENCRYPTED_A, ENCRYPTED_B],
		};
		const wire = wireAssistants(convertMessages(model, { messages: [msg] }, model.compat));
		expect(wire).toHaveLength(1);
		expect(wire[0].reasoning_details).toEqual([ENCRYPTED_A, ENCRYPTED_B]);
	});

	it("returns message-level details on tool-call turns that have no per-call details", () => {
		const model = testModel();
		const msg: AssistantMessage = {
			...baseMessage(model),
			stopReason: "toolUse",
			content: [
				{
					type: "toolCall",
					id: "call_1",
					name: "read",
					arguments: { path: "/tmp/test" },
				},
			],
			messageReasoningDetails: [ENCRYPTED_B],
		};
		const wire = wireAssistants(convertMessages(model, { messages: [msg] }, model.compat));
		expect(wire).toHaveLength(1);
		expect(wire[0].reasoning_details).toEqual([ENCRYPTED_B]);
	});
});
