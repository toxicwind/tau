import { describe, it, expect } from "bun:test";
import {
	findRetryFallbackCandidates,
	parseRetryFallbackSelector,
	type RetryFallbackResolutionContext,
} from "tau/session/retry-fallback-chains";
import { resolveCatalogPolicy } from "@tau/tau-catalog/compat/catalog-policy";

/**
 * Contract: chaos-router / fallback paths pass raw string model ids into tau's
 * policy resolver. `"identity" in model` on a string/null/undefined used to
 * throw (`model is not an Object`), which then cascaded into `Warning: Fallback`
 * chain hops that re-threw. Every fallback parse must produce a structured
 * selector, and resolveCatalogPolicy must never throw on any non-object.
 */

function contextFor(chains: RetryFallbackResolutionContext["chains"]): RetryFallbackResolutionContext {
	return {
		chains,
		getModelRole: () => undefined,
		modelLookup: {
			find: (provider, id) => (provider === "freeinference" && id.includes("deepseek") ? ({} as never) : undefined),
			hasProvider: provider => provider === "freeinference" || provider === "mimetite",
		},
	};
}

describe("retry fallback string-id contract", () => {
	it("parses a thinking-suffixed string selector into a structured selector", () => {
		const result = parseRetryFallbackSelector("mimetite/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:off", {
			find: () => undefined,
		});
		expect(result).toBeDefined();
		expect(result!.provider).toBe("mimetite");
		expect(result!.id).toBe("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning");
		expect(result!.thinkingLevel).toBe("off");
	});

	it("never throws on a bare string selector (skipped as invalid, never crashes)", () => {
		let result: ReturnType<typeof parseRetryFallbackSelector>;
		expect(() => {
			result = parseRetryFallbackSelector("tau-dev", { find: () => undefined });
		}).not.toThrow();
		// A bare id without "/" is not a valid fallback selector; it is skipped
		// (undefined), never a crash. The invariant is "no throw", not "defined".
		if (result !== undefined) {
			expect(typeof result.provider).toBe("string");
			expect(typeof result.id).toBe("string");
		}
	});

	it("never throws on null/undefined/string model ids (chaos-router guard)", () => {
		expect(() => resolveCatalogPolicy(null as never)).not.toThrow();
		expect(() => resolveCatalogPolicy(undefined as never)).not.toThrow();
		expect(() => resolveCatalogPolicy("tau-dev")).not.toThrow();
		expect(() => resolveCatalogPolicy("freeinference/deepseek-v4-flash")).not.toThrow();
		expect(resolveCatalogPolicy(null as never)).toBeTruthy();
		expect(resolveCatalogPolicy("tau-dev")).toBeTruthy();
	});

	it("fallback candidates resolve through resolveCatalogPolicy without re-throwing", () => {
		const chains = { default: ["freeinference/deepseek-v4-flash"] };
		const candidates = findRetryFallbackCandidates(
			contextFor(chains),
			"default",
			"mimetite/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:off",
			undefined,
			{ allowMissingPrimary: true },
		);
		expect(Array.isArray(candidates)).toBe(true);
		for (const candidate of candidates) {
			expect(() => resolveCatalogPolicy(candidate.raw)).not.toThrow();
			expect(() => resolveCatalogPolicy(candidate.provider)).not.toThrow();
		}
	});
});
