import { afterEach, describe, expect, it, vi } from "bun:test";
import { smokeTestSyncWorker } from "@tau/tau-stats/aggregator";
import { installStatsTestIsolation } from "./helpers/temp-agent";

installStatsTestIsolation("@tau-stats-smoke-darwin-");

afterEach(() => {
	vi.restoreAllMocks();
});

describe("smokeTestSyncWorker", () => {
	it("skips the worker spawn on darwin so tau --smoke-test stays off the macOS abort surface", async () => {
		vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
		const workerSpy = vi.spyOn(globalThis, "Worker").mockImplementation(() => {
			throw new Error("worker should not be created on darwin");
		});

		await expect(smokeTestSyncWorker()).resolves.toBeUndefined();
		expect(workerSpy).not.toHaveBeenCalled();
	});
});
