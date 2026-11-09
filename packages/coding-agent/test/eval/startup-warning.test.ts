import { describe, expect, test } from "bun:test";
import { resolvePythonEvalWarning, resolveFirstLaunchPythonEvalWarning } from "../../src/eval/startup-warning";

/**
 * Ported from oh-my-pi `eval/startup-warning.ts` (8d1dfcd5ab lineage).
 * Tau contract: warn ONCE on a broken enabled Python kernel so the failure
 * surfaces at startup instead of at first eval dispatch.
 */

describe("eval startup-warning", () => {
	test("resolvePythonEvalWarning returns undefined when eval.py disabled", async () => {
		const warning = await resolvePythonEvalWarning({
			cwd: "/tmp",
			isEnabled: () => false,
			interpreter: undefined,
			signal: undefined,
		});
		expect(warning).toBeUndefined();
	});

	test("resolvePythonEvalWarning returns undefined when kernel is available", async () => {
		const warning = await resolvePythonEvalWarning({
			cwd: "/tmp",
			isEnabled: () => true,
			interpreter: undefined,
			signal: undefined,
			// Availability probe stubbed to ok
			checkAvailability: async () => ({ ok: true }),
		});
		expect(warning).toBeUndefined();
	});

	test("resolvePythonEvalWarning names JS-only fallback when eval.js enabled", async () => {
		const warning = await resolvePythonEvalWarning({
			cwd: "/tmp",
			isEnabled: () => true,
			interpreter: undefined,
			signal: undefined,
			checkAvailability: async () => ({ ok: false, reason: "no python3 on PATH" }),
			jsEnabled: true,
		});
		expect(warning).toContain("Python eval unavailable");
		expect(warning).toContain("no python3 on PATH");
		expect(warning).toContain("JavaScript only");
	});

	test("resolvePythonEvalWarning names total outage when eval.js disabled", async () => {
		const warning = await resolvePythonEvalWarning({
			cwd: "/tmp",
			isEnabled: () => true,
			interpreter: undefined,
			signal: undefined,
			checkAvailability: async () => ({ ok: false, reason: "missing interpreter" }),
			jsEnabled: false,
		});
		expect(warning).toContain("Eval tool unavailable");
		expect(warning).toContain("missing interpreter");
	});

	test("resolvePythonEvalWarning sanitizes the reason", async () => {
		const warning = await resolvePythonEvalWarning({
			cwd: "/tmp",
			isEnabled: () => true,
			interpreter: undefined,
			signal: undefined,
			checkAvailability: async () => ({ ok: false, reason: "/home/toxic/very/deep/path/x\nbad\tchar" }),
			jsEnabled: true,
		});
		expect(warning).toBeDefined();
		// sanitized: home shortened, control chars stripped
		expect(warning).not.toContain("/home/toxic/very/deep");
	});

	test("resolvePythonEvalWarning respects abort", async () => {
		const controller = new AbortController();
		controller.abort();
		const warning = await resolvePythonEvalWarning({
			cwd: "/tmp",
			isEnabled: () => true,
			interpreter: undefined,
			signal: controller.signal,
			checkAvailability: async () => ({ ok: false, reason: "would warn" }),
		});
		expect(warning).toBeUndefined();
	});

	test("first-launch: undefined when lastChangelogVersion already set (not fresh)", async () => {
		const warning = await resolveFirstLaunchPythonEvalWarning({
			lastChangelogVersion: "1.2.3",
			args: {},
			cwd: "/tmp",
			isEnabled: () => true,
			checkAvailability: async () => ({ ok: false, reason: "broken" }),
		});
		expect(warning).toBeUndefined();
	});

	test("first-launch: undefined for resume/continue/fromClaude/fromCodex launches", async () => {
		for (const flag of ["continue", "resume", "fromClaude", "fromCodex"] as const) {
			const warning = await resolveFirstLaunchPythonEvalWarning({
				lastChangelogVersion: undefined,
				args: { [flag]: true },
				cwd: "/tmp",
				isEnabled: () => true,
				checkAvailability: async () => ({ ok: false, reason: "broken" }),
			});
			expect(warning).toBeUndefined();
		}
	});

	test("first-launch: undefined when eval tool not exposed (--no-tools / --tools)", async () => {
		const noTools = await resolveFirstLaunchPythonEvalWarning({
			lastChangelogVersion: undefined,
			args: { noTools: true },
			cwd: "/tmp",
			isEnabled: () => true,
			checkAvailability: async () => ({ ok: false, reason: "broken" }),
		});
		expect(noTools).toBeUndefined();

		const toolsWithoutEval = await resolveFirstLaunchPythonEvalWarning({
			lastChangelogVersion: undefined,
			args: { tools: ["bash", "read"] },
			cwd: "/tmp",
			isEnabled: () => true,
			checkAvailability: async () => ({ ok: false, reason: "broken" }),
		});
		expect(toolsWithoutEval).toBeUndefined();
	});

	test("first-launch: warns on a genuinely fresh launch with eval exposed", async () => {
		const warning = await resolveFirstLaunchPythonEvalWarning({
			lastChangelogVersion: undefined,
			args: {},
			cwd: "/tmp",
			isEnabled: () => true,
			checkAvailability: async () => ({ ok: false, reason: "broken kernel" }),
			jsEnabled: true,
		});
		expect(warning).toContain("broken kernel");
	});
});
