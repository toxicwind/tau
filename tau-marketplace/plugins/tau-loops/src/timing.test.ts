import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measure, nowUs, probePort, race, recordWinner, takeTimings } from "./timing.ts";

/**
 * Ordering without a clock. Resolving after N microtask ticks is real ordering
 * — `race` awaits whatever settles first — but costs no wall time and cannot
 * flake under load the way a `sleep(30)` does.
 */
function afterTicks<T>(ticks: number, value: T): Promise<T> {
	let promise: Promise<T> = Promise.resolve(value);
	for (let i = 0; i < ticks; i++) promise = promise.then(() => value);
	return promise;
}

describe("race", () => {
	// The whole point of racing: a strategy that returns an invalid result must
	// not win, even when it settles first. Taking it would make the race a coin
	// flip on which failure came back first.
	test("an early invalid result does not win over a later valid one", async () => {
		const result = await race<string>(
			"test/invalid",
			[
				{ name: "fast-but-empty", run: () => afterTicks(1, ""), valid: (v) => v.length > 0 },
				{ name: "slow-but-real", run: () => afterTicks(50, "real") },
			],
			{ timeoutUs: 2_000_000 },
		);
		expect(result.winner).toBe("slow-but-real");
		expect(result.value).toBe("real");
	});

	test("the first valid strategy to settle wins", async () => {
		const result = await race<number>(
			"test/fastest",
			[
				{ name: "slow", run: () => afterTicks(80, 1) },
				{ name: "fast", run: () => afterTicks(2, 2) },
			],
			{ timeoutUs: 2_000_000 },
		);
		expect(result.winner).toBe("fast");
		expect(result.value).toBe(2);
	});

	test("every strategy failing throws rather than returning a lie", async () => {
		expect(
			race("test/all-bad", [{ name: "a", run: () => afterTicks(1, "x"), valid: () => false }], {
				timeoutUs: 1_000_000,
			}),
		).rejects.toThrow(/test\/all-bad/);
	});

	test("a strategy that throws is a loser, not a crash", async () => {
		const result = await race<string>(
			"test/throws",
			[
				{
					name: "explodes",
					run: () => {
						throw new Error("boom");
					},
				},
				{ name: "works", run: () => afterTicks(20, "ok") },
			],
			{ timeoutUs: 2_000_000 },
		);
		expect(result.winner).toBe("works");
		expect(result.attempts).toBe(2);
	});
});

describe("measure", () => {
	test("records a timing with a real duration", () => {
		const before = takeTimings().length;
		const value = measure("test/sync", () => 41 + 1);
		expect(value).toBe(42);
		const recorded = takeTimings();
		expect(recorded.length).toBe(before + 1);
		const entry = recorded.at(-1);
		expect(entry?.name).toBe("test/sync");
		expect(entry?.ok).toBe(true);
		expect(entry?.durationUs).toBeGreaterThanOrEqual(0);
	});

	// A slow failure is data. If the throw skips the record, the one case worth
	// investigating is the one that leaves no trace.
	test("records the timing even when the step throws", () => {
		const before = takeTimings().length;
		expect(() =>
			measure("test/throws", () => {
				throw new Error("nope");
			}),
		).toThrow("nope");
		const recorded = takeTimings();
		expect(recorded.length).toBe(before + 1);
		expect(recorded.at(-1)?.ok).toBe(false);
	});
});

describe("winners log", () => {
	test("a recorded win round-trips through the log", () => {
		// A temp path, not the default: appending to the real
		// ~/.cache/fleet-bus log would make this assertion pass for the wrong
		// reason and pollute the file the next run reads.
		const path = join(mkdtempSync(join(tmpdir(), "tau-loops-win-")), "winners.jsonl");
		recordWinner(
			{
				ts: new Date().toISOString(),
				tag: "model/provider",
				winner: "openrouter",
				latencyMs: 12,
				losers: [],
			},
			path,
		);
		const written = JSON.parse(readFileSync(path, "utf8").trim()) as { winner: string };
		expect(written.winner).toBe("openrouter");
	});
});

describe("probePort", () => {
	test("reports a listening port as up", async () => {
		const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
		const port = server.port;
		if (port === undefined) throw new Error("test server did not bind a port");
		try {
			expect(await probePort(port)).toBeNull();
		} finally {
			server.stop(true);
		}
	});

	test("reports a closed port as down", async () => {
		const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
		const port = server.port;
		if (port === undefined) throw new Error("test server did not bind a port");
		server.stop(true);
		expect(await probePort(port)).toContain(`127.0.0.1:${port}`);
	});

	// Deliberately real time: this is the only test that can catch a deadline
	// being accepted and ignored, and that failure is a real TCP connect
	// against the platform's own kernel retry window. Fake timers cannot
	// intercept a socket, so a guessed sleep is the only honest option here.
	test("returns within its own timeout for a blackholed address", async () => {
		const started = nowUs();
		// RFC 5737 TEST-NET-1: packets are blackholed, so a connect that ignored
		// the deadline would sit here for the kernel's own retry window.
		const reason = await probePort(9, "192.0.2.1", 400);
		expect(reason).not.toBeNull();
		expect((nowUs() - started) / 1000).toBeLessThan(3000);
	});
});
