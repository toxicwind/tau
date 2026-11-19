import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	cleanupStaleNativeVersions,
	detectCompiledBinary,
	getAddonFilenames,
	prepareNativeVersionDir,
	resolveLoaderCandidates,
	selectCpuVariant,
	shouldStageNodeModulesAddon,
} from "../native/loader-state.js";

describe("detectCompiledBinary — every compiled-mode signal", () => {
	test("embedded addon is authoritative", () => {
		expect(detectCompiledBinary({ embeddedAddon: { platformTag: "linux-x64", version: "1", files: [] }, env: {}, importMetaUrl: "file:///x" })).toBe(true);
	});

	test("PI_COMPILED env flag (the bare-identifier define target)", () => {
		// issue #823: `bun build --compile --define PI_COMPILED=true` substitutes
		// the bare identifier, so this env read is the only runtime signal.
		expect(detectCompiledBinary({ embeddedAddon: null, env: { PI_COMPILED: "true" }, importMetaUrl: "file:///x" })).toBe(true);
		expect(detectCompiledBinary({ embeddedAddon: null, env: { PI_COMPILED: "" }, importMetaUrl: "file:///x" })).toBe(false);
	});

	test.each(["file:///$bunfs/root/x.js", "file:///~BUN/root/x.js", "file:///%7EBUN/root/x.js"])(
		"bunfs import.meta.url form %j counts as compiled",
		importMetaUrl => {
			expect(detectCompiledBinary({ embeddedAddon: null, env: {}, importMetaUrl })).toBe(true);
		},
	);

	test("plain source mode is not compiled", () => {
		expect(detectCompiledBinary({ embeddedAddon: null, env: {}, importMetaUrl: "file:///home/u/proj/index.ts" })).toBe(false);
		expect(detectCompiledBinary({ embeddedAddon: null, env: {}, importMetaUrl: null })).toBe(false);
	});
});

describe("getAddonFilenames — variant preference order", () => {
	test("non-x64 always falls back to the single default", () => {
		expect(getAddonFilenames({ tag: "linux-arm64", arch: "arm64", variant: "modern" })).toEqual([
			"tau_natives.linux-arm64.node",
		]);
	});

	test("modern x64 tries modern → baseline → default", () => {
		expect(getAddonFilenames({ tag: "linux-x64", arch: "x64", variant: "modern" })).toEqual([
			"tau_natives.linux-x64-modern.node",
			"tau_natives.linux-x64-baseline.node",
			"tau_natives.linux-x64.node",
		]);
	});

	test("baseline x64 tries baseline → default (never modern)", () => {
		expect(getAddonFilenames({ tag: "linux-x64", arch: "x64", variant: "baseline" })).toEqual([
			"tau_natives.linux-x64-baseline.node",
			"tau_natives.linux-x64.node",
		]);
	});

	test("null variant (detection skipped) → default only", () => {
		expect(getAddonFilenames({ tag: "linux-x64", arch: "x64", variant: null })).toEqual([
			"tau_natives.linux-x64.node",
		]);
	});
});

describe("shouldStageNodeModulesAddon — Windows update-safety net only", () => {
	test("staging is Windows-only", () => {
		expect(shouldStageNodeModulesAddon({ platform: "linux", isCompiledBinary: false, nativeDir: "/x/node_modules/y/native" })).toBe(false);
	});

	test("compiled binaries never stage (embedded extraction handles them)", () => {
		expect(shouldStageNodeModulesAddon({ platform: "win32", isCompiledBinary: true, nativeDir: "C:\\x\\node_modules\\y\\native" })).toBe(false);
	});

	test("workspace dev check both separators regardless of host path.sep", () => {
		// This helper runs on Windows hosts with `\` and in CI on POSIX with
		// `/` — the check must normalize BOTH spellings.
		expect(shouldStageNodeModulesAddon({ platform: "win32", isCompiledBinary: false, nativeDir: "C:\\x\\node_modules\\y\\native" })).toBe(true);
		expect(shouldStageNodeModulesAddon({ platform: "win32", isCompiledBinary: false, nativeDir: "/x/node_modules/y/native" })).toBe(true);
		// Workspace dev (native/ inside the repo, no node_modules segment).
		expect(shouldStageNodeModulesAddon({ platform: "win32", isCompiledBinary: false, nativeDir: "C:\\repo\\natives\\native" })).toBe(false);
	});
});

describe("resolveLoaderCandidates — search order per mode", () => {
	const files = ["tau_natives.linux-x64-modern.node", "tau_natives.linux-x64-baseline.node", "tau_natives.linux-x64.node"];
	const base = { addonFilenames: files, nativeDir: "/pkg/native", execDir: "/pkg/exec", versionedDir: "/cache/1.0.0", userDataDir: "/userdata" };

	test("compiled mode prefers cache dirs over package dirs", () => {
		const candidates = resolveLoaderCandidates({ ...base, isCompiledBinary: true });
		expect(candidates[0]).toBe(path.join("/cache/1.0.0", files[0]));
		expect(candidates.indexOf(path.join("/cache/1.0.0", files[0]))).toBeLessThan(
			candidates.indexOf(path.join("/pkg/native", files[0])),
		);
		// userData comes after versionedDir for every filename.
		expect(candidates.indexOf(path.join("/cache/1.0.0", files[0]))).toBeLessThan(
			candidates.indexOf(path.join("/userdata", files[0])),
		);
	});

	test("staging mode searches staged cache before the locked node_modules copy", () => {
		const candidates = resolveLoaderCandidates({
			...base,
			isCompiledBinary: false,
			stageFromNodeModules: true,
			leafPackageDir: "/leaf/pkg",
		});
		expect(candidates[0]).toBe(path.join("/cache/1.0.0", files[0]));
		expect(candidates.indexOf(path.join("/leaf/pkg", files[0]))).toBeLessThan(
			candidates.indexOf(path.join("/pkg/native", files[0])),
		);
	});

	test("plain release mode searches leaf package before base dirs", () => {
		const candidates = resolveLoaderCandidates({
			...base,
			isCompiledBinary: false,
			stageFromNodeModules: false,
			leafPackageDir: "/leaf/pkg",
		});
		expect(candidates[0]).toBe(path.join("/leaf/pkg", files[0]));
	});

	test("deduplicates candidates", () => {
		const candidates = resolveLoaderCandidates({
			...base,
			isCompiledBinary: false,
			leafPackageDir: base.nativeDir, // leaf == native dir → dupes
		});
		expect(new Set(candidates).size).toBe(candidates.length);
	});

	test("null leafPackageDir contributes nothing", () => {
		const candidates = resolveLoaderCandidates({ ...base, isCompiledBinary: false, leafPackageDir: null });
		expect(candidates.some(candidate => candidate.startsWith("/leaf"))).toBe(false);
	});
});

describe("selectCpuVariant — resolution order and cache handoff", () => {
	const detect = (avx2: boolean) => () => avx2;

	test("non-x64 never detects and never sets the cache", () => {
		const result = selectCpuVariant({ arch: "arm64", override: "modern", env: {}, detectAvx2: detect(true) });
		expect(result).toEqual({ variant: null, source: "non-x64" });
	});

	test("explicit override always wins, no cache write", () => {
		const result = selectCpuVariant({
			arch: "x64",
			override: "modern",
			env: { __PI_NATIVE_VARIANT_CACHE: "baseline" },
			detectAvx2: detect(false), // must NOT be called
		});
		expect(result).toEqual({ variant: "modern", source: "override" });
	});

	test("cached verdict short-circuits detection (issue #3238 worker spawns)", () => {
		const result = selectCpuVariant({
			arch: "x64",
			override: null,
			env: { __PI_NATIVE_VARIANT_CACHE: "baseline" },
			detectAvx2: detect(true),
		});
		expect(result).toEqual({ variant: "baseline", source: "cache" });
	});

	test("detection result is surfaced for the caller to persist", () => {
		const result = selectCpuVariant({ arch: "x64", override: null, env: {}, detectAvx2: detect(true) });
		expect(result).toEqual({
			variant: "modern",
			source: "detect",
			cacheEnvKey: "__PI_NATIVE_VARIANT_CACHE",
			cacheEnvValue: "modern",
		});
	});

	test("invalid override strings are ignored, not trusted", () => {
		const result = selectCpuVariant({ arch: "x64", override: "MODERN", env: {}, detectAvx2: detect(false) });
		expect(result).toEqual({ variant: "baseline", source: "detect", cacheEnvKey: "__PI_NATIVE_VARIANT_CACHE", cacheEnvValue: "baseline" });
	});
});

describe("versioned cache lifecycle", () => {
	test("prepareNativeVersionDir creates and touches the dir", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "tau-natives-cache-"));
		try {
			const versioned = path.join(root, "1.2.3");
			prepareNativeVersionDir(versioned);
			expect(fs.statSync(versioned).isDirectory()).toBe(true);
			// The explicit touch is what protects partially-populated caches
			// from concurrent cleanup — mtime must be fresh.
			expect(Date.now() - fs.statSync(versioned).mtimeMs).toBeLessThan(5000);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test("cleanup removes only OLDER release versions past the grace window", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "tau-natives-clean-"));
		try {
			const mk = (name: string, ageMs: number) => {
				const dir = path.join(root, name);
				fs.mkdirSync(dir);
				const old = new Date(Date.now() - ageMs);
				fs.utimesSync(dir, old, old);
			};
			const GRACE = 10 * 60_000;
			mk("0.9.9", GRACE + 60_000); // older + stale → removed
			mk("0.9.8", 1_000); // older but fresh (concurrent older binary) → kept
			mk("9.9.9", GRACE + 60_000); // newer → kept
			mk("not-semver", GRACE + 60_000); // unparseable → never touched
			mk("1.0.0-rc1", GRACE + 60_000); // prerelease junk → never touched

			const removed = cleanupStaleNativeVersions({ nativesDir: root, currentVersion: "1.0.0" });
			expect(removed).toEqual([path.join(root, "0.9.9")]);
			expect(fs.existsSync(path.join(root, "0.9.8"))).toBe(true);
			expect(fs.existsSync(path.join(root, "9.9.9"))).toBe(true);
			expect(fs.existsSync(path.join(root, "not-semver"))).toBe(true);
			expect(fs.existsSync(path.join(root, "1.0.0-rc1"))).toBe(true);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test("cleanup on a missing natives dir is a no-op, not a crash", () => {
		expect(cleanupStaleNativeVersions({ nativesDir: "/nonexistent/natives", currentVersion: "1.0.0" })).toEqual([]);
	});
});
