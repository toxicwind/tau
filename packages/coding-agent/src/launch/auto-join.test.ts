import { afterEach, describe, expect, mock, test } from "bun:test";

const brokerRequests: Array<Record<string, unknown>> = [];
const squawkCalls: Array<Record<string, unknown>> = [];

// The broker client module must never be reached by an interactive session:
// auto-join registers PRESENCE only. The mock records any attempt so the test
// can assert the fork-storm machine stays dead.
mock.module("./client", () => ({
	daemonClientForProject: () => ({
		request: (req: Record<string, unknown>) => {
			brokerRequests.push(req);
			return Promise.resolve({});
		},
	}),
}));
mock.module("./fleet-card", () => ({
	buildAgentCard: (card: Record<string, unknown>) => card,
	joinSquawkFleet: async (card: Record<string, unknown>) => {
		squawkCalls.push(card);
	},
	startPresenceHeartbeat: () => () => {},
}));

const { registerInteractiveTauSession } = await import("./auto-join");

/**
 * The interactive TUI is a UI, not a daemon (2026-10-31 incident): it joins
 * the squawk fleet for presence and NEVER mints a broker daemon spec — the
 * old `restart: "always"` PTY spec respawned full TUI copies whose leaked
 * bunfs self-path became a user prompt (ghost agentic turns, fork storm).
 */
describe("registerInteractiveTauSession", () => {
	afterEach(() => {
		brokerRequests.length = 0;
		squawkCalls.length = 0;
	});

	test("joins the squawk fleet exactly once with a presence card", async () => {
		const result = await registerInteractiveTauSession();
		expect(result).not.toBeNull();
		expect(squawkCalls).toHaveLength(1);
		expect(squawkCalls[0]?.name).toBe(`tau-${process.pid}`);
		expect(squawkCalls[0]?.species).toBe("tau");
	});

	test("never registers a broker daemon — no start/adopt ops, no child env marker", async () => {
		await registerInteractiveTauSession();
		expect(brokerRequests).toHaveLength(0);
	});
});
