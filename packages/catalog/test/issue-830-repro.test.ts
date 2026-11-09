import { describe, expect, test } from "bun:test";
// refused_by: merge_ladder_exhausted · collision: `import { getEnvApiKey } from "@oh-my-pi/pi-ai/stream";` +2 more
import { getOAuthProviders } from "@tau/tau-ai/registry/oauth";
import { getEnvApiKey } from "@tau/tau-ai/stream";
import { MODELS_DEV_PROVIDER_DESCRIPTORS } from "@tau/tau-catalog/provider-models/openai-compat";
import type { OpenAICompat } from "@tau/tau-catalog/types";

describe("deepseek built-in provider (issue #830)", () => {
	test("registers DeepSeek as an API-key login provider", () => {
		const provider = getOAuthProviders().find(item => item.id === "deepseek");
		expect(provider?.name).toBe("DeepSeek");
		expect(provider?.available).toBe(true);
	});

	test("resolves DEEPSEEK_API_KEY via env", () => {
		const previous = Bun.env.DEEPSEEK_API_KEY;
		Bun.env.DEEPSEEK_API_KEY = "deepseek-test-key";
		try {
			expect(getEnvApiKey("deepseek")).toBe("deepseek-test-key");
		} finally {
			if (previous === undefined) {
				delete Bun.env.DEEPSEEK_API_KEY;
			} else {
				Bun.env.DEEPSEEK_API_KEY = previous;
			}
		}
	});
});
