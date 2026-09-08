/** OpenRouter + Vercel gateway routing types (split for tool size limits). */

/**
 * OpenRouter provider routing preferences.
 * Controls which upstream providers OpenRouter routes requests to.
 * @see https://openrouter.ai/docs/provider-routing
 */
export interface OpenRouterRouting {
	/** List of provider slugs to exclusively use for this request (e.g., ["amazon-bedrock", "anthropic"]). */
	only?: string[];
	/** List of provider slugs to try in order (e.g., ["anthropic", "openai"]). */
	order?: string[];
	/**
	 * When true, OpenRouter only routes to backends that support the request parameters
	 * (notably tools/tool_choice). Force this for agent tool turns so free/no-tools
	 * backends cannot be selected — Inkling/vLLM hallucination failure mode.
	 * @see https://openrouter.ai/docs/features/provider-routing
	 */
	require_parameters?: boolean;
}

/**
 * Vercel AI Gateway routing preferences.
 * Controls which upstream providers the gateway routes requests to.
 * @see https://vercel.com/docs/ai-gateway/models-and-providers/provider-options
 */
export interface VercelGatewayRouting {
	/** List of provider slugs to exclusively use for this request (e.g., ["bedrock", "anthropic"]). */
	only?: string[];
	/** List of provider slugs to try in order (e.g., ["anthropic", "openai"]). */
	order?: string[];
	/** Enables Vercel AI Gateway's provider-aware automatic prompt caching. */
	caching?: "auto";
	/** Stable Responses input-item prefix to anchor for automatic caching. */
	cacheAnchorItems?: number;
	/** Requested automatic-cache lifetime for the Responses API. */
	cacheTtl?: "5m" | "1h";
}
