import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { validateLoadedBindings } from "../native/loader-state.js";

async function withCandidate(contents: string, test: (candidate: string) => void) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tau-natives-legacy-desktop-"));
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
>>>>>>> theirs — scope `return {` · weave: run 'weave explain packages/natives/test/legacy-desktop-sentinel.test.ts' for per-hunk detail, 'weave check' to verify your resolution
}

function stamped(version: string): string {
	const slot = `PI_NATIVES_VERSION_STAMP:${version}`;
	return `${slot}${"\0".repeat(64 - slot.length)}`;
}

class LegacyDesktopSession {
	capture() {}
	execute() {}
	close() {}
}

const legacyCoreBindings = {
	countTokens() {},
	executeShell() {},
	visibleWidth() {},
};

describe("legacy native addon loading", () => {
	it("accepts a compatible pre-sentinel addon from disk", async () => {
		const ctx = ctxFor("17.2.8");
		const bindings = { ...legacyCoreBindings, DesktopSession: LegacyDesktopSession };
		await withCandidate("legacy native addon", candidate => {
			expect(() => validateLoadedBindings(ctx, bindings, candidate)).not.toThrow();
		});
	});

	it("rejects a pre-sentinel addon without the compatible core ABI", async () => {
		const ctx = ctxFor("17.2.8");
		await withCandidate("legacy native addon", candidate => {
			expect(() => validateLoadedBindings(ctx, { DesktopSession: LegacyDesktopSession }, candidate)).toThrow(
				"reinstall to re-sync",
			);
		});
	});
	it("rejects a pre-sentinel core without the legacy desktop ABI", async () => {
		const ctx = ctxFor("17.2.8");
		await withCandidate("legacy native addon", candidate => {
			expect(() => validateLoadedBindings(ctx, legacyCoreBindings, candidate)).toThrow("reinstall to re-sync");
		});
	});

	it("keeps resident old addons restart-only", async () => {
		const ctx = ctxFor("17.2.8");
<<<<<<< ours — scope `it("keeps resident old addons restart-only", ...` in test_suite `legacy native addon loading` (F, confidence: medium)
// refused_by: statement_fold · collision: `await withCandidate("__piNativesV17_2_8", candidate => {`
		const bindings = { __tauNativesV17_2_7: () => {}, ...legacyCoreBindings, DesktopSession: LegacyDesktopSession };
		await withCandidate("__tauNativesV17_2_8", candidate => {
			expect(() => validateLoadedBindings(ctx, bindings, candidate)).toThrow("restart tau");
=======
		const bindings = { __piNativesV17_2_7: () => {}, ...legacyCoreBindings, DesktopSession: LegacyDesktopSession };
		await withCandidate(stamped("17.2.8"), candidate => {
			expect(() => validateLoadedBindings(ctx, bindings, candidate)).toThrow("restart omp");
>>>>>>> theirs — scope `it("keeps resident old addons restart-only", ...`
		});
	});

	it("does not treat a stamped addon with the core ABI as pre-sentinel", async () => {
		const ctx = ctxFor("17.2.8");
		const bindings = {
			__piNativesBuildVersion: () => null,
			...legacyCoreBindings,
			DesktopSession: LegacyDesktopSession,
		};
		await withCandidate("unstamped", candidate => {
			expect(() => validateLoadedBindings(ctx, bindings, candidate)).toThrow("reinstall to re-sync");
		});
	});
});
