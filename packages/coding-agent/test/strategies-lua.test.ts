import { expect, test } from "bun:test";
import { LuaStrategy } from "tau/session/strategies/lua";
import type { LuaFallbackContext } from "tau/session/strategies/lua";

const ctx: LuaFallbackContext = {
	failingSelector: "deepseek/deepseek-v4-pro:high",
	failingProvider: "deepseek",
	role: "default",
	error: "402 Insufficient Balance",
	candidates: [
		{ index: 0, selector: "freeinference/qwen3.6-35b", provider: "freeinference", id: "qwen3.6-35b" },
		{
			index: 1,
			selector: "freeinference/glm-5.3-flash",
			provider: "freeinference",
			id: "glm-5.3-flash",
			probe: { ok: true, latencyMs: 40 },
		},
		{
			index: 2,
			selector: "freeinference/deepseek-v4-flash",
			provider: "freeinference",
			id: "deepseek-v4-flash",
			probe: { ok: false, reason: "http", status: 502 },
		},
	],
};

test("Lua strategy picks the first probed-healthy candidate", async () => {
	const src = `
function choose_fallback(ctx)
  for _, c in ipairs(ctx.candidates) do
    if c.probe and c.probe.ok then
      return c.selector
    end
  end
  return nil
end
`;
	const strategy = await LuaStrategy.load(src);
	try {
		const decision = await strategy.decide(ctx);
		expect(decision).toEqual({ kind: "selector", selector: "freeinference/glm-5.3-flash" });
	} finally {
		strategy.close();
	}
});

test("Lua strategy skips a dead candidate (probe not ok)", async () => {
	const src = `
function choose_fallback(ctx)
  for _, c in ipairs(ctx.candidates) do
    if c.probe and c.probe.ok == false then
      return false
    end
  end
  return nil
end
`;
	const strategy = await LuaStrategy.load(src);
	try {
		const decision = await strategy.decide(ctx);
		expect(decision).toEqual({ kind: "skip" });
	} finally {
		strategy.close();
	}
});

test("Lua strategy defers when it returns nothing usable", async () => {
	const src = `function choose_fallback(ctx) return nil end`;
	const strategy = await LuaStrategy.load(src);
	try {
		const decision = await strategy.decide(ctx);
		expect(decision).toEqual({ kind: "defer" });
	} finally {
		strategy.close();
	}
});

test("Lua strategy load rejects a script without the entry point", async () => {
	await expect(LuaStrategy.load(`local x = 1`)).rejects.toThrow(/choose_fallback/);
});

test("Lua strategy invocation is bounded and degrades to defer on timeout", async () => {
	const src = `
function choose_fallback(ctx)
  while true do end
end
`;
	const strategy = await LuaStrategy.load(src, { timeoutMs: 30 });
	try {
		const decision = await strategy.decide(ctx);
		expect(decision).toEqual({ kind: "defer" });
	} finally {
		strategy.close();
	}
});