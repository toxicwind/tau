import { describe, it, expect, afterEach, vi } from "bun:test";
import { resolveConfigValue } from "../../src/config/resolve-config-value.ts";
import * as cp from "node:child_process";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("resolveConfigValue kryptos fallback", () => {
	it("env-backed value wins over keyring", async () => {
		const old = process.env.FLUX_TEST_KEY;
		process.env.FLUX_TEST_KEY = "env-value";
		try {
			expect(await resolveConfigValue("FLUX_TEST_KEY")).toBe("env-value");
		} finally {
			if (old === undefined) delete process.env.FLUX_TEST_KEY;
			else process.env.FLUX_TEST_KEY = old;
		}
	});

	it("env-var-shaped value with unset env falls back to kryptos keyring", async () => {
		delete process.env.FLUX_TEST_KEY;
		const execFile = vi
			.spyOn(cp, "execFile")
			.mockImplementation(((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
				cb(null, JSON.stringify({ label: "FLUX_TEST_KEY", secret: "keyring-secret" }));
			}) as typeof cp.execFile);
		expect(await resolveConfigValue("FLUX_TEST_KEY")).toBe("keyring-secret");
		expect(execFile).toHaveBeenCalledWith(
			"kryptos",
			["--json", "get", "FLUX_TEST_KEY", "--no-fuzzy"],
			expect.objectContaining({ timeout: 8000 }),
			expect.any(Function),
		);
	});

	it("env-var-shaped value with unset env and keyring miss returns undefined, never the literal name", async () => {
		delete process.env.FLUX_TEST_KEY;
		vi.spyOn(cp, "execFile").mockImplementation(((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
			cb(new Error("not found"), "");
		}) as typeof cp.execFile);
		expect(await resolveConfigValue("FLUX_TEST_KEY")).toBeUndefined();
	});

	it("non-env-var literal passes through unchanged", async () => {
		expect(await resolveConfigValue("some-literal-value")).toBe("some-literal-value");
		expect(await resolveConfigValue("eyJhbGciOiJub25lIn0")).toBe("eyJhbGciOiJub25lIn0");
	});
});