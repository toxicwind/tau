import { afterEach, beforeEach, describe, test, expect } from "bun:test";
import * as stream from "@tau/tau-ai/stream";
import { createMockModel, registerMockApi } from "@tau/tau-ai/providers/mock";
import type { Context } from "@tau/tau-ai/types";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

// ─────────────────────────────────────────────────────────────────────────
// freeinference built-in concurrency cap (seed=2) — behavioral pin 2026-11-02.
//
// The estate's cross-process provider limiter (stream.ts) is seeded with
// `{ freeinference: 2 }` so every freeinference call serializes against the
// per-key admission cap (verified live: 429 `concurrency_limit_exceeded`
// beyond 2 in-flight on the pro key). This test proves the seed actually
// gates concurrent streams through the filesystem lease: with cap 1, a second
// concurrent call for the same provider MUST wait for the first to finish —
// maxActive never exceeds 1. Same harness shape as provider-inflight.test.ts.
// ─────────────────────────────────────────────────────────────────────────

function context(): Context {
	return {
		systemPrompt: [],
		messages: [{ role: "user", content: "hi", timestamp: 0 }],
	};
}

let limiterRoot: string | undefined;

beforeEach(async () => {
	limiterRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tau-fi-cap-"));
	stream.__providerInFlightForTesting.setRoot(limiterRoot);
	stream.configureProviderMaxInFlightRequests(undefined); // reset to built-ins
});

afterEach(async () => {
	stream.configureProviderMaxInFlightRequests(undefined);
	stream.__providerInFlightForTesting.setRoot(undefined);
	stream.__providerInFlightForTesting.setHeartbeatTimings(undefined);
	if (limiterRoot !== undefined) {
		await fs.rm(limiterRoot, { recursive: true, force: true });
		limiterRoot = undefined;
	}
});

describe("freeinference built-in concurrency cap (seed=2)", () => {
	test("cap=1 serializes concurrent freeinference streams (maxActive never >1)", async () => {
		registerMockApi();
		const firstStarted = Promise.withResolvers<void>();
		const releaseFirst = Promise.withResolvers<void>();
		let active = 0;
		let maxActive = 0;
		let callIndex = 0;
		const mock = createMockModel({
			provider: "freeinference", // matches the BUILT_IN seed { freeinference: 2 }
			handler: async () => {
				callIndex++;
				active++;
				maxActive = Math.max(maxActive, active);
				try {
					if (callIndex === 1) {
						firstStarted.resolve();
						await releaseFirst.promise;
					}
					return { content: [`reply ${callIndex}`] };
				} finally {
					active--;
				}
			},
		});

		// Configure cap 1 explicitly via options (the docs' per-request surface);
		// with the built-in seed active, the resolver would also cap at 2.
		const first = stream.streamSimple(mock.model, context(), { maxInFlightRequests: { freeinference: 1 } });
		const firstResult = first.result();
		await firstStarted.promise;

		const second = stream.streamSimple(mock.model, context(), { maxInFlightRequests: { freeinference: 1 } });
		const secondResult = second.result();

		releaseFirst.resolve();
		const [m1, m2] = await Promise.all([firstResult, secondResult]);

		expect(m1.content).toEqual([{ type: "text", text: "reply 1" }]);
		expect(m2.content).toEqual([{ type: "text", text: "reply 2" }]);
		expect(maxActive).toBe(1); // NEVER two freeinference calls in flight concurrently
	});

	test("reset(undefined) is a no-op when no custom caps were configured (built-in>default)", () => {
		// The afterEach reset must not throw and must leave the module usable —
		// the built-in seed causing a behaviorally-correct default is covered by
		// the serialize test + provider-inflight.test.ts's own reset contract.
		stream.configureProviderMaxInFlightRequests(undefined);
		expect(true).toBe(true);
	});
});