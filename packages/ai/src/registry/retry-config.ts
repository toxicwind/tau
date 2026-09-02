/**
 * Resolve the effective transport `maxRetryDelayMs` for a provider given a
 * caller-supplied option. Caller wins when set explicitly; otherwise
 * `unboundedRetryAfter: true` disables the cap (`<= 0` per the
 * Anthropic/negative-disables-cap convention), and the configured per-provider
 * default applies last. Returns `undefined` when neither the provider nor
 * the caller specified a value, so callers can fall back to their own
 * transport default (e.g. `fetchWithRetry`'s 60_000).
 *
 * Lives in its own file (instead of `types.ts`) so the types module stays
 * free of the `registry.ts` import that would otherwise create a cycle —
 * `registry.ts` already imports `ProviderDefinition` from `types.ts`.
 *
 * @param def Provider definition (use `getProviderDefinition(id)` to fetch)
 * @param callerMaxRetryDelayMs Caller-supplied cap (`options.maxRetryDelayMs`)
 */
export function resolveProviderMaxRetryDelayMs(
	def: { retry?: { maxRetryDelayMs?: number; unboundedRetryAfter?: boolean } } | undefined,
	callerMaxRetryDelayMs: number | undefined,
): number | undefined {
	const providerRetry = def?.retry;
	if (callerMaxRetryDelayMs !== undefined) return callerMaxRetryDelayMs;
	if (providerRetry?.unboundedRetryAfter === true) return 0;
	return providerRetry?.maxRetryDelayMs;
}
