import { describe, expect, it } from "bun:test";
import { getBundledModel } from "../src/models";
import { resolveModelPolicy } from "../src/compat/resolve";
import { shouldDropAutoToolChoiceForReasoning } from "@tau/tau-ai/providers/openai-shared";

/**
 * Contract (invariant #1): a thinking-capable model must never resolve to a
 * bare `disableReasoningOnToolChoice: true` with no reasoning-content
 * requirement — that combination zeroes reasoning on every agentic (tool-use)
 * turn and lets raw CoT leak into visible text. DeepSeek-family hosts carry
 * the flag as a wire dialect, so the guard is: where the flag is set on a
 * thinking model, `requiresReasoningContentForToolCalls` must also be set
 * (the explicit pre-thought/replay pass), and the runtime must drop a
 * redundant `tool_choice: "auto"` to keep reasoning alive.
 */

const DEEPSEEK_THINKING_MODEL = "deepseek-v4-flash";

describe("reasoning channel preservation under tools", () => {
	it("deepseek-v4-flash resolves with thinking enabled", () => {
		const model = getBundledModel("deepseek", DEEPSEEK_THINKING_MODEL);
		expect(model).toBeDefined();
		expect(model!.thinking?.mode).not.toBe("none");
	});

	it("disableReasoningOnToolChoice is always paired with a reasoning-content requirement", () => {
		const model = getBundledModel("deepseek", DEEPSEEK_THINKING_MODEL);
		const compat = resolveModelPolicy(model!).compat as Record<string, unknown>;
		if (compat.disableReasoningOnToolChoice === true) {
			expect(compat.requiresReasoningContentForToolCalls).toBe(true);
			expect(compat.requiresReasoningContentForAllAssistantTurns).toBe(true);
		}
	});

	it("runtime drops redundant auto tool_choice to keep reasoning alive", () => {
		const model = getBundledModel("deepseek", DEEPSEEK_THINKING_MODEL);
		const compat = resolveModelPolicy(model!).compat as { disableReasoningOnToolChoice: boolean };
		const drop = shouldDropAutoToolChoiceForReasoning(
			model as { reasoning: boolean },
			compat,
			"auto",
			{ reasoning: "low", disableReasoning: false },
		);
		expect(drop).toBe(compat.disableReasoningOnToolChoice === true && Boolean(model!.reasoning));
	});

	it("forced tool choice still legitimately suppresses reasoning for the dialect", () => {
		// The DeepSeek dialect disables reasoning on forced tool choice; the
		// contract is that this is a *known* suppression, not silent.
		const model = getBundledModel("deepseek", DEEPSEEK_THINKING_MODEL);
		const compat = resolveModelPolicy(model!).compat as Record<string, unknown>;
		expect(compat.disableReasoningOnForcedToolChoice).toBeTypeOf("boolean");
	});
});
