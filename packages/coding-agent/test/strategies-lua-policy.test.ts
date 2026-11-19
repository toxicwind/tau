import { expect, test } from "bun:test";
import { LuaModelPolicy } from "tau/session/strategies/lua-policy";

test("policy overrides a model's context window from Lua (256k -> 1M fix)", async () => {
	const src = `
function model_context(model)
  if model.id == "deepseek-v4-flash" then return 1000000 end
  return nil
end
`;
	const policy = await LuaModelPolicy.load(src);
	try {
		const overrides = await policy.resolveModel({
			id: "deepseek-v4-flash",
			provider: "freeinference",
			contextWindow: 256000,
		});
		expect(overrides.contextWindow).toBe(1_000_000);
		expect(overrides.maxTokens).toBeUndefined();
	} finally {
		policy.close();
	}
});

test("policy defers (no override) when it returns nil", async () => {
	const src = `function model_context(model) return nil end`;
	const policy = await LuaModelPolicy.load(src);
	try {
		const overrides = await policy.resolveModel({ id: "x", provider: "p" });
		expect(overrides.contextWindow).toBeUndefined();
		expect(overrides.maxTokens).toBeUndefined();
	} finally {
		policy.close();
	}
});

test("policy overrides max tokens independently of context", async () => {
	const src = `
function model_max_tokens(model)
  if model.id == "deepseek-v4-flash" then return 393216 end
  return nil
end
`;
	const policy = await LuaModelPolicy.load(src);
	try {
		const overrides = await policy.resolveModel({ id: "deepseek-v4-flash", provider: "freeinference" });
		expect(overrides.maxTokens).toBe(393216);
		expect(overrides.contextWindow).toBeUndefined();
	} finally {
		policy.close();
	}
});

test("policy decides whether to fall back on error", async () => {
	const src = `
function should_fallback(model, error)
  if error and error:find("402") then return true end
  return false
end
`;
	const policy = await LuaModelPolicy.load(src);
	try {
		expect(await policy.shouldFallback({ id: "deepseek-v4-pro", provider: "deepseek" }, "402 Insufficient Balance")).toBe(true);
		expect(await policy.shouldFallback({ id: "deepseek-v4-pro", provider: "deepseek" }, "502 Bad Gateway")).toBe(false);
	} finally {
		policy.close();
	}
});

test("policy without a function defers for that decision", async () => {
	const src = `function model_context(model) return 1000000 end`;
	const policy = await LuaModelPolicy.load(src);
	try {
		// No should_fallback defined -> defer (undefined).
		expect(await policy.shouldFallback({ id: "x", provider: "p" })).toBeUndefined();
		expect(policy.has("model_context")).toBe(true);
		expect(policy.has("pick_fallback")).toBe(false);
	} finally {
		policy.close();
	}
});