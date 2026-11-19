import { LuaStrategy } from "./lua";

/**
 * Per-provider / per-model Lua policy.
 *
 * Instead of hardcoding provider behavior (context windows, max tokens, effort
 * ladders, routing quirks) in TypeScript or a static catalog table, a provider
 * or model may carry a `.lua` policy script. The policy exposes optional
 * functions that the host consults to override or refine a model's metadata and
 * routing decisions. A function that returns `nil` defers to the built-in
 * behavior, so a policy is a refinement, not a replacement.
 *
 * This is the "no hardcoding" seam: the 256k-vs-1M context bug (and every
 * similar per-model quirk) is fixed in a Lua policy, not a stale TS table.
 */

/** A model snapshot handed to a Lua policy function. */
export interface LuaModelContext {
	id: string;
	provider: string;
	name?: string;
	baseUrl?: string;
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
}

/** A provider snapshot handed to a Lua policy function. */
export interface LuaProviderContext {
	name: string;
	baseUrl?: string;
	models?: string[];
}

/** Resolved policy overrides for one model. `undefined` means "not overridden". */
export interface LuaModelPolicyResult {
	contextWindow?: number;
	maxTokens?: number;
}

/**
 * A loaded provider/model Lua policy: the compiled engine plus references to
 * the optional policy functions it exposes. All policy functions are optional;
 * a policy that defines none is a no-op.
 */
export class LuaModelPolicy {
	private readonly strategy: LuaStrategy;
	private readonly functions: Record<string, (...args: unknown[]) => unknown>;

	private constructor(
		strategy: LuaStrategy,
		functions: Record<string, (...args: unknown[]) => unknown>,
	) {
		this.strategy = strategy;
		this.functions = functions;
	}

	/**
	 * Load a Lua policy source. The script may define any of:
	 *   `model_context(model)` -> number | nil
	 *   `model_max_tokens(model)` -> number | nil
	 *   `should_fallback(model, error)` -> boolean | nil
	 *   `pick_fallback(ctx)` -> selector | false | nil
	 * A missing entry point is not an error — a policy with only `model_context`
	 * is valid.
	 */
	static async load(source: string, options?: { timeoutMs?: number }): Promise<LuaModelPolicy> {
		const strategy = await LuaStrategy.load(source, { ...options, entryPoint: null });
		const names = [
			"model_context",
			"model_max_tokens",
			"should_fallback",
			"pick_fallback",
		] as const;
		const functions: Record<string, (...args: unknown[]) => unknown> = {};
		for (const name of names) {
			try {
				const fn = await strategy.getGlobal(name);
				if (typeof fn === "function") functions[name] = fn as (...args: unknown[]) => unknown;
			} catch {
				// Function absent — skip.
			}
		}
		return new LuaModelPolicy(strategy, functions);
	}

	/** Whether this policy defines the named function. */
	has(name: "model_context" | "model_max_tokens" | "should_fallback" | "pick_fallback"): boolean {
		return typeof this.functions[name] === "function";
	}

	/**
	 * Resolve per-model overrides. Returns only the fields the policy actually
	 * overrides (returns a number); all others are `undefined` so the caller
	 * falls back to its built-in value.
	 */
	async resolveModel(model: LuaModelContext): Promise<LuaModelPolicyResult> {
		const out: LuaModelPolicyResult = {};
		const ctx = toLuaModel(model);
		if (this.has("model_context")) {
			const v = await this.safeCall("model_context", ctx);
			if (typeof v === "number" && Number.isFinite(v) && v > 0) out.contextWindow = v;
		}
		if (this.has("model_max_tokens")) {
			const v = await this.safeCall("model_max_tokens", ctx);
			if (typeof v === "number" && Number.isFinite(v) && v > 0) out.maxTokens = v;
		}
		return out;
	}

	/**
	 * Ask the policy whether the model should fall back given an error.
	 * Returns `true`/`false` when the policy decides, `undefined` to defer.
	 */
	async shouldFallback(model: LuaModelContext, error?: string): Promise<boolean | undefined> {
		if (!this.has("should_fallback")) return undefined;
		const v = await this.safeCall("should_fallback", toLuaModel(model), error);
		return typeof v === "boolean" ? v : undefined;
	}

	/** Release the embedded Lua VM. */
	close(): void {
		this.strategy.close();
	}

	private async safeCall(name: string, ...args: unknown[]): Promise<unknown> {
		try {
			const fn = this.functions[name];
			if (typeof fn !== "function") return undefined;
			return await fn(...args);
		} catch {
			return undefined;
		}
	}
}

function toLuaModel(model: LuaModelContext): Record<string, unknown> {
	return {
		id: model.id,
		provider: model.provider,
		name: model.name,
		base_url: model.baseUrl,
		reasoning: model.reasoning,
		context_window: model.contextWindow,
		max_tokens: model.maxTokens,
	};
}