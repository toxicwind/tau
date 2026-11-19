import { LuaModelPolicy } from "./lua-policy";
import { logger } from "@tau/tau-utils";

/**
 * lua-policy-loader.ts — wires LuaModelPolicy into model resolution.
 *
 * A provider may carry a `.lua` policy script at `~/.tau/policies/<provider>.lua`
 * (or `$TAU_POLICIES_DIR/<provider>.lua`). The policy can override a model's
 * context window / max tokens at runtime via `model_context(model)` /
 * `model_max_tokens(model)`. This is the "no hardcoding" seam: per-model quirks
 * (e.g. deepseek-v4-flash 256k-vs-1M) are fixed in a Lua policy, not a stale TS
 * table. Policies are loaded once per provider and cached; a missing or
 * malformed policy is a no-op (the built-in model metadata stands).
 */

const DEFAULT_POLICIES_DIR = `${process.env.HOME ?? "/home/toxic"}/.tau/policies`;

const cache = new Map<string, LuaModelPolicy | null>();

/** Resolve the policies dir (env override or default). */
export function policiesDir(): string {
	return process.env.TAU_POLICIES_DIR || DEFAULT_POLICIES_DIR;
}

/**
 * Load (and cache) a provider's lua policy. Returns null when the provider has
 * no policy file or the file fails to load — a policy is a refinement, never a
 * hard dependency.
 */
export async function loadProviderPolicy(provider: string): Promise<LuaModelPolicy | null> {
	if (cache.has(provider)) return cache.get(provider) ?? null;
	let policy: LuaModelPolicy | null = null;
	try {
		const path = `${policiesDir()}/${provider}.lua`;
		const src = await Bun.file(path).text();
		policy = await LuaModelPolicy.load(src);
		logger.debug("lua-policy: loaded", { provider, path });
	} catch {
		policy = null;
	}
	cache.set(provider, policy);
	return policy;
}

/**
 * Apply a provider's lua policy overrides to a resolved model. Returns a new
 * model with overridden contextWindow/maxTokens when the policy defines them;
 * otherwise returns the model unchanged. `undefined` fields defer to the
 * built-in value.
 */
export async function applyLuaPolicy<M extends { id: string; provider: string; contextWindow?: number | null; maxTokens?: number | null }>(
	model: M,
): Promise<M> {
	const policy = await loadProviderPolicy(model.provider);
	if (!policy || !(policy.has("model_context") || policy.has("model_max_tokens"))) return model;
	const overrides = await policy.resolveModel({
		id: model.id,
		provider: model.provider,
		contextWindow: model.contextWindow ?? undefined,
		maxTokens: model.maxTokens ?? undefined,
	});
	if (overrides.contextWindow === undefined && overrides.maxTokens === undefined) return model;
	return {
		...model,
		...(overrides.contextWindow !== undefined ? { contextWindow: overrides.contextWindow } : {}),
		...(overrides.maxTokens !== undefined ? { maxTokens: overrides.maxTokens } : {}),
	};
}

/** Clear the policy cache (for tests / config reload). */
export function clearLuaPolicyCache(): void {
	cache.clear();
}