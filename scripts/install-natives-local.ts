#!/usr/bin/env bun
/**
 * Build tau_natives with Wayland screencast (pipewire) and stage it safely.
 *
 * Why this exists: the shipped `.node` is built without `--features
 * wayland-pipewire`, so every Wayland capture call fails with
 * "Wayland capture requires the wayland-pipewire feature". This rebuilds the
 * addon with that feature, verifies the result, and installs it into BOTH the
 * package tree and the per-version runtime cache.
 *
 * Why it does not `cp` over a live addon: overwriting the file a running
 * process has dlopen'd is how the previous attempt segfaulted Bun. The
 * loader's version sentinel plus `dlopen` of a partially-written mapping is
 * fatal. This script:
 *   1. builds into `target/` (never into the install path),
 *   2. verifies ldd + version sentinel + a live DesktopSession probe in a
 *      throwaway child process,
 *   3. stages via write-to-temp + atomic rename, and refuses to install if a
 *      live process still holds the destination open — the caller restarts tau.
 *
 * Usage:
 *   bun scripts/install-natives-local.ts            # build, verify, install
 *   bun scripts/install-natives-local.ts --check    # verify only, install nothing
 *   bun scripts/install-natives-local.ts --force    # install even if tau holds the file
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

const repoRoot = path.join(import.meta.dir, "..");
const require_ = createRequire(path.join(repoRoot, "scripts/anchor.cjs"));
const packageJson = require_(
	path.join(repoRoot, "packages/natives/package.json"),
) as { version: string; name: string };
const nativeDir = path.join(repoRoot, "packages/natives/native");
const addonName = `tau_natives.${process.platform}-${process.arch}-modern.node`;
const packageAddon = path.join(nativeDir, addonName);
const runtimeCacheDir = path.join(process.env.HOME ?? "~", ".tau/natives", packageJson.version);
const runtimeAddon = path.join(runtimeCacheDir, addonName);
const builtAddon = path.join(repoRoot, "target/release/libtau_natives.so");

const checkOnly = process.argv.includes("--check");
const force = process.argv.includes("--force");

function log(message: string): void {
	console.log(`[install-natives] ${message}`);
}

function fatal(message: string): never {
	console.error(`[install-natives] ERROR: ${message}`);
	process.exit(1);
}

/** PIDs whose `/proc/<pid>/maps` reference the given addon path. */
function processesHolding(target: string): number[] {
	const real = fs.realpathSync(target);
	const held: number[] = [];
	for (const entry of fs.readdirSync("/proc")) {
		if (!/^\d+$/.test(entry)) continue;
		let maps: string;
		try {
			maps = fs.readFileSync(`/proc/${entry}/maps`, "utf8");
		} catch {
			continue; // process exited, or not ours
		}
		if (maps.includes(real)) held.push(Number(entry));
	}
	return held;
}

/**
 * Atomic install: write the payload to a sibling temp file, fsync it, then
 * rename over the destination. rename(2) within a directory is atomic, so a
 * reader either sees the whole old file or the whole new one.
 */
function installAtomically(source: string, destination: string): void {
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	const staging = `${destination}.new-${process.pid}`;
	fs.copyFileSync(source, staging);
	const fd = fs.openSync(staging, "r+");
	try {
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	fs.chmodSync(staging, 0o755);
	fs.renameSync(staging, destination);
	const dirFd = fs.openSync(path.dirname(destination), "r");
	try {
		fs.fsyncSync(dirFd);
	} finally {
		fs.closeSync(dirFd);
	}
}

/**
 * Verify a candidate addon: it must dynamically link libpipewire, carry the
 * version sentinel the loader checks, and report capture:true from a live
 * DesktopSession in a fresh child process.
 */
function verify(candidate: string): { ok: true } | { ok: false; reason: string } {
	if (!fs.existsSync(candidate)) return { ok: false, reason: `missing: ${candidate}` };

	// `target/release/libtau_natives.so` has no `.node` suffix, and Bun parses
	// any non-.node path as JavaScript. Stage a suffixed copy so the loader
	// treats it as a Node-API addon.
	const staged = path.join(os.tmpdir(), `.install-natives-probe-${process.pid}.node`);
	fs.copyFileSync(candidate, staged);

	const sentinel = `__tauNativesV${packageJson.version.replace(/[^A-Za-z0-9]/g, "_")}`;
	const probe = path.join(repoRoot, ".install-natives-probe.mjs");
	fs.writeFileSync(
		probe,
		`import { createRequire } from "node:module";
const require_ = createRequire(${JSON.stringify(path.join(nativeDir, "index.js"))});
const addon = require_(${JSON.stringify(staged)});
const expected = ${JSON.stringify(sentinel)};
if (!Object.prototype.hasOwnProperty.call(addon, expected)) {
	console.error("SENTINEL_MISSING:" + expected);
	process.exit(2);
}
const session = new addon.DesktopSession();
const caps = session.capabilities;
if (caps.backend === "wayland" && caps.capture !== true) {
	console.error("CAPTURE_DISABLED:" + JSON.stringify(caps));
	process.exit(3);
}
console.log("VERIFY_OK:" + JSON.stringify(caps));
process.exit(0);
`,
	);

	const result = spawnSync(process.execPath, [probe], { encoding: "utf8" });
	fs.rmSync(probe, { force: true });
	fs.rmSync(staged, { force: true });
	const stdout = result.stdout ?? "";
	if (result.status !== 0) {
		return { ok: false, reason: (result.stderr || stdout).trim() || `probe exited ${result.status}` };
	}
	return { ok: true };
}

if (checkOnly) {
	log(`checking ${packageAddon}`);
	const verdict = verify(packageAddon);
	if (!verdict.ok) fatal(`${addonName}: ${verdict.reason}`);
	log("ok: pipewire capture available");
	process.exit(0);
}

log(`building tau-natives with wayland-pipewire (nightly)`);
const build = spawnSync(
	"cargo",
	["build", "-p", "tau-natives", "--release", "--features", "wayland-pipewire"],
	{ cwd: repoRoot, stdio: ["ignore", "inherit", "inherit"], env: process.env },
);
if (build.status !== 0) fatal(`cargo build failed (${build.status})`);

const ldd = spawnSync("ldd", [builtAddon], { encoding: "utf8" });
if (!(ldd.stdout ?? "").includes("libpipewire-0.3")) {
	fatal("build did not link libpipewire — is libpipewire installed? (paru -S pipewire)");
}

log(`verifying ${builtAddon}`);
const verdict = verify(builtAddon);
if (!verdict.ok) fatal(`verification rejected the build: ${verdict.reason}`);

const destinations = [packageAddon, runtimeAddon];
const blocking = new Map<string, number[]>();
for (const destination of destinations) {
	if (!fs.existsSync(destination)) continue;
	const held = processesHolding(destination);
	if (held.length > 0) blocking.set(destination, held);
}

if (blocking.size > 0 && !force) {
	for (const [destination, held] of blocking) {
		log(`SKIP ${destination}: held by live pid(s) ${held.join(", ")}`);
		log("  restart tau, then re-run this script (or pass --force if you accept a crash)");
	}
	fatal("refusing to replace an addon a running process has mapped; restart the holder first");
}

for (const destination of destinations) {
	installAtomically(builtAddon, destination);
	log(`installed ${destination}`);
}

const finalVerdict = verify(runtimeAddon);
if (!finalVerdict.ok) fatal(`post-install verification failed: ${finalVerdict.reason}`);
log("done: restart tau to load the new addon");