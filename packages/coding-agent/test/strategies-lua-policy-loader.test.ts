import { afterEach, describe, expect, test } from "bun:test";
import {
	applyLuaPolicy,
	clearLuaPolicyCache,
	policiesDir,
} from "tau/session/strategies/lua-policy-loader";

describe("lua-policy-loader", () => {
	afterEach(() => {
		clearLuaPolicyCache();
		delete process.env.TAU_POLICIES_DIR;
	});

	test("overrides a model's context window from the provider's .lua policy", async () => {
		const dir = `${import.meta.dir}/fixtures/policies`;
		process.env.TAU_POLICIES_DIR = dir;
		// fixture: freeinference.lua -> model_context(deepseek-v4-flash) = 1000000
		const model = await applyLuaPolicy({
			id: "deepseek-v4-flash",
			provider: "freeinference",
			contextWindow: 256000,
			maxTokens: 256000,
		});
		expect(model.contextWindow).toBe(1_000_000);
	});

	test("leaves the model unchanged when the provider has no policy", async () => {
		const dir = `${import.meta.dir}/fixtures/policies`;
		process.env.TAU_POLICIES_DIR = dir;
		const model = await applyLuaPolicy({
			id: "some-model",
			provider: "no-such-provider",
			contextWindow: 128000,
			maxTokens: 16384,
		});
		expect(model.contextWindow).toBe(128000);
		expect(model.maxTokens).toBe(16384);
	});

	test("policiesDir honors TAU_POLICIES_DIR", () => {
		process.env.TAU_POLICIES_DIR = "/tmp/tau-policies";
		expect(policiesDir()).toBe("/tmp/tau-policies");
	});
});