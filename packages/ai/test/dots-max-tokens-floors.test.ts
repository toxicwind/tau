import { expect, test } from "bun:test";
import {
	resolveOpenAIOutputTokenParam,
	isDotsModel,
	dotsMaxTokensFloor,
	DOTS_TEXT_FLOOR,
	DOTS_TOOLS_FLOOR,
	DOTS_CONTINUATION_FLOOR,
} from "../src/providers/openai-shared";

test("isDotsModel detects Dots models case-insensitively", () => {
	expect(isDotsModel("openrouter/dots-studio/dots-3-note-preview:free")).toBe(true);
	expect(isDotsModel("DOTS-3")).toBe(true);
	expect(isDotsModel("openai/gpt-4")).toBe(false);
	expect(isDotsModel(undefined)).toBe(false);
});

test("dotsMaxTokensFloor tiers", () => {
	const dots = "dots-studio/dots-3-note-preview:free";
	expect(dotsMaxTokensFloor(dots, false, false)).toBe(DOTS_TEXT_FLOOR); // 256
	expect(dotsMaxTokensFloor(dots, true, false)).toBe(DOTS_TOOLS_FLOOR); // 512
	expect(dotsMaxTokensFloor(dots, false, true)).toBe(DOTS_CONTINUATION_FLOOR); // 1024
	expect(dotsMaxTokensFloor(dots, true, true)).toBe(DOTS_CONTINUATION_FLOOR); // 1024 (continuation wins)
	expect(dotsMaxTokensFloor("openai/gpt-4", true, true)).toBe(0); // non-Dots: no floor
});

test("resolveOpenAIOutputTokenParam applies Dots floor (raise-only)", () => {
	const base = {
		field: "max_tokens" as const,
		maxTokensExplicit: false,
		modelMaxTokens: 460800,
		omitMaxOutputTokens: false,
		isOpenRouterHost: false,
		alwaysSendMaxTokens: true,
		modelId: "openrouter/dots-studio/dots-3-note-preview:free",
	};

	// Text-only with tiny maxTokens (64) -> floored to 256
	const textOnly = resolveOpenAIOutputTokenParam({ ...base, maxTokens: 64, hasTools: false, isContinuation: false });
	expect(textOnly?.value).toBe(256);

	// Tool call with tiny maxTokens -> floored to 512
	const tools = resolveOpenAIOutputTokenParam({ ...base, maxTokens: 64, hasTools: true, isContinuation: false });
	expect(tools?.value).toBe(512);

	// Continuation -> floored to 1024
	const cont = resolveOpenAIOutputTokenParam({ ...base, maxTokens: 64, hasTools: true, isContinuation: true });
	expect(cont?.value).toBe(1024);

	// Explicit higher value is NOT lowered
	const explicit = resolveOpenAIOutputTokenParam({ ...base, maxTokens: 2048, maxTokensExplicit: true, hasTools: false, isContinuation: false });
	expect(explicit?.value).toBe(2048);

	// Non-Dots model: no floor
	const nonDots = resolveOpenAIOutputTokenParam({ ...base, modelId: "openai/gpt-4", maxTokens: 64, hasTools: false, isContinuation: false });
	expect(nonDots?.value).toBe(64);
});
