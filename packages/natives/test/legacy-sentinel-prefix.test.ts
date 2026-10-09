/**
 * The pi → tau rebrand renamed the native version sentinel export
 * (`__piNativesV<version>` → `__tauNativesV<version>`) without bumping the
 * package version, so every already-installed `.node` carries the legacy
 * prefix for the release this tree expects.
 *
 * That is a rename, not drift: the loader must accept it, or every pre-rebrand
 * addon hard-fails at load with a "reinstall to re-sync" that reinstalling
 * cannot fix. A legacy prefix at a DIFFERENT version is real drift and must
 * keep its diagnosis — restart when disk is current, reinstall when it is not.
 */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { NativeAddonStatus } from "../native/loader-state.js";
import {
	describeLoadedAddon,
	missingNativeExport,
	missingNativeExportMessage,
	sentinelMatchesExpected,
	validateLoadedBindings,
} from "../native/loader-state.js";

async function withCandidate(contents: string, test: (candidate: string) => void) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tau-natives-legacy-prefix-"));
	const candidate = path.join(dir, "tau_natives.node");
	try {
		await fs.writeFile(candidate, contents);
		test(candidate);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

const expected = "__tauNativesV18_3_0";

describe("pre-rebrand sentinel prefix", () => {
	it("matches the legacy prefix at the same release", () => {
		expect(sentinelMatchesExpected("__piNativesV18_3_0", expected)).toBe(true);
	});

	it("does not match a different release under the legacy prefix", () => {
		expect(sentinelMatchesExpected("__piNativesV18_2_6", expected)).toBe(false);
		// Prefix-only equality would wave through `18_3_0` matching `18_3_01`.
		expect(sentinelMatchesExpected("__piNativesV18_3_01", expected)).toBe(false);
	});

	it("does not match an unrecognized sentinel name", () => {
		expect(sentinelMatchesExpected("__tauNativesX18_3_0", expected)).toBe(false);
	});

	it("validates a pre-rebrand addon of the current release", async () => {
		const ctx = { isWorkspaceLoad: false, packageVersion: "18.3.0", versionSentinelExport: expected };
		const bindings = { __piNativesV18_3_0: () => {}, grep: () => {} };
		await withCandidate("binary__piNativesV18_3_0", candidate => {
			expect(() => validateLoadedBindings(ctx, bindings, candidate)).not.toThrow();
			// Not stale, so `missingNativeExport` must stay a plain `undefined`
			// and callers keep using the absence as a capability probe.
			expect(describeLoadedAddon(bindings, candidate, ctx).stale).toBe(false);
			expect(missingNativeExport("grep", describeLoadedAddon(bindings, candidate, ctx))).toBeUndefined();
		});
	});

	it("still diagnoses a pre-rebrand addon from another release as stale", async () => {
		const ctx = { isWorkspaceLoad: false, packageVersion: "18.3.0", versionSentinelExport: expected };
		const stale = { __piNativesV18_2_6: () => {}, grep: () => {} };
		await withCandidate("binary__piNativesV18_2_6", candidate => {
			expect(() => validateLoadedBindings(ctx, stale, candidate)).toThrow(
				"from a different release than this loader",
			);
			expect(() => validateLoadedBindings(ctx, stale, candidate)).toThrow("reinstall to re-sync");
			expect(describeLoadedAddon(stale, candidate, ctx).stale).toBe(true);
		});
	});

	it("still diagnoses a resident pre-rebrand addon as restart-only", async () => {
		const ctx = { isWorkspaceLoad: false, packageVersion: "18.3.0", versionSentinelExport: expected };
		const resident = { __piNativesV18_2_6: () => {}, grep: () => {} };
		await withCandidate("binary__tauNativesV18_3_0", candidate => {
			expect(() => validateLoadedBindings(ctx, resident, candidate)).toThrow("restart tau");
			expect(() => validateLoadedBindings(ctx, resident, candidate)).toThrow("Disk is already consistent");
		});
	});

	it("still reports an addon with no sentinel at all as stale", () => {
		// Nothing names its release, so it cannot be shown to be this one.
		const preSentinel: NativeAddonStatus = {
			path: "/w/packages/natives/native/tau_natives.linux-x64.node",
			sentinel: null,
			expectedSentinel: "__tauNativesV18_3_0",
			packageVersion: "18.3.0",
			stale: true,
		};
		expect(missingNativeExport("search", preSentinel)).toBeTypeOf("function");
		expect(missingNativeExportMessage("search", preSentinel)).toContain("built before version sentinels existed");
	});
});
