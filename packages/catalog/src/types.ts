import type { Effort } from "./effort";

// Re-exported from @oh-my-pi/pi-utils so the whole workspace shares one
// `fetch`-compatible signature (tls-fetch's wrappers produce/accept it).
export type { FetchImpl } from "@oh-my-pi/pi-utils";
export type { KnownProvider } from "./provider-models/descriptors";

export type KnownApi =
	| "openai-completions"
	| "openai-responses"
	| "openrouter"
	| "openai-codex-responses"
	| "azure-openai-responses"
	| "anthropic-messages"
	| "bedrock-converse-stream"
	| "google-generative-ai"
	| "google-gemini-cli"
	| "google-vertex"
	| "ollama-chat"
	| "cursor-agent"
	| "gitlab-duo-agent"
	| "devin-agent";
export type Api = KnownApi | (string & {});
