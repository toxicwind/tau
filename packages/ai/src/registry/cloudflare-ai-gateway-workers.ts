import { createApiKeyLogin } from "./api-key-login";
import type { ProviderDefinition } from "./types";
import type { Model } from "../types";

const AUTH_URL = "https://developers.cloudflare.com/ai-gateway/configuration/authentication/";

/**
 * Cloudflare AI Gateway Workers Provider (Unified /compat)
 *
 * Routes Workers AI hosted models (@cf/*) through the AI Gateway /compat endpoint
 * using the user's cf-aig-authorization token. Free inference: 10,000 neurons/day
 * with full gateway observability (caching, logging, rate-limiting, prefix caching).
 *
 * VERIFIED IMPLEMENTATION PATTERNS (from OSINT cross-reference):
 *   - cloudflare-os pi-impl.md: gateway /compat + compound workers-ai/{model} id
 *   - cloudflare/ai#617: direct compat path verified with AI SDK text generation
 *   - DevoxxGenie#1254: @cf/... auto-prefixed to workers-ai/@cf/... (error 2008 fix)
 *   - NextChat#6748: workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast confirmed working
 *   - vsurf/docs: Workers AI uses Unified API (/compat) with prefixed model IDs
 *
 * AUTH: cf-aig-authorization: Bearer <cfat_...token>
 * ENDPOINT: https://gateway.ai.cloudflare.com/v1/{ACCOUNT_ID}/{GATEWAY_ID}/compat
 * MODEL ID TRANSFORM: @cf/... (canonical) -> workers-ai/@cf/... (request body)
 */

export const loginCloudflareAiGatewayWorkers = createApiKeyLogin({
	providerLabel: "Cloudflare AI Gateway (Workers AI)",
	authUrl: AUTH_URL,
	instructions: "Copy your Cloudflare AI Gateway token. Workers AI is free (10k neurons/day) via /compat.",
	promptMessage: "Paste your Cloudflare AI Gateway token (cf-aig-...)",
	placeholder: "cf-aig-...",
	validation: null,
});

/**
 * Transforms canonical Workers AI model IDs to gateway /compat compound format.
 * The /compat endpoint is a unified router requiring provider-prefixed IDs.
 * Bare @cf/... fails with 2008 "Invalid provider".
 */
export function toCompatModelId(modelId: string): string {
	if (modelId.startsWith("workers-ai/")) return modelId;
	if (modelId.startsWith("@cf/")) return "workers-ai/" + modelId;
	return modelId;
}

// Free tier: 17 Workers AI models verified against cloudflare/ai catalog
export const CLOUDFLARE_AI_GATEWAY_WORKERS_MODELS = [
	"@cf/meta/llama-3.1-8b-instruct",
	"@cf/meta/llama-3.3-70b-instruct-fp8-fast",
	"@cf/meta/llama-4-scout-17b-16e-instruct",
	"@cf/meta/llama-4-maverick-17b-128e-instruct",
	"@cf/mistral/mistral-7b-instruct-v0.2",
	"@cf/mistral/mistral-small-3.1-24b-instruct",
	"@cf/qwen/qwen-2.5-7b-instruct",
	"@cf/qwen/qwq-32b",
	"@cf/qwen/qwen-3-30b-a3b",
	"@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
	"@cf/moonshotai/kimi-k2.5",
	"@cf/moonshotai/kimi-k2.6",
	"@cf/baai/bge-large-en-v1.5",
	"@cf/openai/gpt-oss-20b",
	"@cf/openai/gpt-oss-120b",
	"@cf/microsoft/phi-4",
	"@cf/tiiuae/falcon-7b-instruct",
] as const;

export const cloudflareAiGatewayWorkersProvider = {
	id: "cloudflare-ai-gateway-workers",
	name: "Cloudflare AI Gateway (Workers AI /compat)",
	login: (cb) => loginCloudflareAiGatewayWorkers(cb),
	// Transform @cf/... to workers-ai/@cf/... at request time so catalog can store canonical IDs
	prepareRequest: (model: Model<any>, options) => {
		const compatId = toCompatModelId(model.id);
		if (compatId === model.id) return { model, options };
		return { model: { ...model, id: compatId }, options };
	},
} as const satisfies ProviderDefinition;
