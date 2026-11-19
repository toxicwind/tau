import { LuaFactory } from "wasmoon";
import type { ProbeVerdict } from "./probe";

/**
 * Lua-scriptable fallback strategies.
 *
 * The retry/fallback chain is provider-agnostic and should be overridable by the
 * architect without recompiling TypeScript. A strategy is a `.lua` file exposing
 * a `choose_fallback(ctx)` function that inspects the failing selector, the
 * ordered candidate chain, and each candidate's reachability probe, and returns
 * the selector to fall back to (or `nil` to let the built-in chain decide).
 *
 * The Lua host embeds Lua 5.4 via `wasmoon` (WASM, verified under Bun/TS7). A
 * strategy script is loaded once per session and invoked with a fresh context
 * table per decision; the host bounds execution so a misbehaving script cannot
 * hang the session.
 */

/** A fallback candidate handed to a Lua strategy. */
export interface LuaFallbackCandidate {
	/** Order in the configured chain (0 = first fallback). */
	index: number;
	/** Full selector, e.g. "freeinference/qwen3.6-35b". */
	selector: string;
	/** Provider/id split. */
	provider: string;
	id: string;
	/** Reachability probe verdict, when probed. */
	probe?: ProbeVerdict;
}

/** Context handed to a Lua `choose_fallback` call. */
export interface LuaFallbackContext {
	/** The selector that failed, e.g. "deepseek/deepseek-v4-pro:high". */
	failingSelector: string;
	/** The failing model's provider. */
	failingProvider: string;
	/** Ordered fallback candidates (probe results attached when available). */
	candidates: LuaFallbackCandidate[];
	/** The role whose chain is being consulted, e.g. "default". */
	role: string;
	/** Error text from the failed request, when present. */
	error?: string;
}

/** Result of a Lua strategy decision. */
export type LuaFallbackDecision =
	| { kind: "selector"; selector: string }
	| { kind: "skip"; reason?: string }
	| { kind: "defer" };

export interface LuaStrategyHostOptions {
	/** Hard wall-clock cap for a single strategy invocation. Defaults to 1s. */
	timeoutMs?: number;
	/**
	 * Global function the script must define, or `null` when no single entry
	 * point is required (a policy that exposes several optional functions).
	 * Defaults to `"choose_fallback"`.
	 */
	entryPoint?: string | null;
}

const DEFAULT_STRATEGY_TIMEOUT_MS = 1_000;

/**
 * A loaded Lua strategy: the compiled engine plus the script's exposed
 * `choose_fallback` function reference.
 */
export class LuaStrategy {
	private readonly factory: LuaFactory;
	private readonly engine: Awaited<ReturnType<LuaFactory["createEngine"]>>;
	private readonly chooseFallback: (...args: unknown[]) => unknown;
	private readonly timeoutMs: number;

	private constructor(
		factory: LuaFactory,
		engine: Awaited<ReturnType<LuaFactory["createEngine"]>>,
		chooseFallback: (...args: unknown[]) => unknown,
		timeoutMs: number,
	) {
		this.factory = factory;
		this.engine = engine;
		this.chooseFallback = chooseFallback;
		this.timeoutMs = timeoutMs;
	}

	/**
	 * Compile a Lua strategy source. The script must define a global
	 * `choose_fallback(ctx)` function. Throws on syntax errors or a missing
	 * entry point.
	 */
	static async load(source: string, options: LuaStrategyHostOptions = {}): Promise<LuaStrategy> {
		const timeoutMs = options.timeoutMs ?? DEFAULT_STRATEGY_TIMEOUT_MS;
		const entryPoint = options.entryPoint === undefined ? "choose_fallback" : options.entryPoint;
		const factory = new LuaFactory();
		const engine = await factory.createEngine();
		await engine.doString(source);
		let chooseFallback: (...args: unknown[]) => unknown = () => undefined;
		if (entryPoint !== null) {
			const fn = await engine.global.get(entryPoint);
			if (typeof fn !== "function") {
				engine.global.close();
				throw new Error(`Lua strategy must define a global \`${entryPoint}(ctx)\` function`);
			}
			chooseFallback = fn;
		}
		return new LuaStrategy(factory, engine, chooseFallback, timeoutMs);
	}

	/**
	 * Invoke the strategy with a context. Returns a decision, or `defer` when the
	 * script returns nothing usable or times out. Never throws — a broken
	 * strategy degrades to the built-in chain.
	 */
	async decide(ctx: LuaFallbackContext): Promise<LuaFallbackDecision> {
		const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
		try {
			const result = await Promise.race([
				Promise.resolve(this.chooseFallback(toLuaTable(ctx))),
				new Promise<unknown>(resolve => {
					timeoutSignal.addEventListener("abort", () => resolve(undefined), { once: true });
				}),
			]);
			if (typeof result === "string" && result.length > 0) {
				return { kind: "selector", selector: result };
			}
			if (result === false) {
				return { kind: "skip" };
			}
			return { kind: "defer" };
		} catch {
			return { kind: "defer" };
		}
	}

	/** Release the embedded Lua VM. */
	close(): void {
		try {
			this.engine.global.close();
		} catch {
			// Engine may already be closed.
		}
	}

	/** Read a global value (e.g. a policy function) from the Lua VM. */
	async getGlobal(name: string): Promise<unknown> {
		return this.engine.global.get(name);
	}
}

/** Convert a TS context into a plain object wasmoon can marshal into Lua. */
function toLuaTable(ctx: LuaFallbackContext): Record<string, unknown> {
	return {
		failing_selector: ctx.failingSelector,
		failing_provider: ctx.failingProvider,
		role: ctx.role,
		error: ctx.error,
		candidates: ctx.candidates.map(c => ({
			index: c.index,
			selector: c.selector,
			provider: c.provider,
			id: c.id,
			probe: c.probe
				? {
						ok: c.probe.ok,
						reason: c.probe.ok ? undefined : c.probe.reason,
						status: c.probe.ok ? undefined : c.probe.status,
						latency_ms: c.probe.ok ? c.probe.latencyMs : undefined,
					}
				: undefined,
		})),
	};
}