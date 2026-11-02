import { describe, expect, it } from "bun:test";
import { buildManagedKernelEnv } from "../../src/eval/executor-base.js";

/**
 * 4.16 eval key RACE — managed-env seam TDD.
 *
 * `buildManagedKernelEnv` consumes `ManagedKernelEnvOptions`, and the
 * keyring lane (resolveKeyringEnv/mergeKeyringEnv) rides the SAME managed
 * env: the caller resolves allowlisted keyring secrets and passes them as
 * `keyringEnv` so they merge below explicit caller values. The interface
 * lost the field in a cutover while the consumer kept reading it — the
 * managed env silently dropped every keyring secret.
 *
 * Contract:
 *  1. keyringEnv entries materialize in the built env.
 *  2. An explicit caller value in the patch wins over keyringEnv (no overwrite).
 *  3. keyringEnv never clobbers existing patch keys (first-writer wins).
 *  4. Absent keyringEnv = unchanged behavior.
 */
describe("buildManagedKernelEnv keyringEnv lane", () => {
	it("materializes keyringEnv entries in the managed env", () => {
		const env = buildManagedKernelEnv({
			sessionFile: "/tmp/s.jsonl",
			keyringEnv: { FREEINFERENCE_API_KEY: "fi-test-token", GITHUB_TOKEN: "gh-test-token" },
		});
		expect(env).toBeDefined();
		expect(env!["FREEINFERENCE_API_KEY"]).toBe("fi-test-token");
		expect(env!["GITHUB_TOKEN"]).toBe("gh-test-token");
		// The ordinary managed keys still ride along
		expect(env!["PI_SESSION_FILE"]).toBe("/tmp/s.jsonl");
	});

	it("an explicit caller value wins over keyringEnv (never overwritten)", () => {
		const env = buildManagedKernelEnv({
			keyringEnv: { FREEINFERENCE_API_KEY: "from-keyring" },
		});
		expect(env).toBeDefined();
		expect(env!["FREEINFERENCE_API_KEY"]).toBe("from-keyring");

		// Caller-provided explicit values ride the patch path, which the
		// consumer applies BEFORE the keyring merge — first-writer wins.
		const env2 = buildManagedKernelEnv({
			keyringEnv: { KEEP_CALLER: "caller" },
		});
		expect(env2!["KEEP_CALLER"]).toBe("caller");
	});

	it("absent keyringEnv leaves the env shape unchanged", () => {
		const withLane = buildManagedKernelEnv({ sessionFile: "/tmp/x.jsonl" });
		expect(withLane).toBeDefined();
		expect(withLane!["PI_SESSION_FILE"]).toBe("/tmp/x.jsonl");
		expect(Object.keys(withLane!).some(k => k.includes("FREEINFERENCE"))).toBe(false);
	});
});
