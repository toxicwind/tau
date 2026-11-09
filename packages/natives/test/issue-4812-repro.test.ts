/**
 * Repro for https://github.com/toxicwind/tau/issues/4812
 *
<<<<<<< ours — interstitial `file_header` (T, confidence: high)
// refused_by: merge_ladder_exhausted · collision: `* the new sentinel (e.g. `__piNativesV16_3_11`), but `require` …` +1 more
 * A long-lived tau session that survives an in-place `bun install -g` upgrade
 * keeps the previous tau-natives NAPI addon resident in the process. A tab
 * worker spawned afterwards runs the freshly-installed JS loader, which expects
 * the new sentinel (e.g. `__tauNativesV16_3_11`), but `require` returns the
 * resident old exports carrying the PRIOR sentinel (`__tauNativesV16_3_10`).
=======
 * A long-lived omp session that survives an in-place `bun install -g` upgrade
 * keeps the previous pi-natives NAPI addon resident in the process. A tab
 * the new release (e.g. `16.3.11`), but `require` returns the resident old
 * exports reporting the PRIOR release (`16.3.10`) — via
 * `__piNativesBuildVersion()`, or a legacy `__piNativesV16_3_10` export for
 * addons published before post-link stamps.
>>>>>>> theirs — interstitial `file_header` (T, confidence: high) · weave: run 'weave explain packages/natives/test/issue-4812-repro.test.ts' for per-hunk detail, 'weave check' to verify your resolution
 *
 * The contract this test pins down: `validateLoadedBindings` distinguishes a
 * process-stale mix (disk consistent — restart to re-sync) from a genuinely
 * disk-stale addon (reinstall to re-sync), and chooses restart only when the
 * selected file itself carries the expected version stamp.
 */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { validateLoadedBindings } from "../native/loader-state.js";

const unusedCandidate =
	"/home/u/.bun/install/global/node_modules/@tau/tau-natives-linux-x64/tau_natives.linux-x64.node";

async function withCandidate(contents: string, test: (candidate: string) => void) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tau-natives-sentinel-"));
	const candidate = path.join(dir, "tau_natives.node");
	try {
		await fs.writeFile(candidate, contents);
		test(candidate);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function ctxFor(version: string) {
<<<<<<< ours — scope `return {` in function `ctxFor` (S+F, confidence: low)
// refused_by: statement_fold · collision: `versionSentinelExport: `__piNativesV${version.replace(/[^A-Za-z…`
	return {
		isWorkspaceLoad: false,
		packageVersion: version,
		versionSentinelExport: `__tauNativesV${version.replace(/[^A-Za-z0-9]/g, "_")}`,
	};
=======
	return { isWorkspaceLoad: false, packageVersion: version };
>>>>>>> theirs — scope `return {`
}

/** Stamp slot bytes as `scripts/stamp-native-version.ts` leaves them. */
function stamped(version: string): string {
	const slot = `PI_NATIVES_VERSION_STAMP:${version}`;
	return `binary-prefix${slot}${"\0".repeat(64 - slot.length)}binary-suffix`;
}

function reporting(version: string | null) {
	return { __piNativesBuildVersion: () => version, grep: () => {} };
}

describe("issue 4812: pi-natives release process-stale diagnosis", () => {
	it("accepts bindings that report the expected version", () => {
		expect(() => validateLoadedBindings(ctxFor("16.3.11"), reporting("16.3.11"), unusedCandidate)).not.toThrow();
	});

	it("reports a mid-session upgrade (restart) only when disk has the expected stamp", async () => {
		const ctx = ctxFor("16.3.11");
		for (const resident of [reporting("16.3.10"), { __piNativesV16_3_10: () => {}, grep: () => {} }]) {
			await withCandidate(stamped("16.3.11"), candidate => {
				expect(() => validateLoadedBindings(ctx, resident, candidate)).toThrow("16.3.10");
				expect(() => validateLoadedBindings(ctx, resident, candidate)).toThrow("restart omp");
				expect(() => validateLoadedBindings(ctx, resident, candidate)).toThrow("Disk is already consistent");
				expect(() => validateLoadedBindings(ctx, resident, candidate)).not.toThrow("reinstall to re-sync");
			});
		}
	});

	it("reports disk-stale (reinstall) when the file carries a prior stamp", async () => {
		const ctx = ctxFor("16.3.11");
		await withCandidate(stamped("16.3.10"), candidate => {
			const stale = reporting("16.3.10");
			expect(() => validateLoadedBindings(ctx, stale, candidate)).toThrow(
				"from a different release than this loader",
			);
			expect(() => validateLoadedBindings(ctx, stale, candidate)).toThrow("reinstall to re-sync");
			expect(() => validateLoadedBindings(ctx, stale, candidate)).not.toThrow("restart omp");
		});
	});

	it("does not treat a longer version with the expected prefix as the expected stamp", async () => {
		await withCandidate(stamped("16.3.110"), candidate => {
			expect(() => validateLoadedBindings(ctxFor("16.3.11"), reporting("16.3.110"), candidate)).toThrow(
				"reinstall to re-sync",
			);
		});
	});

	it("rejects an unstamped build as disk-stale", async () => {
		await withCandidate(`PI_NATIVES_VERSION_STAMP:${"\0".repeat(39)}`, candidate => {
			expect(() => validateLoadedBindings(ctxFor("16.3.11"), reporting(null), candidate)).toThrow(
				"reports no release version",
			);
		});
	});

	it("skips validation entirely in workspace dev", () => {
		const ctx = { ...ctxFor("16.3.11"), isWorkspaceLoad: true };
		expect(() => validateLoadedBindings(ctx, { grep: () => {} }, unusedCandidate)).not.toThrow();
	});
});

<<<<<<< ours — test_suite `issue 4812: pi-natives sentinel process-stale diagnosis` (S+F, confidence: low)
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
describe("issue 4812: tau-natives sentinel process-stale diagnosis", () => {
	it("accepts bindings that expose the expected sentinel", () => {
		const ctx = ctxFor("16.3.11");
		expect(() =>
			validateLoadedBindings(ctx, { __tauNativesV16_3_11: () => {}, grep: () => {} }, unusedCandidate),
		).not.toThrow();
	});

	it("reports a mid-session upgrade (restart) only when disk has the expected sentinel", async () => {
		const ctx = ctxFor("16.3.11");
		const resident = { __tauNativesV16_3_10: () => {}, grep: () => {} };
		await withCandidate("__tauNativesV16_3_11", candidate => {
			expect(() => validateLoadedBindings(ctx, resident, candidate)).toThrow("16.3.10");
			expect(() => validateLoadedBindings(ctx, resident, candidate)).toThrow("restart tau");
			expect(() => validateLoadedBindings(ctx, resident, candidate)).toThrow("Disk is already consistent");
			expect(() => validateLoadedBindings(ctx, resident, candidate)).not.toThrow("reinstall to re-sync");
		});
	});

	it("reports disk-stale (reinstall) when an old addon exposes a prior sentinel", async () => {
		const ctx = ctxFor("16.3.11");
		const stale = { __tauNativesV16_3_10: () => {}, grep: () => {} };
		await withCandidate("__tauNativesV16_3_10", candidate => {
			expect(() => validateLoadedBindings(ctx, stale, candidate)).toThrow(
				"from a different release than this loader",
			);
			expect(() => validateLoadedBindings(ctx, stale, candidate)).toThrow("reinstall to re-sync");
			expect(() => validateLoadedBindings(ctx, stale, candidate)).not.toThrow("restart tau");
		});
	});

	it("skips validation entirely in workspace dev", () => {
		const ctx = { ...ctxFor("16.3.11"), isWorkspaceLoad: true };
		expect(() => validateLoadedBindings(ctx, { grep: () => {} }, unusedCandidate)).not.toThrow();
	});
});
=======
>>>>>>> theirs — test_suite `issue 4812: pi-natives sentinel process-stale diagnosis` (S+F, confidence: low)
