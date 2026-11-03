/**
 * Concurrency-429 "never fail / never downgrade" contract (2026-11-02).
 *
 * Regression: freeinference `limit: 2` concurrency 429s
 * (`{"error":{"type":"concurrency_limit_exceeded","message":"Too many
 * concurrent requests (limit: 2)"}}` with `retry-after-ms=1000`) were
 * surfaced immediately to session recovery, which downgraded the active
 * model (deepseek-v4-flash:high → glm-5.3-flash at 600K context). A slot
 * lock is transient — postOpenAIStream must hold and retry the SAME request
 * (honouring the inline retry hint + jitter) instead of throwing to the
 * fallback router.
 */
import { describe, expect, test } from "bun:test";
import { postOpenAIStream } from "../src/utils/openai-http";

function concurrency429Body(retryAfterMs = 1000): string {
	return JSON.stringify({
		error: {
			type: "concurrency_limit_exceeded",
			message: `Too many concurrent requests (limit: 2) retry-after-ms=${retryAfterMs}`,
		},
	});
}

function sseChunks(payloads: unknown[]): Uint8Array {
	const encoder = new TextEncoder();
	return encoder.encode(payloads.map(p => `data: ${JSON.stringify(p)}\n\n`).join("") + "data: [DONE]\n\n");
}

describe("postOpenAIStream concurrency hold-retry", () => {
	test("hold-retries concurrency_limit_exceeded then succeeds — never surfaces the 429", async () => {
		let calls = 0;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(sseChunks([{ ok: "real-event" }]));
				controller.close();
			},
		});
		const fetchImpl = async (): Promise<Response> => {
			calls++;
			if (calls <= 3) {
				return new Response(concurrency429Body(), {
					status: 429,
					headers: { "content-type": "application/json" },
				});
			}
			return new Response(stream, { status: 200 });
		};

		const handle = await postOpenAIStream({
			url: "http://test/v1/chat/completions",
			headers: {},
			body: { model: "deepseek-v4-flash:high", messages: [] },
			signal: new AbortController().signal,
			fetch: fetchImpl,
		});
		expect(handle.response.status).toBe(200);
		expect(calls).toBe(4); // 3 concurrency holds + the successful retry

		const events: unknown[] = [];
		for await (const frame of handle.events) {
			events.push(frame);
		}
		expect(events).toEqual([{ ok: "real-event" }]);
	});

	test("gives up after the hold budget and surfaces the 429 (does not loop forever)", async () => {
		let calls = 0;
		const fetchImpl = async (): Promise<Response> => {
			calls++;
			return new Response(concurrency429Body(10), {
				status: 429,
				headers: { "content-type": "application/json" },
			});
		};
		// retry-after-ms=10 keeps each hold ~10ms + jitter; 30 attempts is bounded.
		const startedAt = Date.now();
		await expect(
			postOpenAIStream({
				url: "http://test/v1/chat/completions",
				headers: {},
				body: { model: "deepseek-v4-flash:high", messages: [] },
				signal: new AbortController().signal,
				fetch: fetchImpl,
			}),
		).rejects.toThrow(/429/);
		expect(calls).toBe(30); // CONCURRENCY_HOLD_MAX_ATTEMPTS
		expect(Date.now() - startedAt).toBeLessThan(20_000); // tiny hints (~110-360ms × 30) keep it fast
	}, 30_000);

	test("unrelated 429 (no concurrency marker) still throws immediately — quota path unchanged", async () => {
		const fetchImpl = async (): Promise<Response> =>
			new Response(JSON.stringify({ error: { type: "rate_limit_exceeded", message: "quota" } }), {
				status: 429,
				headers: { "content-type": "application/json", "retry-after": "0" },
			});
		await expect(
			postOpenAIStream({
				url: "http://test/v1/chat/completions",
				headers: {},
				body: { model: "x", messages: [] },
				signal: new AbortController().signal,
				fetch: fetchImpl,
			}),
		).rejects.toThrow(/429/);
	}, 30_000);
});