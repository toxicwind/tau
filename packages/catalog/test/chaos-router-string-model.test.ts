import { describe, expect, it } from "bun:test";
import { resolveCatalogPolicy } from "../src/compat/catalog-policy";

describe("chaos router string model IDs", () => {
	it("resolveCatalogPolicy does not throw on raw string model ID", () => {
		// Chaos router and fallbacks sometimes pass raw strings like
		// "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", "tau-dev",
		// "freeinference/deepseek-v4-flash", etc. These should not throw
		// on "identity" in model (TypeError: model is not an Object).
		const strings = [
			"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
			"tau-dev",
			"freeinference/deepseek-v4-flash",
			"freeinference/qwen3.6-35b",
			"openrouter/any-model",
			"bare-model-id",
		];

		for (const s of strings) {
			expect(() => resolveCatalogPolicy(s)).not.toThrow();
		}
	});

	it("string model returns a policy record", () => {
		const policy = resolveCatalogPolicy("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning");
		expect(typeof policy).toBe("object");
		expect(policy).toBeDefined();
	});

	it("string model resolves to empty provider catalog", () => {
		const policy = resolveCatalogPolicy("tau-dev");
		// With empty provider, no identity facts match — catalog is
		// the fallback/empty catalog from resolveModelPolicy
		expect(typeof policy).toBe("object");
	});

	it("object model still works (no regression)", () => {
		// Object models should still resolve normally
		const policy = resolveCatalogPolicy({
			provider: "nvidia",
			id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
			api: "openai-completions",
		} as any);
		expect(typeof policy).toBe("object");
	});
});
