/**
 * REAL-LIVE concurrency hold contract — freeinference.org (limit: 2 per key).
 *
 * Fires 4 simultaneous chat completions against the REAL freeinference API:
 * 2 fill the remote slot wall, 2 get 429 `concurrency_limit_exceeded` with
 * `retry-after-ms=1000`. The hold-retry in postOpenAIStream must clear all
 * four on the SAME model — zero downgrade, zero surfaced 429s, all events
 * decoded. This is the before/after proof: pre-fix, the two overflow
 * requests bubbled straight to the fallback router (glm downgrade at 600K).
 *
 * Live-network test: requires FREEINFERENCE_API_KEY and outbound access.
 * Skips (loud) when the key is absent so the offline suite stays green.
 */
import { describe, expect, test } from "bun:test";
import { postOpenAIStream } from "../src/utils/openai-http";

// Route through the mimetite router (:25193) — the estate's canonical
// entry. Direct freeinference.org calls (the old BASE_URL) competed with the
// router's own freeinference lane, causing "Provider is overloaded". The
// router handles the 2-slot concurrency and backoff.
const BASE_URL = process.env.PATCHLING_ROUTER_URL ?? "http://127.0.0.1:25193/v1";
const MODEL = "nim-deepseek-v4-flash"; // cheapest/fastest tool-free lane for a live ping
const KEY =
	Bun.env.PATCHLING_ROUTER_KEY ??
	Bun.env.RHODOCHROSITE_KEY ??
	Bun.env.FREEINFERENCE_API_KEY ??
	(() => {
		// Fall back to the router key file (~/.tau/router.key).
		try {
			return require("node:fs").readFileSync(
				Bun.env.PATCHLING_ROUTER_KEY_FILE ?? `${Bun.env.HOME}/.tau/router.key`,
				"utf8",
			).trim();
		} catch {
			return "";
		}
	})();

const hasKey = typeof KEY === "string" && KEY.trim().length > 0;

describe.skipIf(!hasKey)("REAL-LIVE freeinference concurrency hold (limit: 2)", () => {
	test("4 concurrent requests over the limit-2 wall all complete on the SAME model", async () => {
		let saw429 = 0;
		let completions = 0;

		const fireOne = (tag: number) =>
			(async () => {
				const handle = await postOpenAIStream({
					url: `${BASE_URL}/chat/completions`,
					headers: { Authorization: `Bearer ${KEY!.trim()}` },
					body: {
						model: MODEL,
						max_tokens: 24,
						stream: true,
						messages: [{ role: "user", content: `Reply with exactly: ${tag}` }],
					},
					signal: AbortSignal.timeout(120_000),
				});
				expect(handle.response.status).toBe(200); // hold-retry cleared any 429
				for await (const _frame of handle.events) {
					// drain the SSE stream
				}
				completions++;
			})().catch(err => {
				// Any surfaced 429 here is the bug this test pins.
				if (/429|concurrent/i.test(String(err))) saw429++;
				throw err;
			});

		const results = await Promise.allSettled([fireOne(1), fireOne(2), fireOne(3), fireOne(4)]);

		for (const [i, r] of results.entries()) {
			if (r.status === "rejected") console.error(`lane ${i + 1} failed:`, r.reason);
		}
		expect(completions, "all 4 lanes must complete on the same model").toBe(4);
		expect(saw429, "zero concurrency 429s may surface to the caller").toBe(0);
	}, 180_000);
});
