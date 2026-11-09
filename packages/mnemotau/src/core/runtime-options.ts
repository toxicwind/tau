import { AsyncLocalStorage } from "node:async_hooks";
import type { Api, ApiKey, Model } from "@tau/tau-ai";

export type MnemotauLlmCompletionTask = {
	kind: "memory-extraction";
	input: string;
};

<<<<<<< ours — interface `MnemopiLlmCompleteOptions` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: none (both sides edited, nowhere the same lines)
export interface MnemotauLlmCompleteOptions {
	maxTokens?: number;
	temperature?: number;
	timeout?: number;
	provider?: string | null;
	model?: string | null;
	task?: MnemotauLlmCompletionTask;
=======
export interface MnemopiLlmCompleteOptions {
	maxTokens?: number;
	temperature?: number;
	timeout?: number;
	provider?: string | null;
	model?: string | null;
	task?: MnemopiLlmCompletionTask;
>>>>>>> theirs — interface `MnemopiLlmCompleteOptions` (S+F, confidence: low) · weave: run 'weave explain packages/mnemotau/src/core/runtime-options.ts' for per-hunk detail, 'weave check' to verify your resolution
}

export type MnemotauLlmCompletion = (
	prompt: string,
	opts?: MnemotauLlmCompleteOptions,
) => string | null | Promise<string | null>;

/**
 * What an embedding provider's `embed` returns: the embedding matrix streamed as async batches,
 * matching fastembed's `embed()` (`AsyncGenerator<number[][]>`). Each yielded batch is a list of
 * rows; each row is one number per dimension. Yield the whole matrix as a single batch when not
 * streaming: `async *embed(texts) { yield texts.map(embedOne); }`.
 */
export type EmbeddingOutput = AsyncIterable<number[][]>;

export interface MnemotauEmbeddingProvider {
	embed(texts: readonly string[]): EmbeddingOutput | Promise<EmbeddingOutput>;
	available?(): boolean | Promise<boolean>;
}

<<<<<<< ours — interface `MnemopiEmbeddingRuntimeOptions` (S+F, confidence: low)
// refused_by: rename_vs_edit_guard · collision: none (1 contested hunk(s), neither side deleted the other's lines)
export interface MnemotauEmbeddingRuntimeOptions {
	disabled?: boolean;
	model?: string;
	apiUrl?: string;
	apiKey?: ApiKey;
	provider?: MnemotauEmbeddingProvider | ((texts: readonly string[]) => EmbeddingOutput | Promise<EmbeddingOutput>);
	/** Override `MNEMOTAU_EMBEDDING_MAX_INPUT_CHARS`. `0` disables the cap. See `config.embeddingMaxInputChars`. */
	maxInputChars?: number;
=======
export interface MnemopiEmbeddingRuntimeOptions {
	disabled?: boolean;
	model?: string;
	apiUrl?: string;
	apiKey?: ApiKey;
	provider?: MnemopiEmbeddingProvider | ((texts: readonly string[]) => EmbeddingOutput | Promise<EmbeddingOutput>);
	/** Override `MNEMOPI_EMBEDDING_MAX_INPUT_CHARS`. `0` disables the cap. See `config.embeddingMaxInputChars`. */
	maxInputChars?: number;
	/** Override `MNEMOPI_EMBEDDING_BATCH_SIZE`: max texts per embedding API request. */
	batchSize?: number;
>>>>>>> theirs — interface `MnemopiEmbeddingRuntimeOptions` (S+F, confidence: low)
}

<<<<<<< ours — interface `MnemopiLlmRuntimeOptions` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: none (both sides edited, nowhere the same lines)
export interface MnemotauLlmRuntimeOptions {
	enabled?: boolean;
	baseUrl?: string;
	apiKey?: ApiKey;
	model?: string | Model<Api>;
	maxTokens?: number;
	complete?: MnemotauLlmCompletion;
=======
export interface MnemopiLlmRuntimeOptions {
	enabled?: boolean;
	baseUrl?: string;
	apiKey?: ApiKey;
	model?: string | Model<Api>;
	maxTokens?: number;
	complete?: MnemopiLlmCompletion;
>>>>>>> theirs — interface `MnemopiLlmRuntimeOptions` (S+F, confidence: low)
	/** Override the fact-extraction prompt template ({text}/{lang}). Used to feed small local models a friendlier format. */
	extractionPrompt?: string;
	/** Override the consolidation/sleep prompt template ({memories}/{source}/{memory_count}). */
	consolidationPrompt?: string;
}

export interface MnemotauRuntimeOptions {
	embeddings?: false | MnemotauEmbeddingRuntimeOptions;
	llm?: false | MnemotauLlmRuntimeOptions | Model<Api> | MnemotauLlmCompletion;
	/** Verbose diagnostics: escalates best-effort failure logs from debug to warn. */
	debug?: boolean;
}

<<<<<<< ours — interface `ResolvedMnemopiEmbeddingRuntimeOptions` (S+F, confidence: low)
// refused_by: rename_vs_edit_guard · collision: none (1 contested hunk(s), neither side deleted the other's lines)
export interface ResolvedMnemotauEmbeddingRuntimeOptions {
	disabled?: boolean;
	model?: string;
	apiUrl?: string;
	apiKey?: ApiKey;
	provider?: MnemotauEmbeddingProvider;
	maxInputChars?: number;
=======
export interface ResolvedMnemopiEmbeddingRuntimeOptions {
	disabled?: boolean;
	model?: string;
	apiUrl?: string;
	apiKey?: ApiKey;
	provider?: MnemopiEmbeddingProvider;
	maxInputChars?: number;
	batchSize?: number;
>>>>>>> theirs — interface `ResolvedMnemopiEmbeddingRuntimeOptions` (S+F, confidence: low)
}

<<<<<<< ours — interface `ResolvedMnemopiLlmRuntimeOptions` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: none (both sides edited, nowhere the same lines)
export interface ResolvedMnemotauLlmRuntimeOptions {
	enabled?: boolean;
	baseUrl?: string;
	apiKey?: ApiKey;
	model?: string | Model<Api>;
	maxTokens?: number;
	complete?: MnemotauLlmCompletion;
=======
export interface ResolvedMnemopiLlmRuntimeOptions {
	enabled?: boolean;
	baseUrl?: string;
	apiKey?: ApiKey;
	model?: string | Model<Api>;
	maxTokens?: number;
	complete?: MnemopiLlmCompletion;
>>>>>>> theirs — interface `ResolvedMnemopiLlmRuntimeOptions` (S+F, confidence: low)
	extractionPrompt?: string;
	consolidationPrompt?: string;
}

export interface ResolvedMnemotauRuntimeOptions {
	embeddings?: ResolvedMnemotauEmbeddingRuntimeOptions;
	llm?: ResolvedMnemotauLlmRuntimeOptions;
	debug?: boolean;
}

const runtimeOptionsStorage = new AsyncLocalStorage<ResolvedMnemotauRuntimeOptions>();

export function withMnemotauRuntimeOptions<T>(options: ResolvedMnemotauRuntimeOptions | undefined, fn: () => T): T {
	if (options === undefined) {
		return fn();
	}
	return runtimeOptionsStorage.run(options, fn);
}

export function getMnemotauRuntimeOptions(): ResolvedMnemotauRuntimeOptions | undefined {
	return runtimeOptionsStorage.getStore();
}

/** Whether the active runtime scope requested verbose diagnostics (`mnemotau.debug`). */
export function mnemotauDebugEnabled(): boolean {
	return runtimeOptionsStorage.getStore()?.debug === true;
}

export function resolveEmbeddingProvider(
	provider:
		| MnemotauEmbeddingProvider
		| ((texts: readonly string[]) => EmbeddingOutput | Promise<EmbeddingOutput>)
		| undefined,
): MnemotauEmbeddingProvider | undefined {
	if (provider === undefined) {
		return undefined;
	}
	if (typeof provider === "function") {
		return { embed: provider };
	}
	return provider;
}

export function isPiAiModel(value: unknown): value is Model<Api> {
	if (value === null || typeof value !== "object") {
		return false;
	}
	const maybe = value as Partial<Model<Api>>;
	return (
		typeof maybe.id === "string" &&
		typeof maybe.provider === "string" &&
		typeof maybe.baseUrl === "string" &&
		typeof maybe.api === "string"
	);
}
