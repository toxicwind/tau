/**
 * tack — tau's provider-data authority.
 *
 * `@ranch/tack` (`ranch/tack`, contract `ranch-tack/live-catalog/v1`) is the
 * single source of truth for provider wire data across the sovereign estate:
 * base URLs, key env vars, auth schemes, `/models` endpoint adapters,
 * aliases, and cold-start seeds. Tau consumes it here and projects each
 * definition onto the `CompiledProvider` shape the catalog engine
 * (`provider-models/descriptors.ts`, `scripts/generate-models.ts`)
 * already understands.
 *
 * What lives where:
 * - `ranch/tack` `PROVIDER_DEFS` — provider wire data (`baseUrl`, `keyEnv`,
 *   `keyEnvAlt`, `auth`, `adapter`, `modelsPath`, `seeds`). The authority;
 *   never duplicated here. A provider tack drops stops being a tau catalog
 *   provider — the builder below throws on drift.
 * - `TAU_PROVIDER_POLICY` — tau-side catalog policy for tack-sourced
 *   providers: default model, kind→API mapping, discovery flags, and the
 *   authored seed rows (model metadata: cost/limits/input). Transcribed
 *   verbatim from the retired KDL catalog nodes; the
 *   `src/compat/rules/providers/<id>.kdl` files keep only their cascade
 *   wire-compat rules.
 * - `src/compat/rules/providers/*.kdl` — cascade (wire-compat) rules for every
 *   provider, plus catalog entries for providers tack does not cover yet
 *   (legacy rump, shrinking as tack curates them).
 *
 * `src/compat/providers.ts` merges these entries over the KDL-compiled ones;
 * tack wins on id conflict (there are none by construction — the KDL
 * catalog nodes for covered providers were deleted).
 *
 * Import path note: tau is its own repo (`toxicwind/tau`) nested inside the
 * ranch monorepo, so this reaches tack via a relative import — the same
 * pattern the sovereign router uses (`tools/sovereign-router/
 * sovereign-router-ts/router_live_models.ts`).
 */
import { PROVIDER_DEFS } from "../../../../../tack/src/index.ts";
import type { Api, KindApiKind } from "../types";
import type { CompiledProvider, CompiledProviderDiscovery, CompiledSeed, CompiledSeedModel } from "./types";

/** Tau-side catalog policy for one tack-sourced provider. */
interface TauProviderPolicy {
	/** Preferred model id when no explicit selection is made (tau UX policy). */
	defaultModel: string;
	/** Non-chat model kinds mapped to their runtime transport APIs. */
	kindApis?: Partial<Record<KindApiKind, Api>>;
	/** Generator discovery enrollment (absent = not enrolled, as before). */
	discovery?: CompiledProviderDiscovery;
	/** Authored bundled seed rows (model metadata, transcribed from KDL). */
	seed?: CompiledSeed;
	/** Successful runtime discovery replaces (not merges) bundled models. */
	dynamicModelsAuthoritative?: boolean;
	/** Generator backfills never copy reasoning/input/limits from same-id rows. */
	skipCrossProviderReferenceFills?: boolean;
	/** Runtime creates a model manager even without a valid API key. */
	allowUnauthenticated?: boolean;
}

/**
 * OpenRouter's authored seed rows, transcribed verbatim from the retired
 * `providers/openrouter.kdl` seed block (`bundle="always"`,
 * `precedence="upstream"`):
 * - TypeSafe's Jev answers only through the Decisions API
 *   (`/api/alpha/decisions`, System One wire shape); the default `/models`
 *   roster omits `text->decisions` rows, so the alias is authored here and
 *   discovery refreshes the family.
 * - OpenRouter's STT roster mixes per-token and duration-based prices.
 *   Token-priced GPT rows map per-token rates to catalog per-million costs;
 *   duration-priced rows remain zero because ModelCost has no seconds axis.
 * - OpenRouter bills reranking per 1,000 searches, which has no catalog cost
 *   axis. Token costs stay zero; the provider-reported response cost is
 *   authoritative.
 * - Bundled embedding fallbacks keep the gateway useful offline; live
 *   `/embeddings/models` discovery refreshes the roster and per-token pricing.
 * - OpenRouter bills generated video by output second and resolution/SKU,
 *   which ModelCost cannot represent. Poll-reported cost is authoritative;
 *   live `/videos/models` discovery refreshes the roster.
 */
const OPENROUTER_SEED: CompiledSeed = {
	bundle: "always",
	precedence: "upstream",
	models: [
		{
			id: "~typesafe/jev-latest",
			name: "TypeSafe: Jev Latest",
			api: "openrouter-decisions",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/alpha",
			reasoning: false,
			input: ["text"],
			cost: { input: 0.042, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 32000,
			maxTokens: 28800,
		},
		{
			id: "openai/whisper-1",
			name: "OpenAI: Whisper 1",
			api: "openai-transcriptions",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: null,
			maxTokens: null,
		},
		{
			id: "openai/whisper-large-v3",
			name: "OpenAI: Whisper Large V3",
			api: "openai-transcriptions",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: null,
			maxTokens: null,
		},
		{
			id: "openai/gpt-4o-transcribe",
			name: "OpenAI: GPT-4o Transcribe",
			api: "openai-transcriptions",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 115200,
		},
		{
			id: "microsoft/mai-transcribe-1.5",
			name: "Microsoft AI: MAI-Transcribe 1.5",
			api: "openai-transcriptions",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: null,
			maxTokens: null,
		},
		{
			id: "microsoft/mai-transcribe-2",
			name: "Microsoft AI: MAI-Transcribe 2",
			api: "openai-transcriptions",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: null,
			maxTokens: null,
		},
		{
			id: "cohere/rerank-v3.5",
			name: "Cohere: Rerank v3.5",
			api: "openrouter-rerank",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 4096,
			maxTokens: 3686,
		},
		{
			id: "openai/text-embedding-3-small",
			name: "OpenAI: Text Embedding 3 Small",
			api: "openai-embeddings",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: { input: 0.02, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 8192,
			maxTokens: null,
		},
		{
			id: "qwen/qwen3-embedding-8b",
			name: "Qwen: Qwen3 Embedding 8B",
			api: "openai-embeddings",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: { input: 0.01, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 32768,
			maxTokens: null,
		},
		{
			id: "google/veo-3.1",
			name: "Google: Veo 3.1",
			api: "openrouter-video",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: false,
			input: ["text", "image"],
			supportsTools: false,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: null,
			maxTokens: null,
		},
		{
			id: "minimax/hailuo-3",
			name: "MiniMax: H3",
			api: "openrouter-video",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: false,
			input: ["text", "image"],
			supportsTools: false,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: null,
			maxTokens: null,
		},
		{
			id: "alibaba/wan-2.7",
			name: "Alibaba: Wan 2.7",
			api: "openrouter-video",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: false,
			input: ["text", "image"],
			supportsTools: false,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: null,
			maxTokens: null,
		},
	] satisfies CompiledSeedModel[],
};

/**
 * Tau catalog policy for tack-sourced providers, keyed by provider id.
 * Every key MUST name a definition in tack's `PROVIDER_DEFS` (checked at
 * build time below); every other tack definition (llama-swap, nim-local,
 * kimi-auto — sovereign-router-local concepts tack itself flags
 * `routerLocal`) stays out of tau's catalog by design.
 *
 * Values transcribed verbatim from the retired KDL catalog nodes
 * (`default-model`, `kind-apis`, `discovery`, `seed`).
 */
/**
 * abliteration: authored seed rows, transcribed from compiled rules.json
 * (sourced from providers/abliteration.kdl `seed` block).
 * bundle="fallback" precedence="upstream".
 */
const ABLITERATION_SEED: CompiledSeed = {
	bundle: "fallback",
	precedence: "upstream",
	models: [
		{
			id: "abliterated-model",
			name: "Abliterated Model",
			api: "openai-responses",
			provider: "abliteration",
			baseUrl: "https://api.abliteration.ai/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 3,
				output: 3,
				cacheRead: 0.3,
				cacheWrite: 0,
			},
			contextWindow: 262144,
			maxTokens: 262134,
		},
		{
			id: "abliterated-model-large-v2",
			name: "Abliterated Model Large V2",
			api: "openai-responses",
			provider: "abliteration",
			baseUrl: "https://api.abliteration.ai/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 5,
				output: 5,
				cacheRead: 0.5,
				cacheWrite: 0,
			},
			contextWindow: 1000000,
			maxTokens: 999990,
		},
		{
			id: "abliterated-model-large",
			name: "Abliterated Model Large",
			api: "openai-responses",
			provider: "abliteration",
			baseUrl: "https://api.abliteration.ai/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 5,
				output: 5,
				cacheRead: 0.5,
				cacheWrite: 0,
			},
			contextWindow: 1000000,
			maxTokens: 999990,
		},
	],
};

/**
 * aiand: authored seed rows, transcribed from compiled rules.json
 * (sourced from providers/aiand.kdl `seed` block).
 * bundle="fallback" precedence="upstream".
 */
const AIAND_SEED: CompiledSeed = {
	bundle: "fallback",
	precedence: "upstream",
	models: [
		{
			id: "qwen/qwen3.6-27b",
			name: "Qwen3.6 27B",
			api: "openai-completions",
			provider: "aiand",
			baseUrl: "https://api.aiand.com/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 262144,
			maxTokens: null,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high"],
				defaultLevel: "medium",
			},
		},
		{
			id: "deepseek-ai/deepseek-v4-flash",
			name: "DeepSeek V4 Flash",
			api: "openai-completions",
			provider: "aiand",
			baseUrl: "https://api.aiand.com/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 0.15,
				output: 0.25,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 1000000,
			maxTokens: null,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high"],
				defaultLevel: "medium",
			},
		},
		{
			id: "google/gemma-4-31b-it",
			name: "Gemma 4 31B IT",
			api: "openai-completions",
			provider: "aiand",
			baseUrl: "https://api.aiand.com/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 0.2,
				output: 0.5,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 262144,
			maxTokens: null,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high"],
				defaultLevel: "medium",
			},
		},
		{
			id: "openai/gpt-oss-120b",
			name: "GPT OSS 120B",
			api: "openai-completions",
			provider: "aiand",
			baseUrl: "https://api.aiand.com/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 0.15,
				output: 0.6,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 131072,
			maxTokens: null,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high"],
				defaultLevel: "medium",
			},
		},
		{
			id: "deepseek-ai/deepseek-v4-pro",
			name: "DeepSeek V4 Pro",
			api: "openai-completions",
			provider: "aiand",
			baseUrl: "https://api.aiand.com/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 1,
				output: 2.5,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 1000000,
			maxTokens: null,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high"],
				defaultLevel: "medium",
			},
		},
		{
			id: "moonshotai/kimi-k2.7-code",
			name: "Kimi K2.7 Code",
			api: "openai-completions",
			provider: "aiand",
			baseUrl: "https://api.aiand.com/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 0.75,
				output: 3.5,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 262144,
			maxTokens: null,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high"],
				defaultLevel: "medium",
			},
		},
		{
			id: "moonshotai/kimi-k2.6",
			name: "Kimi K2.6",
			api: "openai-completions",
			provider: "aiand",
			baseUrl: "https://api.aiand.com/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 0.85,
				output: 3.5,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 262144,
			maxTokens: null,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high"],
				defaultLevel: "medium",
			},
		},
		{
			id: "zai-org/glm-5.2",
			name: "GLM 5.2",
			api: "openai-completions",
			provider: "aiand",
			baseUrl: "https://api.aiand.com/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 1,
				output: 4,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 1000000,
			maxTokens: null,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high"],
				defaultLevel: "medium",
			},
		},
		{
			id: "zai-org/glm-5.1",
			name: "GLM 5.1",
			api: "openai-completions",
			provider: "aiand",
			baseUrl: "https://api.aiand.com/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 1.4,
				output: 4.4,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 202752,
			maxTokens: null,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high"],
				defaultLevel: "medium",
			},
		},
	],
};

/**
 * anthropic: authored seed rows, transcribed from compiled rules.json
 * (sourced from providers/anthropic.kdl `seed` block).
 * bundle="always" precedence="upstream".
 */
const ANTHROPIC_SEED: CompiledSeed = {
	bundle: "always",
	precedence: "upstream",
	models: [
		{
			id: "claude-sonnet-5",
			name: "Claude Sonnet 5",
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl: "https://api.anthropic.com",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 3,
				output: 15,
				cacheRead: 0.3,
				cacheWrite: 3.75,
			},
			contextWindow: 1000000,
			maxTokens: 128000,
		},
		{
			id: "claude-fable-5",
			name: "Claude Fable 5",
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl: "https://api.anthropic.com",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 10,
				output: 50,
				cacheRead: 1,
				cacheWrite: 12.5,
			},
			contextWindow: 1000000,
			maxTokens: 128000,
		},
		{
			id: "claude-mythos-5",
			name: "Claude Mythos 5",
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl: "https://api.anthropic.com",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 10,
				output: 50,
				cacheRead: 1,
				cacheWrite: 12.5,
			},
			contextWindow: 1000000,
			maxTokens: 128000,
		},
		{
			id: "claude-fable-5-1",
			name: "Claude Fable 5.1",
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl: "https://api.anthropic.com",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 10,
				output: 50,
				cacheRead: 0.25,
				cacheWrite: 12.5,
			},
			contextWindow: 1000000,
			maxTokens: 128000,
		},
		{
			id: "claude-mythos-5-1",
			name: "Claude Mythos 5.1",
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl: "https://api.anthropic.com",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 10,
				output: 50,
				cacheRead: 0.25,
				cacheWrite: 12.5,
			},
			contextWindow: 1000000,
			maxTokens: 128000,
		},
	],
};

/**
 * bedrock-mantle: authored seed rows, transcribed from compiled rules.json
 * (sourced from providers/bedrock-mantle.kdl `seed` block).
 * bundle="always" precedence="upstream".
 */
const BEDROCK_MANTLE_SEED: CompiledSeed = {
	bundle: "always",
	precedence: "upstream",
	models: [
		{
			id: "openai.gpt-5.4",
			name: "GPT-5.4",
			api: "openai-responses",
			provider: "bedrock-mantle",
			baseUrl: "https://bedrock-mantle.{region}.api.aws/openai/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 2.75,
				output: 16.5,
				cacheRead: 0.275,
				cacheWrite: 0,
			},
			contextWindow: 272000,
			maxTokens: 128000,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high", "xhigh"],
			},
		},
		{
			id: "openai.gpt-5.5",
			name: "GPT-5.5",
			api: "openai-responses",
			provider: "bedrock-mantle",
			baseUrl: "https://bedrock-mantle.{region}.api.aws/openai/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 5.5,
				output: 33,
				cacheRead: 0.55,
				cacheWrite: 0,
			},
			contextWindow: 272000,
			maxTokens: 128000,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high", "xhigh"],
			},
		},
		{
			id: "openai.gpt-5.6-luna",
			name: "GPT-5.6 Luna",
			api: "openai-responses",
			provider: "bedrock-mantle",
			baseUrl: "https://bedrock-mantle.{region}.api.aws/openai/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 0.22,
				output: 1.32,
				cacheRead: 0.022,
				cacheWrite: 0.275,
			},
			contextWindow: 272000,
			maxTokens: 128000,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high", "xhigh", "max"],
			},
		},
		{
			id: "openai.gpt-5.6-sol",
			name: "GPT-5.6 Sol",
			api: "openai-responses",
			provider: "bedrock-mantle",
			baseUrl: "https://bedrock-mantle.{region}.api.aws/openai/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 5.5,
				output: 33,
				cacheRead: 0.55,
				cacheWrite: 6.88,
			},
			contextWindow: 272000,
			maxTokens: 128000,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high", "xhigh", "max"],
			},
		},
		{
			id: "openai.gpt-5.6-terra",
			name: "GPT-5.6 Terra",
			api: "openai-responses",
			provider: "bedrock-mantle",
			baseUrl: "https://bedrock-mantle.{region}.api.aws/openai/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 2.2,
				output: 13.2,
				cacheRead: 0.22,
				cacheWrite: 2.75,
			},
			contextWindow: 272000,
			maxTokens: 128000,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high", "xhigh", "max"],
			},
		},
	],
};

/**
 * cloudflare-ai-gateway: authored seed rows, transcribed from compiled rules.json
 * (sourced from providers/cloudflare-ai-gateway.kdl `seed` block).
 * bundle="empty" precedence="upstream".
 */
const CLOUDFLARE_AI_GATEWAY_SEED: CompiledSeed = {
	bundle: "empty",
	precedence: "upstream",
	models: [
		{
			id: "claude-sonnet-4-5",
			name: "Claude Sonnet 4.5",
			api: "anthropic-messages",
			provider: "cloudflare-ai-gateway",
			baseUrl: "https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 3,
				output: 15,
				cacheRead: 0.3,
				cacheWrite: 3.75,
			},
			contextWindow: 200000,
			maxTokens: 64000,
		},
	],
};

/**
 * deepinfra: authored seed rows, transcribed from compiled rules.json
 * (sourced from providers/deepinfra.kdl `seed` block).
 * bundle="always" precedence="upstream".
 */
const DEEPINFRA_SEED: CompiledSeed = {
	bundle: "always",
	precedence: "upstream",
	models: [
		{
			id: "black-forest-labs/FLUX-2-pro",
			name: "FLUX.2 Pro",
			api: "openai-images",
			provider: "deepinfra",
			baseUrl: "https://api.deepinfra.com/v1/openai",
			reasoning: false,
			input: ["text", "image"],
			supportsTools: false,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: null,
			maxTokens: null,
		},
		{
			id: "hexgrad/Kokoro-82M",
			name: "Kokoro-82M",
			api: "openai-speech",
			provider: "deepinfra",
			baseUrl: "https://api.deepinfra.com/v1/openai",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: null,
			maxTokens: null,
		},
	],
};

/**
 * gmi-cloud: authored seed rows, transcribed from compiled rules.json
 * (sourced from providers/gmi-cloud.kdl `seed` block).
 * bundle="fallback" precedence="upstream".
 */
const GMI_CLOUD_SEED: CompiledSeed = {
	bundle: "fallback",
	precedence: "upstream",
	models: [
		{
			id: "deepseek-ai/DeepSeek-V4-Flash",
			name: "DeepSeek V4 Flash",
			api: "openai-completions",
			provider: "gmi-cloud",
			baseUrl: "https://api.gmi-serving.com/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 0.14,
				output: 0.28,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 1048576,
			maxTokens: 384000,
			thinking: {
				mode: "effort",
				efforts: ["high", "max"],
			},
		},
	],
};

/**
 * meta: authored seed rows, transcribed from compiled rules.json
 * (sourced from providers/meta.kdl `seed` block).
 * bundle="always" precedence="seed".
 */
const META_SEED: CompiledSeed = {
	bundle: "always",
	precedence: "seed",
	models: [
		{
			id: "muse-spark-1.1",
			name: "Muse Spark 1.1",
			api: "openai-responses",
			provider: "meta",
			baseUrl: "https://api.meta.ai/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 1.25,
				output: 4.25,
				cacheRead: 0.15,
				cacheWrite: 0,
			},
			contextWindow: 1048576,
			maxTokens: 131072,
			thinking: {
				mode: "effort",
				efforts: ["minimal", "low", "medium", "high", "xhigh"],
			},
			compat: {
				supportsReasoningEffort: true,
				includeEncryptedReasoning: true,
			},
		},
		{
			id: "muse-spark-1.2",
			name: "Muse Spark 1.2",
			api: "openai-responses",
			provider: "meta",
			baseUrl: "https://api.meta.ai/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 1.25,
				output: 4.25,
				cacheRead: 0.15,
				cacheWrite: 0,
			},
			contextWindow: 1048576,
			maxTokens: 131072,
			thinking: {
				mode: "effort",
				efforts: ["minimal", "low", "medium", "high", "xhigh"],
			},
			compat: {
				supportsReasoningEffort: true,
				includeEncryptedReasoning: true,
			},
		},
		{
			id: "muse-spark-1.2-contributor",
			name: "Muse Spark 1.2 (C)",
			api: "openai-responses",
			provider: "meta",
			baseUrl: "https://api.meta.ai/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 0.1,
				output: 0.2,
				cacheRead: 0.002,
				cacheWrite: 0,
			},
			contextWindow: 1048576,
			maxTokens: 131072,
			thinking: {
				mode: "effort",
				efforts: ["minimal", "low", "medium", "high", "xhigh"],
			},
			compat: {
				supportsReasoningEffort: true,
				includeEncryptedReasoning: true,
			},
		},
		{
			id: "muse-spark-1.3",
			name: "Muse Spark 1.3",
			api: "openai-responses",
			provider: "meta",
			baseUrl: "https://api.meta.ai/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 1.25,
				output: 4.25,
				cacheRead: 0.15,
				cacheWrite: 0,
			},
			contextWindow: 1048576,
			maxTokens: 131072,
			thinking: {
				mode: "effort",
				efforts: ["minimal", "low", "medium", "high", "xhigh", "max"],
			},
			compat: {
				supportsReasoningEffort: true,
				includeEncryptedReasoning: true,
			},
		},
		{
			id: "muse-spark-1.3-contributor",
			name: "Muse Spark 1.3 (C)",
			api: "openai-responses",
			provider: "meta",
			baseUrl: "https://api.meta.ai/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 0.1,
				output: 0.2,
				cacheRead: 0.002,
				cacheWrite: 0,
			},
			contextWindow: 1048576,
			maxTokens: 131072,
			thinking: {
				mode: "effort",
				efforts: ["minimal", "low", "medium", "high", "xhigh"],
			},
			compat: {
				supportsReasoningEffort: true,
				includeEncryptedReasoning: true,
			},
		},
	],
};

/**
 * openai: authored seed rows, transcribed from compiled rules.json
 * (sourced from providers/openai.kdl `seed` block).
 * bundle="always" precedence="upstream".
 */
const OPENAI_SEED: CompiledSeed = {
	bundle: "always",
	precedence: "upstream",
	models: [
		{
			id: "daybreak-blue-latest",
			name: "Daybreak Blue",
			api: "openai-responses",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 5,
				output: 30,
				cacheRead: 0.5,
				cacheWrite: 6.25,
			},
			contextWindow: 1050000,
			maxTokens: 128000,
		},
		{
			id: "daybreak-red-latest",
			name: "Daybreak Red",
			api: "openai-responses",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 12.5,
				output: 75,
				cacheRead: 1.25,
				cacheWrite: 15.625,
			},
			contextWindow: 400000,
			maxTokens: 128000,
		},
		{
			id: "gpt-5.6-cyber",
			name: "GPT-5.6 Cyber",
			api: "openai-responses",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 12.5,
				output: 75,
				cacheRead: 1.25,
				cacheWrite: 15.625,
			},
			contextWindow: 400000,
			maxTokens: 128000,
		},
		{
			id: "whisper-1",
			name: "Whisper 1",
			api: "openai-transcriptions",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: null,
			maxTokens: null,
		},
		{
			id: "gpt-4o-transcribe",
			name: "GPT-4o Transcribe",
			api: "openai-transcriptions",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: {
				input: 2.5,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 16000,
			maxTokens: 2000,
		},
		{
			id: "gpt-4o-mini-transcribe",
			name: "GPT-4o Mini Transcribe",
			api: "openai-transcriptions",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: {
				input: 1.25,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 16000,
			maxTokens: 2000,
		},
		{
			id: "text-embedding-3-small",
			name: "Text Embedding 3 Small",
			api: "openai-embeddings",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: {
				input: 0.02,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 8192,
			maxTokens: null,
		},
		{
			id: "text-embedding-3-large",
			name: "Text Embedding 3 Large",
			api: "openai-embeddings",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: {
				input: 0.13,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 8192,
			maxTokens: null,
		},
		{
			id: "text-embedding-ada-002",
			name: "Text Embedding Ada 002",
			api: "openai-embeddings",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: {
				input: 0.1,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 8192,
			maxTokens: null,
		},
	],
};

/**
 * sakana: authored seed rows, transcribed from compiled rules.json
 * (sourced from providers/sakana.kdl `seed` block).
 * bundle="fallback" precedence="upstream".
 */
const SAKANA_SEED: CompiledSeed = {
	bundle: "fallback",
	precedence: "upstream",
	models: [
		{
			id: "fugu",
			name: "Fugu",
			api: "openai-responses",
			provider: "sakana",
			baseUrl: "https://api.sakana.ai/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 1000000,
			maxTokens: null,
			thinking: {
				mode: "effort",
				efforts: ["high", "max"],
			},
			compat: {
				includeEncryptedReasoning: false,
				streamIdleTimeoutMs: 0,
			},
		},
		{
			id: "fugu-ultra",
			name: "Fugu Ultra",
			api: "openai-responses",
			provider: "sakana",
			baseUrl: "https://api.sakana.ai/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 5,
				output: 30,
				cacheRead: 0.5,
				cacheWrite: 0,
			},
			contextWindow: 1000000,
			maxTokens: null,
			thinking: {
				mode: "effort",
				efforts: ["high", "max"],
			},
			compat: {
				includeEncryptedReasoning: false,
				streamIdleTimeoutMs: 0,
			},
		},
		{
			id: "fugu-ultra-20260615",
			name: "Fugu Ultra 20260615",
			api: "openai-responses",
			provider: "sakana",
			baseUrl: "https://api.sakana.ai/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 5,
				output: 30,
				cacheRead: 0.5,
				cacheWrite: 0,
			},
			contextWindow: 1000000,
			maxTokens: null,
			thinking: {
				mode: "effort",
				efforts: ["high", "max"],
			},
			compat: {
				includeEncryptedReasoning: false,
				streamIdleTimeoutMs: 0,
			},
		},
	],
};

/**
 * stepfun: authored seed rows, transcribed from compiled rules.json
 * (sourced from providers/stepfun.kdl `seed` block).
 * bundle="always" precedence="upstream".
 */
const STEPFUN_SEED: CompiledSeed = {
	bundle: "always",
	precedence: "upstream",
	models: [
		{
			id: "step-5-preview",
			name: "Step 5 Preview",
			api: "openai-completions",
			provider: "stepfun",
			baseUrl: "https://api.stepfun.ai/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 1,
				output: 2.7,
				cacheRead: 0.05,
				cacheWrite: 0,
			},
			contextWindow: 1000000,
			maxTokens: 1000000,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high"],
			},
		},
		{
			id: "step-3.7-flash",
			name: "Step 3.7 Flash",
			api: "openai-completions",
			provider: "stepfun",
			baseUrl: "https://api.stepfun.ai/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 0.2,
				output: 1.15,
				cacheRead: 0.04,
				cacheWrite: 0,
			},
			contextWindow: 256000,
			maxTokens: 256000,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high"],
			},
		},
		{
			id: "step-3.5-flash",
			name: "Step 3.5 Flash",
			api: "openai-completions",
			provider: "stepfun",
			baseUrl: "https://api.stepfun.ai/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 0.1,
				output: 0.3,
				cacheRead: 0.02,
				cacheWrite: 0,
			},
			contextWindow: 256000,
			maxTokens: 256000,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high"],
			},
		},
		{
			id: "step-3.5-flash-2603",
			name: "Step 3.5 Flash 2603",
			api: "openai-completions",
			provider: "stepfun",
			baseUrl: "https://api.stepfun.ai/v1",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 0.1,
				output: 0.3,
				cacheRead: 0.02,
				cacheWrite: 0,
			},
			contextWindow: 256000,
			maxTokens: 256000,
			thinking: {
				mode: "effort",
				efforts: ["low", "medium", "high"],
			},
		},
	],
};

/**
 * typesafe: authored seed rows, transcribed from compiled rules.json
 * (sourced from providers/typesafe.kdl `seed` block).
 * bundle="always" precedence="upstream".
 */
const TYPESAFE_SEED: CompiledSeed = {
	bundle: "always",
	precedence: "upstream",
	models: [
		{
			id: "jev-latest",
			name: "TypeSafe jev",
			api: "typesafe",
			provider: "typesafe",
			baseUrl: "https://api.typesafe.ai",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: {
				input: 0.042,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: null,
			maxTokens: null,
		},
	],
};

/**
 * xai: authored seed rows, transcribed from compiled rules.json
 * (sourced from providers/xai.kdl `seed` block).
 * bundle="always" precedence="upstream".
 */
const XAI_SEED: CompiledSeed = {
	bundle: "always",
	precedence: "upstream",
	models: [
		{
			id: "grok-tts",
			name: "Grok TTS",
			api: "xai-tts",
			provider: "xai",
			baseUrl: "https://api.x.ai/v1",
			reasoning: false,
			input: ["text"],
			supportsTools: false,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: null,
			maxTokens: null,
		},
	],
};

/**
 * zai: authored seed rows, transcribed from compiled rules.json
 * (sourced from providers/zai.kdl `seed` block).
 * bundle="always" precedence="upstream".
 */
const ZAI_SEED: CompiledSeed = {
	bundle: "always",
	precedence: "upstream",
	models: [
		{
			id: "glm-5.3",
			name: "GLM-5.3",
			api: "anthropic-messages",
			provider: "zai",
			baseUrl: "https://api.z.ai/api/anthropic",
			reasoning: true,
			input: ["text"],
			cost: {
				input: 1.4,
				output: 4.4,
				cacheRead: 0.26,
				cacheWrite: 0,
			},
			contextWindow: 1000000,
			maxTokens: 131072,
		},
		{
			id: "glm-5.3-flash",
			name: "GLM-5.3-Flash",
			api: "openai-completions",
			provider: "zai",
			baseUrl: "https://api.z.ai/api/coding/paas/v4",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 0.15,
				output: 0.5,
				cacheRead: 0.03,
				cacheWrite: 0,
			},
			contextWindow: 1000000,
			maxTokens: 131072,
		},
	],
};

const TAU_PROVIDER_POLICY: Readonly<Record<string, TauProviderPolicy>> = {
	cerebras: {
		defaultModel: "zai-glm-4.7",
		discovery: { label: "Cerebras" },
	},
	google: {
		defaultModel: "gemini-3.1-pro-preview",
		kindApis: { image: "google-generative-ai" },
	},
	groq: {
		defaultModel: "openai/gpt-oss-120b",
	},
	mistral: {
		defaultModel: "devstral-medium-latest",
	},
	nvidia: {
		defaultModel: "nvidia/llama-3.1-nemotron-70b-instruct",
		discovery: { label: "NVIDIA" },
	},
	openrouter: {
		defaultModel: "openai/gpt-5.5",
		discovery: { label: "OpenRouter", allowUnauthenticated: true },
		kindApis: {
			embedding: "openai-embeddings",
			image: "openrouter-images",
			rerank: "openrouter-rerank",
			video: "openrouter-video",
			tts: "openai-speech",
			stt: "openai-transcriptions",
		},
		seed: OPENROUTER_SEED,
	},
	abliteration: {
		defaultModel: "abliterated-model",
		discovery: {
			label: "Abliteration",
		},
		dynamicModelsAuthoritative: true,
		seed: ABLITERATION_SEED,
	},
	aiand: {
		defaultModel: "moonshotai/kimi-k2.7-code",
		discovery: {
			label: "ai&",
		},
		dynamicModelsAuthoritative: true,
		seed: AIAND_SEED,
	},
	aimlapi: {
		defaultModel: "gpt-5.5-2026-04-23",
		discovery: {
			label: "AIML API",
		},
		dynamicModelsAuthoritative: true,
	},
	anthropic: {
		defaultModel: "claude-opus-5-5",
		discovery: {
			label: "Anthropic",
		},
		seed: ANTHROPIC_SEED,
	},
	baseten: {
		defaultModel: "moonshotai/Kimi-K2.7-Code",
		discovery: {
			label: "Baseten",
		},
		dynamicModelsAuthoritative: true,
	},
	"bedrock-mantle": {
		defaultModel: "openai.gpt-5.6-terra",
		dynamicModelsAuthoritative: true,
		seed: BEDROCK_MANTLE_SEED,
	},
	"charm-hyper": {
		defaultModel: "glm-5.3",
		dynamicModelsAuthoritative: true,
		skipCrossProviderReferenceFills: true,
		allowUnauthenticated: true,
	},
	"cloudflare-ai-gateway": {
		defaultModel: "anthropic/claude-opus-5",
		discovery: {
			label: "Cloudflare AI Gateway",
		},
		seed: CLOUDFLARE_AI_GATEWAY_SEED,
	},
	commandcode: {
		defaultModel: "claude-sonnet-5",
		discovery: {
			label: "Command Code",
			allowUnauthenticated: true,
		},
		dynamicModelsAuthoritative: true,
		skipCrossProviderReferenceFills: true,
		allowUnauthenticated: true,
	},
	coreweave: {
		defaultModel: "openai/gpt-oss-120b",
		discovery: {
			label: "CoreWeave Serverless Inference",
		},
		dynamicModelsAuthoritative: true,
	},
	deepinfra: {
		defaultModel: "deepseek-ai/DeepSeek-V4-Flash-0731",
		discovery: {
			label: "DeepInfra",
			allowUnauthenticated: true,
		},
		kindApis: {
			image: "openai-images",
			tts: "openai-speech",
		},
		dynamicModelsAuthoritative: true,
		seed: DEEPINFRA_SEED,
	},
	deepseek: {
		defaultModel: "deepseek-v4-pro",
		discovery: {
			label: "DeepSeek",
		},
	},
	fireworks: {
		defaultModel: "kimi-k2.7-code",
		discovery: {
			label: "Fireworks",
		},
	},
	"gmi-cloud": {
		defaultModel: "deepseek-ai/DeepSeek-V4-Flash",
		discovery: {
			label: "GMI Cloud",
		},
		dynamicModelsAuthoritative: true,
		seed: GMI_CLOUD_SEED,
	},
	huggingface: {
		defaultModel: "deepseek-ai/DeepSeek-R1",
		discovery: {
			label: "Hugging Face",
		},
	},
	meta: {
		defaultModel: "muse-spark-1.1",
		discovery: {
			label: "Meta Model API",
		},
		seed: META_SEED,
	},
	minimax: {
		defaultModel: "MiniMax-M3",
	},
	moonshot: {
		defaultModel: "kimi-k2.7-code",
		discovery: {
			label: "Moonshot",
		},
	},
	nanogpt: {
		defaultModel: "openai/gpt-5.5",
		discovery: {
			label: "NanoGPT",
		},
	},
	novita: {
		defaultModel: "moonshotai/kimi-k2.7-code",
		discovery: {
			label: "Novita",
			allowUnauthenticated: true,
		},
		dynamicModelsAuthoritative: true,
	},
	"ollama-cloud": {
		defaultModel: "gpt-oss:120b",
		discovery: {
			label: "Ollama Cloud",
			oauthProvider: "ollama-cloud",
		},
	},
	openai: {
		defaultModel: "gpt-5.5",
		kindApis: {
			embedding: "openai-embeddings",
			image: "openai-responses",
			stt: "openai-transcriptions",
		},
		seed: OPENAI_SEED,
	},
	qianfan: {
		defaultModel: "deepseek-v3.2",
		discovery: {
			label: "Qianfan",
		},
	},
	sakana: {
		defaultModel: "fugu",
		discovery: {
			label: "Sakana AI",
		},
		dynamicModelsAuthoritative: true,
		seed: SAKANA_SEED,
	},
	siliconflow: {
		defaultModel: "zai-org/GLM-5.1",
		dynamicModelsAuthoritative: true,
	},
	"siliconflow-cn": {
		defaultModel: "deepseek-ai/DeepSeek-V4-Pro",
		dynamicModelsAuthoritative: true,
	},
	stepfun: {
		defaultModel: "step-5-preview",
		discovery: {
			label: "StepFun",
		},
		dynamicModelsAuthoritative: true,
		skipCrossProviderReferenceFills: true,
		seed: STEPFUN_SEED,
	},
	synthetic: {
		defaultModel: "hf:zai-org/GLM-5.3-Flash",
		discovery: {
			label: "Synthetic",
		},
		dynamicModelsAuthoritative: true,
	},
	together: {
		defaultModel: "moonshotai/Kimi-K2.7-Code",
		discovery: {
			label: "Together",
		},
	},
	typesafe: {
		defaultModel: "jev-latest",
		seed: TYPESAFE_SEED,
	},
	venice: {
		defaultModel: "llama-3.3-70b",
		discovery: {
			label: "Venice",
			allowUnauthenticated: true,
		},
	},
	"vercel-ai-gateway": {
		defaultModel: "anthropic/claude-opus-5",
		discovery: {
			label: "Vercel AI Gateway",
			allowUnauthenticated: true,
			envVars: ["VERCEL_AI_GATEWAY_API_KEY"],
		},
	},
	"wafer-serverless": {
		defaultModel: "GLM-5.1",
		discovery: {
			label: "Wafer Serverless",
			oauthProvider: "wafer-serverless",
		},
	},
	xai: {
		defaultModel: "grok-4.6",
		kindApis: {
			image: "openai-images",
			tts: "xai-tts",
		},
		seed: XAI_SEED,
	},
	xiaomi: {
		defaultModel: "mimo-v2.5",
		discovery: {
			label: "Xiaomi",
		},
	},
	zai: {
		defaultModel: "glm-5.3",
		discovery: {
			label: "zAI",
		},
		seed: ZAI_SEED,
	},
	zenmux: {
		defaultModel: "anthropic/claude-opus-5",
		discovery: {
			label: "ZenMux",
			allowUnauthenticated: true,
		},
		allowUnauthenticated: true,
	},
};

/** Provider ids whose catalog entries are sourced from tack (sorted). */
export const TACK_PROVIDER_IDS: readonly string[] = Object.keys(TAU_PROVIDER_POLICY).sort();

/**
 * Projects tack's provider definitions onto tau's `CompiledProvider` shape.
 * Wire data (env vars, auth posture, discovery label seed) comes from tack;
 * tau catalog policy (default model, kind APIs, discovery flags, seed rows)
 * comes from `TAU_PROVIDER_POLICY`.
 */
export function tackProviderEntries(): Record<string, CompiledProvider> {
	const defs = new Map(PROVIDER_DEFS.map(def => [def.name, def]));
	const entries: Record<string, CompiledProvider> = {};
	for (const id of TACK_PROVIDER_IDS) {
		const def = defs.get(id);
		if (!def) {
			throw new Error(`tack provider policy for "${id}" has no PROVIDER_DEFS definition — tack is the authority`);
		}
		const policy = TAU_PROVIDER_POLICY[id]!;
		const envVars = [def.keyEnv, ...(def.keyEnvAlt ? [def.keyEnvAlt] : [])];
		const entry: CompiledProvider = {
			id,
			defaultModel: policy.defaultModel,
			envVars,
			...((policy.allowUnauthenticated || def.auth === "none") && { allowUnauthenticated: true }),
			...(policy.dynamicModelsAuthoritative && { dynamicModelsAuthoritative: true }),
			...(policy.skipCrossProviderReferenceFills && { skipCrossProviderReferenceFills: true }),
			...(policy.discovery && {
				discovery: { ...policy.discovery, envVars: policy.discovery.envVars ?? envVars },
			}),
			...(policy.kindApis && { kindApis: policy.kindApis }),
			...(policy.seed && { seed: policy.seed }),
		};
		entries[id] = entry;
	}
	return entries;
}

/**
 * Bundled seed rows for a tack-sourced provider, for KDL `models-from`
 * references. Providers like `muse-code` inherit their seed rows from a
 * converted provider (`meta`); the compiler resolves those references
 * against this instead of the (retired) KDL seed block.
 */
export function tackProviderSeed(id: string): CompiledSeed | undefined {
	return TAU_PROVIDER_POLICY[id]?.seed;
}
