import { describe, expect, test } from "bun:test";
import { resolveCatalogPolicy } from "../src/compat/catalog-policy";

/**
 * Regression for invariant #3: `resolveCatalogPolicy` previously typed its
 * string-arm as `{ id, provider }` and dereferenced `providerType`/`api`/
 * `reasoning` on it (TS2551/TS2339) and passed a partial spec to
 * `resolveModelPolicy` (TS2740). The normalizer now builds a complete
 * resolver-ready spec from a bare string model id.
 */
describe("resolveCatalogPolicy — monadic string model ids", () => {
	test("accepts a bare string model id", () => {
		const policy = resolveCatalogPolicy("freeinference/deepseek-v4-flash");
		expect(typeof policy).toBe("object");
		expect(policy).not.toBeNull();
	});

	test("returns a frozen bag (shared across callers)", () => {
		const policy = resolveCatalogPolicy("freeinference/deepseek-v4-flash");
		expect(Object.isFrozen(policy)).toBe(true);
	});

	test("memoizes per model id (same reference)", () => {
		const a = resolveCatalogPolicy("freeinference/deepseek-v4-flash");
		const b = resolveCatalogPolicy("freeinference/deepseek-v4-flash");
		expect(a).toBe(b);
	});

	test("routes with different upstreams produce distinct bags", () => {
		const a = resolveCatalogPolicy("freeinference/deepseek-v4-flash", { upstream: "http://one" });
		const b = resolveCatalogPolicy("freeinference/deepseek-v4-flash", { upstream: "http://two" });
		expect(a).not.toBe(b);
	});

	test("accepts a structural CatalogPolicyInputs (no full Model required)", () => {
		const policy = resolveCatalogPolicy({
			id: "deepseek-v4-flash",
			name: "DeepSeek V4 Flash",
			provider: "freeinference",
			api: "openai-completions",
			baseUrl: "",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1_000_000,
			maxTokens: 8192,
		});
		expect(typeof policy).toBe("object");
	});

	test("null / undefined model id never throws (runtime chaos-router guard)", () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(() => resolveCatalogPolicy(null as any)).not.toThrow();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(() => resolveCatalogPolicy(undefined as any)).not.toThrow();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(typeof resolveCatalogPolicy(null as any)).toBe("object");
	});
});
