/**
 * Single-source provider auth model. Every provider — model providers,
 * gateways, search/tool credentials, and login-only flows — is described by
 * one {@link ProviderDefinition}. The legacy scattered structures (the
 * `OAuthProvider` union, `serviceProviderMap`, `builtInOAuthProviders`, the
 * refresh/login switches, and the CLI callback maps) are all *derived* from
 * the registry of these definitions. Adding a provider is one new file in
 * `./providers/` plus one line in `./registry.ts`. Model-catalog metadata
 * (default model, model-manager factory, catalog discovery) lives in
 * `@oh-my-pi/pi-catalog`'s descriptor table.
 */

import type { Api, FetchImpl, Model, SimpleStreamOptions, StreamOptions } from "../types";
import type { OAuthCredentials, OAuthLoginCallbacks } from "./oauth/types";

/**
 * Provider-owned retry-after backoff knobs.
 *
 * Both Anthropic and the OpenAI-compat transport (`fetchWithRetry`) honor
 * `maxRetryDelayMs` as a ceiling on server-requested `retry-after` / quota
 * hints. `unboundedRetryAfter: true` is the explicit opt-in that lifts that
 * ceiling (semantically equivalent to passing `maxRetryDelayMs <= 0` through
 * the option) for providers whose free-tier / subscription daily quotas
 * legitimately request multi-hour waits (e.g. OpenCode Go/Zen
 * `retry-after-ms=21431000`). Used at three layers: the transport cap
 * (`postOpenAIStream` ⇒ `fetchWithRetry`, Anthropic client), the agent
 * `maxRetryDelayMs` forwarding, and the `TurnRecovery` fail-fast against
 * `retry.maxDelayMs` so a long quota hint is not surfaced as a hard error
 * before any waiting actually happens.
 *
 * `maxRetryDelayMs` here is the *default* cap, layered with caller-supplied
 * options at the call site (caller wins when it sets `maxRetryDelayMs`
 * explicitly; an `unbounded` provider opt-out makes the cap effectively
 * `0` / disabled so `fetchWithRetry` honors the hint verbatim).
 */
export interface ProviderRetryConfig {
	/** Per-provider default for the transport `maxRetryDelayMs` cap. */
	readonly maxRetryDelayMs?: number;
	/**
	 * Treat the provider as willing to ask for arbitrarily long retry-after
	 * waits (free-tier daily quotas, multi-hour backend resets, …) and let
	 * the wait happen end-to-end instead of failing fast. The user's
	 * `retry.maxDelayMs` ceiling still applies in `TurnRecovery` unless
	 * `resolveProviderMaxRetryDelayMs` is also consulted there.
	 */
	readonly unboundedRetryAfter?: boolean;
}

/**
 * API-key environment fallback: either a single env var name (e.g.
 * `"OPENAI_API_KEY"`) or a resolver that inspects several env vars / probes
 * the host (Vertex ADC, Bedrock credential chains, …).
 */
export type KeyResolver = string | (() => string | undefined);

/** Credentials are resolved by the provider transport rather than used as a bearer string. */
export const AUTHENTICATED_SENTINEL = "<authenticated>";

export interface PreparedProviderRequest {
	readonly model: Model<Api>;
	readonly options: StreamOptions;
}

export type ProviderRequestPreparer = (model: Model<Api>, options: StreamOptions) => PreparedProviderRequest;
export type ProviderSimpleOptionsMapper = (options: SimpleStreamOptions) => Readonly<Record<string, unknown>>;

export interface ProviderModelDiscoveryConfig {
	readonly apiKey?: string;
	readonly baseUrl?: string;
	readonly fetch?: FetchImpl;
	readonly authenticated?: boolean;
}

export type ProviderModelDiscoveryPreparer = (config: ProviderModelDiscoveryConfig) => ProviderModelDiscoveryConfig;

/**
 * Declarative description of a single provider's auth/login wiring. All
 * fields are optional except `id`/`name`; presence of a field opts the
 * provider into a derived structure:
 *
 * - `envKeys` present ⇒ env-var fallback in `getEnvApiKey`, overriding the
 *   catalog table's `envVars` for that provider.
 * - `login` present ⇒ member of `OAuthProvider`, shown in the `/login` list
 *   (unless `showInLoginList === false`) and dispatchable via `AuthStorage.login`.
 * - `callbackPort` present ⇒ entry in the auth-broker `CALLBACK_PORTS` map.
 * - `pasteCodeFlow` ⇒ member of `PASTE_CODE_LOGIN_PROVIDERS`.
 * - `retry` present ⇒ per-provider transport/backoff knobs
 *   (`maxRetryDelayMs` ceiling, `unboundedRetryAfter` opt-out). See
 *   {@link resolveProviderMaxRetryDelayMs}.
 *
 * Heavy OAuth flow modules MUST be reached through dynamic-import thunks in
 * `login`/`refreshToken` so they stay out of the eager startup graph.
 */
export interface ProviderDefinition {
	readonly id: string;
	readonly name: string;
	/** Login-list availability flag. Defaults to true when shown. */
	readonly available?: boolean;
	/** Whether to surface in the interactive login list. Defaults to true when `login` is present. */
	readonly showInLoginList?: boolean;
	// --- env-var fallback (the catalog table's `envVars` supplies plain names; set this only for computed resolvers) ---
	readonly envKeys?: KeyResolver;
	/** Provider transport can authenticate without a resolved API-key string. */
	readonly allowsMissingApiKey?: boolean;
	/** Provider-owned request shaping applied before generic API dispatch. */
	readonly prepareRequest?: ProviderRequestPreparer;
	/** Provider-owned projection from the generic simple-stream option bag. */
	readonly mapSimpleOptions?: ProviderSimpleOptionsMapper;
	/** Provider-owned authentication and endpoint setup for model discovery. */
	readonly prepareModelDiscovery?: ProviderModelDiscoveryPreparer;
	/** Provider-owned retry/backoff knobs. See {@link ProviderRetryConfig}. */
	readonly retry?: ProviderRetryConfig;
	// --- interactive login (OAuthProviderInterface-compatible) ---
	readonly login?: (callbacks: OAuthLoginCallbacks) => Promise<OAuthCredentials | string>;
	/** Refresh a stored grant; the signal bounds provider network work to refresh ownership. */
	readonly refreshToken?: (credentials: OAuthCredentials, signal?: AbortSignal) => Promise<OAuthCredentials>;
	readonly getApiKey?: (credentials: OAuthCredentials) => string;
	/** Store OAuth credentials under a different provider id (e.g. `openai-codex-device` ⇒ `openai-codex`). */
	readonly storeCredentialsAs?: string;
	// --- coding-agent login UX ---
	/** Auth-broker local callback-server port. Presence ⇒ entry in `CALLBACK_PORTS`. */
	readonly callbackPort?: number;
	/** OAuth flow needs a pasted code/redirect URL rather than a callback server. */
	readonly pasteCodeFlow?: boolean;
}
