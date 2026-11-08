import { describe, expect, it } from "bun:test";
import { startCpuProfile, collectMemoryStats } from "tau/debug/profiler";

describe("startCpuProfile", () => {
	// Regression: `node:v8` `setFlagsFromString` throws on Bun
	// (oven-sh/bun#1702). The profiler used to call it unconditionally and
	// crash before connecting the inspector session. Running this test under
	// Bun guarantees the guard is in place — without it the call below would
	// reject with "node:v8 setFlagsFromString is not yet implemented in Bun".
	it("starts and stops successfully even when v8.setFlagsFromString is unavailable", async () => {
		const session = await startCpuProfile();
		// Run a tiny bit of work so the profile has at least one sample.
		let acc = 0;
		for (let i = 0; i < 10_000; i++) acc += i;
		expect(acc).toBeGreaterThan(0);

		const profile = await session.stop();
		const parsed = JSON.parse(profile.data) as { nodes: unknown[] };
		expect(Array.isArray(parsed.nodes)).toBe(true);
		expect(parsed.nodes.length).toBeGreaterThan(0);
		expect(typeof profile.markdown).toBe("string");
		expect(profile.markdown.length).toBeGreaterThan(0);
});

describe("collectMemoryStats", () => {
	// F10 (2026-11-08): the 2026-11-08 tau report shipped a self-inconsistent
	// memory.json — process.heapTotal (113,614,848) BELOW process.heapUsed
	// (141,500,625) — because process.memoryUsage().heapTotal is a lagging
	// committed figure under JSC. The report must never serialize heapTotal;
	// the leak signal is heap.heapSize vs heap.heapCapacity (one consistent
	// JSC introspection). Contract: serialized memory.json carries rss,
	// heapUsed, external, arrayBuffers + the JSC heap block, and NO heapTotal.
	it("never serializes the lagging process.heapTotal; heapSize/heapCapacity stay self-consistent", () => {
		const stats = collectMemoryStats() as {
			process: Record<string, number>;
			heap: { heapSize: number; heapCapacity: number };
		};
		expect("heapTotal" in stats.process).toBe(false);
		expect(typeof stats.process.rss).toBe("number");
		expect(typeof stats.process.heapUsed).toBe("number");
		// The consistent pair: used heap must fit inside capacity.
		expect(stats.heap.heapSize).toBeLessThanOrEqual(stats.heap.heapCapacity);
		expect(stats.heap.heapSize).toBeGreaterThan(0);
	});
});
});
