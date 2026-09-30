/**
 * remuda — tau's provider-data authority.
 *
 * `@ranch/remuda` (`ranch/remuda`) is the single source of truth for provider
 * wire data across the sovereign estate: base URLs, key env vars, auth
 * schemes, `/models` endpoint adapters, aliases, and cold-start seeds. Tau
 * consumes it here and projects each definition onto the `CompiledProvider`
 * shape the catalog engine (`provider-models/descriptors.ts`,
 * `scripts/generate-models.ts`) already understands.
 *
 * What lives where:
 * - `ranch/remuda` `PROVIDER_DEFS` — provider wire data (`baseUrl`, `keyEnv`,
 *   `keyEnvAlt`, `auth`, `adapter`, `modelsPath`, `seeds`). The authority;
 *   never duplicated here. A provider remuda drops stops being a tau catalog
 *   provider — the builder below throws on drift.
 * - `TAU_PROVIDER_POLICY` — tau-side catalog policy for remuda-sourced
 *   providers: default model, kind→API mapping, discovery flags, and the
 *   authored seed rows (model metadata: cost/limits/input). Transcribed
 *   verbatim from the retired KDL catalog nodes; the
 *   `src/compat/rules/providers/<id>.kdl` files keep only their cascade
 *   wire-compat rules.
 * - `src/compat/rules/providers/*.kdl` — cascade (wire-compat) rules for every
 *   provider, plus catalog entries for providers remuda does not cover yet
 *   (legacy rump, shrinking as remuda curates them).
 *
 * `src/compat/providers.ts` merges these entries over the KDL-compiled ones;
 * remuda wins on id conflict (there are none by construction — the KDL
 * catalog nodes for covered providers were deleted).
 *
 * Import path note: tau is its own repo (`toxicwind/tau`) nested inside the
 * ranch monorepo, so this reaches remuda via a relative import — the same
 * pattern the sovereign router uses (`tools/sovereign-router/
 * sovereign-router-ts/router_live_models.ts`).
 */
import { PROVIDER_DEFS } from "../../../../../remuda/src/index.ts";
import type { Api, KindApiKind } from "../types";
import type { CompiledProvider, CompiledProviderDiscovery, CompiledSeed, CompiledSeedModel } from "./types";

/** Tau-side catalog policy for one remuda-sourced provider. */
interface TauProviderPolicy {
	/** Preferred model id when no explicit selection is made (tau UX policy). */
	defaultModel: string;
	/** Non-chat model kinds mapped to their runtime transport APIs. */
	kindApis?: Partial<Record<KindApiKind, Api>>;
	/** Generator discovery enrollment (absent = not enrolled, as before). */
	discovery?: CompiledProviderDiscovery;
	/** Authored bundled seed rows (model metadata, transcribed from KDL). */
	seed?: CompiledSeed;
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
 * Tau catalog policy for remuda-sourced providers, keyed by provider id.
 * Every key MUST name a definition in remuda's `PROVIDER_DEFS` (checked at
 * build time below); every other remuda definition (llama-swap, nim-local,
 * kimi-auto — sovereign-router-local concepts remuda itself flags
 * `routerLocal`) stays out of tau's catalog by design.
 *
 * Values transcribed verbatim from the retired KDL catalog nodes
 * (`default-model`, `kind-apis`, `discovery`, `seed`).
 */
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
};

/** Provider ids whose catalog entries are sourced from remuda (sorted). */
export const REMUDA_PROVIDER_IDS: readonly string[] = Object.keys(TAU_PROVIDER_POLICY).sort();

/**
 * Projects remuda's provider definitions onto tau's `CompiledProvider` shape.
 * Wire data (env vars, auth posture, discovery label seed) comes from remuda;
 * tau catalog policy (default model, kind APIs, discovery flags, seed rows)
 * comes from `TAU_PROVIDER_POLICY`.
 */
export function remudaProviderEntries(): Record<string, CompiledProvider> {
	const defs = new Map(PROVIDER_DEFS.map(def => [def.name, def]));
	const entries: Record<string, CompiledProvider> = {};
	for (const id of REMUDA_PROVIDER_IDS) {
		const def = defs.get(id);
		if (!def) {
			throw new Error(
				`remuda provider policy for "${id}" has no PROVIDER_DEFS definition — remuda is the authority`,
			);
		}
		const policy = TAU_PROVIDER_POLICY[id]!;
		const envVars = [def.keyEnv, ...(def.keyEnvAlt ? [def.keyEnvAlt] : [])];
		const entry: CompiledProvider = {
			id,
			defaultModel: policy.defaultModel,
			envVars,
			...(def.auth === "none" && { allowUnauthenticated: true }),
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
