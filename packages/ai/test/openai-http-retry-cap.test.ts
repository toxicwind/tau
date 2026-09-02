/**
 * Proves `postOpenAIStream` forwards `maxRetryDelayMs` from
 * `OpenAIStreamRequestInit` into `fetchWithRetry`'s `maxDelayMs` cap so
 * free-tier gateways (opencode-zen, opencode-go) that ask for
 * `retry-after-ms=21431000` can have the cap lifted per provider without
 * losing the cap's existence for everyone else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fetchRetry from "@oh-my-pi/pi-utils/fetch-retry";
import { postOpenAIStream } from "@oh-my-pi/pi-ai/utils/openai-http";

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
	// `postOpenAIStream` uses global fetch (with the explicit `fetch` opt-out
	// reserved for callers); we replace it with a deterministic 200 OK so the
	// call returns cleanly without a real network.
	globalThis.fetch = (() => Promise.resolve(new Response("ok", { status: 200 }))) as unknown as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	vi.restoreAllMocks();
});

describe("postOpenAIStream retry-after-ms cap", () => {
	it("passes maxRetryDelayMs through to fetchWithRetry.maxDelayMs", async () => {
		const spy = vi.spyOn(fetchRetry, "fetchWithRetry");
		const handle = await postOpenAIStream({
			url: "https://example.invalid/v1/chat/completions",
			headers: {},
			body: { model: "x", messages: [] },
			signal: new AbortController().signal,
			maxRetryDelayMs: 42_000,
		});
		// Drain so the stream doesn't hold the test open.
		for await (const _ of handle.events) {
			/* noop */
		}
		expect(spy).toHaveBeenCalledTimes(1);
		const opts = spy.mock.calls[0]?.[1];
		if (!opts) throw new Error("fetchWithRetry not called");
		expect((opts as { maxDelayMs?: number }).maxDelayMs).toBe(42_000);
	});

	it("omits maxDelayMs when caller leaves it unset (fetchWithRetry default 60s applies)", async () => {
		const spy = vi.spyOn(fetchRetry, "fetchWithRetry");
		const handle = await postOpenAIStream({
			url: "https://example.invalid/v1/chat/completions",
			headers: {},
			body: { model: "x", messages: [] },
			signal: new AbortController().signal,
		});
		for await (const _ of handle.events) {
			/* noop */
		}
		expect(spy).toHaveBeenCalledTimes(1);
		const opts = spy.mock.calls[0]?.[1];
		if (!opts) throw new Error("fetchWithRetry not called");
		// Undefined ⇒ fetchWithRetry falls back to its own 60_000 default.
		expect((opts as { maxDelayMs?: number }).maxDelayMs).toBeUndefined();
	});

	it("0 disables the cap (used for unbounded providers like opencode-zen)", async () => {
		const spy = vi.spyOn(fetchRetry, "fetchWithRetry");
		const handle = await postOpenAIStream({
			url: "https://example.invalid/v1/chat/completions",
			headers: {},
			body: { model: "x", messages: [] },
			signal: new AbortController().signal,
			maxRetryDelayMs: 0,
		});
		for await (const _ of handle.events) {
			/* noop */
		}
		const opts = spy.mock.calls[0]?.[1];
		if (!opts) throw new Error("fetchWithRetry not called");
		expect((opts as { maxDelayMs?: number }).maxDelayMs).toBe(0);
	});
});
