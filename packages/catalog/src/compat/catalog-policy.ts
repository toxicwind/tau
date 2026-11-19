import { toModelSpec } from "../provider-models/bundled-references";
import type { Api, CatalogPolicyInputs, Model, Provider } from "../types";
import { resolveModelPolicy, type ResolveRoute } from "./resolve";
/**
 * Rule-owned catalog-axis policy by model. Resolve once per process rather
 * than walking the static policy cascade on every accessor call. The key
 * mirrors the cascade target inputs — `providerType ?? provider`, api, model
 * id, and the reasoning flag; identity-derived class/family/revision facts are
 * a pure function of provider + id. Bounded: one entry per distinct model.
 */
const catalogPolicyCache = new Map<string, Readonly<Record<string, unknown>>>();
const CATALOG_POLICY_CACHE_MAX = 8192;

/**
 * Monadic route: chaos router fallbacks pass raw string model IDs (e.g.
 * "tau-dev", "freeinference/deepseek-v4-flash"). Normalize any string into a
 * complete, resolver-ready policy input so the cache key and `resolveModelPolicy`
 * never see a partial spec (provider/id are split on the first "/"; the rest
 * are neutral defaults the cascade ignores for unknown ids).
 */
function normalizePolicyInput(model: Model | CatalogPolicyInputs | string): CatalogPolicyInputs {
	if (typeof model === "string") {
		const slash = model.indexOf("/");
		const provider = slash > 0 ? model.slice(0, slash) : "";
		const id = slash > 0 ? model.slice(slash + 1) : model;
		return {
			id,
			name: id,
			provider: provider as Provider,
			api: "openai-completions" as Api,
			baseUrl: "",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: null,
			maxTokens: null,
		};
	}
	if (typeof model === "object" && model !== null) {
		return "identity" in model ? toModelSpec(model) : model;
	}
	// Runtime guard: chaos-router fallbacks / untyped callers may pass
	// null/undefined where a Model is expected. Never throw on a non-object —
	// resolve an empty spec so the call always returns (monadic always-pass).
	return {
		id: "",
		name: "",
		provider: "" as Provider,
		api: "openai-completions" as Api,
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: null,
		maxTokens: null,
	};
}

/**
 * The `catalog` axis bag authored in the KDL cascade rules for a model,
 * memoized per distinct model. Frozen: the bag is shared across callers, so it
 * must stay read-only — extract the value you need rather than handing it on.
 */
export function resolveCatalogPolicy(
	model: Model | CatalogPolicyInputs | string,
	route?: ResolveRoute,
): Readonly<Record<string, unknown>> {
	const spec = normalizePolicyInput(model);
	const key = `${spec.provider}\u0000${spec.providerType ?? ""}\u0000${spec.api ?? ""}\u0000${spec.id}\u0000${spec.reasoning ? 1 : 0}\u0000${route?.upstream ?? ""}`;
	const cached = catalogPolicyCache.get(key);
	if (cached !== undefined) return cached;
	const policy = Object.freeze({ ...resolveModelPolicy(spec, route).catalog });
	if (catalogPolicyCache.size >= CATALOG_POLICY_CACHE_MAX) catalogPolicyCache.clear();
	catalogPolicyCache.set(key, policy);
	return policy;
}
