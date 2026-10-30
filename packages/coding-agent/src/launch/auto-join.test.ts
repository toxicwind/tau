import { afterEach, describe, expect, mock, test } from "bun:test";

const brokerRequests: Array<Record<string, unknown>> = [];
const squawkCalls: Array<Record<string, unknown>> = [];

mock.module("./client", () => {
	return {
		daemonClientForProject: () => ({
			request: (req: Record<string, unknown>) => {
				brokerRequests.push(req);
				return Promise.resolve({});
			},
		}),
	};
});
mock.module("./fleet-card", () => {
	return {
		buildAgentCard: (card: Record<string, unknown>) => card,
		joinSquawkFleet: async (card: Record<string, unknown>) => {
			squawkCalls.push(card);
		},
		startPresenceHeartbeat: () => () => {},
	};
});

const { registerInteractiveTauSession } = await import("./auto-join");

const CHILD_ENV = "TAU_DAEMON_CHILD";

describe("registerInteractiveTauSession fork-storm guard", () => {
	afterEach(() => {
		delete process.env[CHILD_ENV];
		brokerRequests.length = 0;
		squawkCalls.length = 0;
	});

	test("broker-spawned child (TAU_DAEMON_CHILD set) registers nothing", async () => {
		process.env[CHILD_ENV] = "1";
		const result = await registerInteractiveTauSession();
		// The guard MUST run before any side effect: no broker op, no squawk join.
		expect(result).toBeNull();
		expect(brokerRequests).toHaveLength(0);
		expect(squawkCalls).toHaveLength(0);
	});

	test("interactive parent still registers exactly one daemon spec", async () => {
		const result = await registerInteractiveTauSession();
		expect(result).not.toBeNull();
		expect(brokerRequests).toHaveLength(1);
		// The spec must carry the guard marker so the spawned child cannot
		// re-register: without it each generation picks a fresh tau-${pid}
		// name and the broker duplicate check never trips (unbounded
		// tau-spawns-tau recursion, ~90 procs/min on 2026-10-30).
		const start = brokerRequests[0] as { op?: string; spec?: { env?: Record<string, string> } };
		expect(start.op).toBe("start");
		expect(start.spec?.env?.[CHILD_ENV]).toBe("1");
	});

	test("registration spec uses restart-capable managed daemon shape", async () => {
		await registerInteractiveTauSession();
		const start = brokerRequests[0] as {
			spec?: { application?: string; args?: unknown[]; pty?: boolean; restart?: string };
		};
		expect(typeof start.spec?.application).toBe("string");
		expect(Array.isArray(start.spec?.args)).toBe(true);
		expect(start.spec?.pty).toBe(true);
		expect(start.spec?.restart).toBe("always");
	});
});
