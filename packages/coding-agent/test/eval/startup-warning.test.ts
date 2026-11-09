<<<<<<< ours
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
||||||| base
=======
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import * as pyKernel from "@oh-my-pi/pi-coding-agent/eval/py/kernel";
import {
	resolveFirstLaunchPythonEvalWarning,
	resolvePythonEvalWarning,
} from "@oh-my-pi/pi-coding-agent/eval/startup-warning";

const FIX_HINT = "Install Python 3.8+ or set python.interpreter, then verify with `omp setup python --check`.";
const CWD = "/tmp/eval-startup-warning";

let savedPiPy: string | undefined;
let savedPiJs: string | undefined;

function restoreEnv(name: "PI_PY" | "PI_JS", value: string | undefined): void {
	if (value === undefined) delete Bun.env[name];
	else Bun.env[name] = value;
}

function mockProbe(reason = "Python executable not found on PATH") {
	return vi.spyOn(pyKernel, "checkPythonKernelAvailability").mockResolvedValue({ ok: false, reason });
}

beforeEach(() => {
	savedPiPy = Bun.env.PI_PY;
	savedPiJs = Bun.env.PI_JS;
	delete Bun.env.PI_PY;
	delete Bun.env.PI_JS;
});

afterEach(() => {
	vi.restoreAllMocks();
	restoreEnv("PI_PY", savedPiPy);
	restoreEnv("PI_JS", savedPiJs);
});

describe("resolvePythonEvalWarning", () => {
	it("falls back to JavaScript when Python is missing and JS eval is on", async () => {
		mockProbe();
		expect(await resolvePythonEvalWarning({ cwd: CWD, settings: Settings.isolated() })).toBe(
			`Python eval unavailable (Python executable not found on PATH); eval will run JavaScript only. ${FIX_HINT}`,
		);
	});

	it("reports no eval backend when Python is missing and JS eval is off", async () => {
		mockProbe();
		expect(await resolvePythonEvalWarning({ cwd: CWD, settings: Settings.isolated({ "eval.js": false }) })).toBe(
			`Eval tool unavailable: Python executable not found on PATH, and JavaScript eval is disabled. ${FIX_HINT}`,
		);
	});

	it("stays silent without probing when Python eval is intentionally disabled", async () => {
		const probe = mockProbe();
		expect(
			await resolvePythonEvalWarning({
				cwd: CWD,
				settings: Settings.isolated({ "eval.py": false, "eval.js": false }),
			}),
		).toBeUndefined();
		expect(probe).not.toHaveBeenCalled();
	});

	it("shortens home paths, strips control characters, and bounds the probe reason", async () => {
		const interpreter = path.join(os.homedir(), "py\tenv", "python");
		mockProbe(`Tried: ${interpreter} \x1b[31mspawn failed\x1b[0m ${"x".repeat(400)}`);
		const warning = await resolvePythonEvalWarning({ cwd: CWD, settings: Settings.isolated() });
		const reason = warning?.slice(warning.indexOf("(") + 1, warning.indexOf(")"));
		expect(reason).toStartWith("Tried: ~/py");
		expect(reason).not.toContain(os.homedir());
		expect(reason).not.toMatch(/[\t\x1b]/);
		expect(Bun.stringWidth(reason ?? "")).toBeLessThanOrEqual(100);
		expect(warning).toEndWith(FIX_HINT);
	});
});

describe("resolveFirstLaunchPythonEvalWarning", () => {
	const base = { cwd: CWD, settings: Settings.isolated() };

	it("probes on a fresh install and stays silent once the changelog marker exists", async () => {
		const probe = mockProbe();
		expect(
			await resolveFirstLaunchPythonEvalWarning({ ...base, args: {}, lastChangelogVersion: undefined }),
		).toStartWith("Python eval unavailable");
		expect(
			await resolveFirstLaunchPythonEvalWarning({ ...base, args: {}, lastChangelogVersion: "18.3.5" }),
		).toBeUndefined();
		expect(probe).toHaveBeenCalledTimes(1);
	});

	it("skips resumed launches, which never write the changelog marker", async () => {
		const probe = mockProbe();
		for (const args of [{ continue: true }, { resume: true }, { fromClaude: true }] as const) {
			expect(
				await resolveFirstLaunchPythonEvalWarning({ ...base, args, lastChangelogVersion: undefined }),
			).toBeUndefined();
		}
		expect(probe).not.toHaveBeenCalled();
	});

	it("follows the effective tool list, where an explicit --tools list overrides --no-tools", async () => {
		mockProbe();
		const warn = (args: { tools?: string[]; noTools?: boolean }) =>
			resolveFirstLaunchPythonEvalWarning({ ...base, args, lastChangelogVersion: undefined });
		expect(await warn({ noTools: true, tools: ["eval"] })).toStartWith("Python eval unavailable");
		expect(await warn({ noTools: true })).toBeUndefined();
		expect(await warn({ tools: ["read"] })).toBeUndefined();
	});
});
>>>>>>> theirs · weave: run 'weave explain packages/coding-agent/test/eval/startup-warning.test.ts' for per-hunk detail, 'weave check' to verify your resolution
