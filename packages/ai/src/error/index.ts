export * from "./abort";
export * from "./auth";
export * from "./auth-classify";
export * from "./aws";
export * from "./body-error";
export * from "./classes";
export * from "./finalize";
export * from "./flags";
export * from "./format";
export * from "./gateway";
export * from "./oauth";
export * from "./provider";
export * from "./rate-limit";
export * from "./retryable";
export * from "./validation";

export function isCodexSteerRejection(message: { api?: string; errorMessage?: string } | undefined): boolean {
	return Boolean(message?.errorMessage && /steer/i.test(message.errorMessage));
}
export function isImmutableLatestThinkingText(text: string | undefined): boolean {
	return Boolean(text && /immutable|thinking/i.test(text));
}
export function isStreamEnvelopeTruncationText(text: string | undefined): boolean {
	return Boolean(text && /envelope|truncat/i.test(text));
}
