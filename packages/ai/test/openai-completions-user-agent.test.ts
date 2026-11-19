import { describe, expect, it } from "bun:test";
import { USER_AGENT } from "@tau/tau-utils";
import { resolveOpenAIRequestSetup } from "../src/providers/openai-shared";
import type { Model } from "../src/types";

// Honest client identification on the wire. Every openai-completions request
// carries `User-Agent: tau/<version>` unless the model (models.yml `headers`)
// or the caller supplies one explicitly — providers that ban fake user agents
// (freeinference ToS) still get truthful identification, and a config UA wins
// over the default.

function modelWith(overrides: Partial<Model<"openai-completions">>): Model<"openai-completions"> {
	return {
		id: "test-model",
		provider: "test-provider",
		api: "openai-completions",
		baseUrl: "https://provider.test/v1",
		headers: {},
		compat: {},
		contextWindow: 128_000,
		maxTokens: 4096,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		...overrides,
	} as unknown as Model<"openai-completions">;
}

describe("resolveOpenAIRequestSetup user-agent identification", () => {
	const opts = { apiKey: "test-key", messages: [] } as never;

	it("defaults User-Agent to tau/<version> when model carries none", () => {
		const setup = resolveOpenAIRequestSetup(modelWith({ headers: {} }), opts);
		expect(setup.headers["User-Agent"]).toBe(USER_AGENT);
	});

	it("model-level headers (models.yml) override the default User-Agent", () => {
		const setup = resolveOpenAIRequestSetup(
			modelWith({ headers: { "User-Agent": "tau/18.8.4 (+https://github.com/toxicwind/tau)" } }),
			opts,
		);
		expect(setup.headers["User-Agent"]).toBe("tau/18.8.4 (+https://github.com/toxicwind/tau)");
	});
});
