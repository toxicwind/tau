/** Catalog types part B (emergency restore). */
/**
 * Compatibility settings for Bedrock Converse prompt caching. Cache pricing is
 * deliberately not used to infer these request-shape capabilities.
 */
export interface BedrockCompat {
	/** Whether this endpoint accepts no checkpoints, automatic caching, or explicit cachePoint blocks. */
	promptCacheMode?: "none" | "automatic" | "explicit";
	/** Whether explicit cachePoint blocks accept `ttl: "1h"`; omitted TTL means Bedrock's 5-minute default. */
	supportsLongPromptCacheRetention?: boolean;
	promptCacheMinimumTokens?: number;
	promptCacheMaximumCheckpoints?: number;
	streamIdleTimeoutMs?: number;
}

export interface ResolvedBedrockCompat {
	promptCacheMode: NonNullable<BedrockCompat["promptCacheMode"]>;
	supportsLongPromptCacheRetention: boolean;
	promptCacheMinimumTokens: number;
	promptCacheMaximumCheckpoints: number;
	streamIdleTimeoutMs?: number;
}
