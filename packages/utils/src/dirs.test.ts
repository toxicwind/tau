import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	CONFIG_DIR_NAME,
	normalizeProfileName,
	resolveConfigDirEnv,
	resolveProfileEnv,
	refreshDirsFromEnv,
	setAgentDir,
	setProfile,
	__resetDirsFromEnvForTests,
	__resetInstallIdCacheForTests,
	__resetProjectDirCacheForTests,
	setProjectDir,
	getProjectDir,
	getConfigDirName,
	getConfigAgentDirName,
	getConfigRootDir,
	getAgentDir,
	getProfileRootDir,
	getActiveProfile,
	getReportsDir,
	getLogsDir,
	getLogPath,
	getPluginsDir,
	getWorktreesDir,
	setWorktreesDir,
	getWorktreeDir,
	getGithubCacheDbPath,
	getLegacyPiExtensionCacheDbPath,
	getInstallId,
	hashPath,
	pathIsWithin,
	relativePathWithinRoot,
	resolveEquivalentPath,
	normalizePathForComparison,
	directoryIsMissing,
	directoryExists,
	directoryIsEnterable,
	directoryIsEnterableSync,
	getDaemonRuntimeDir,
	getAgentDbPath,
	getMCPConfigPath,
	getSSHConfigPath,
} from "./dirs";

const HOME = os.homedir();

describe("normalizeProfileName", () => {
	test.each([[undefined], [""], ["   "], ["default"]])(
		"sentinel %j → undefined, no throw",
		input => {
			expect(normalizeProfileName(input)).toBeUndefined();
		},
	);
	test.each([["tau"], ["my.profile_1-2"], ["a".repeat(64)]])(
		"valid %j passes through verbatim",
		input => {
			expect(normalizeProfileName(input)).toBe(input);
		},
	);
	test.each([
		[" Tau "],
		["UPPER"],
		["."],
		[".."],
		["ends."],
		["CON"],
		["con.txt"],
		["LPT9.foo"],
		["a".repeat(65)],
	])("invalid %j throws", input => {
		expect(() => normalizeProfileName(input)).toThrow("Invalid TAU profile");
	});
});

describe("resolveProfileEnv / resolveConfigDirEnv", () => {
	test("tau wins over pi", () => {
		expect(resolveProfileEnv("t", "p")).toEqual("t");
		expect(resolveProfileEnv(undefined, "p")).toEqual("p");
	});
	test("config dir env precedence", () => {
		expect(resolveConfigDirEnv("a", "b")).toEqual("a");
		expect(resolveConfigDirEnv(undefined, "b")).toEqual("b");
	});
});

describe("hostile TAU_CONFIG_DIR overrides", () => {
	const originalEnv = { ...process.env };
	afterEach(() => {
		process.env = { ...originalEnv };
		delete process.env.TAU_CONFIG_DIR;
		delete process.env.PI_CONFIG_DIR;
		__resetDirsFromEnvForTests();
	});

	test("default config dir when no override", () => {
		expect(getConfigDirName()).toEqual(CONFIG_DIR_NAME);
	});

	test("absolute override does not double-join home", () => {
		process.env.TAU_CONFIG_DIR = "/home/someone/.tau";
		expect(getConfigDirName()).toEqual(".tau");
	});

	test("nested relative override reduces to final segment", () => {
		process.env.TAU_CONFIG_DIR = "home/toxic/.tau";
		expect(getConfigDirName()).toEqual(".tau");
	});

	test("whitespace-only override falls back", () => {
		process.env.TAU_CONFIG_DIR = "   \n  ";
		expect(getConfigDirName()).toEqual(CONFIG_DIR_NAME);
	});

	test("PI_CONFIG_DIR is the legacy fallback", () => {
		delete process.env.TAU_CONFIG_DIR;
		process.env.PI_CONFIG_DIR = "weird/nested/.tau";
		expect(getConfigDirName()).toEqual(".tau");
	});

	test("TAU_CONFIG_DIR wins over PI_CONFIG_DIR", () => {
		process.env.TAU_CONFIG_DIR = "taudir";
		process.env.PI_CONFIG_DIR = "pidir";
		expect(getConfigDirName()).toEqual("taudir");
	});

	test("trailing slash survives as bare name", () => {
		process.env.TAU_CONFIG_DIR = "weird/";
		expect(getConfigDirName()).toEqual("weird");
	});
});

describe("profile nesting", () => {
	const originalEnv = { ...process.env };
	afterEach(() => {
		process.env = { ...originalEnv };
		__resetDirsFromEnvForTests();
	});

	test("no profile agent dir", () => {
		expect(getAgentDir()).toMatch(/\/agent$/);
		expect(getConfigRootDir()).toEqual(path.join(HOME, CONFIG_DIR_NAME));
	});

	test("profile nests under profiles/<name>/agent", () => {
		setProfile("olympus");
		expect(getAgentDir()).toEqual(
			path.join(HOME, CONFIG_DIR_NAME, "profiles", "olympus", "agent"),
		);
		expect(getActiveProfile()).toEqual("olympus");
	});

	test("separator-hostage profile names throw at the boundary", () => {
		expect(() => setProfile("CON")).toThrow("Invalid TAU profile");
	});

	test("setProfile(undefined) restores default", () => {
		setProfile("olympus");
		setProfile(undefined);
		expect(getActiveProfile()).toBeUndefined();
		expect(getAgentDir()).toMatch(/\/agent$/);
	});
});

describe("getProfileRootDir", () => {
	test("default profile root", () => {
		expect(getProfileRootDir(undefined)).toEqual(path.join(HOME, CONFIG_DIR_NAME));
	});

	test("named profile root", () => {
		expect(getProfileRootDir("olympus")).toEqual(
			path.join(HOME, CONFIG_DIR_NAME, "profiles", "olympus"),
		);
	});

	test("invalid profile root throws", () => {
		expect(() => getProfileRootDir("CON")).toThrow("Invalid TAU profile");
	});
});

describe("path utilities", () => {
	const root = path.join(HOME, CONFIG_DIR_NAME);

	test("pathIsWithin: exact root is within", () => {
		expect(pathIsWithin(root, root)).toBe(true);
	});

	test("pathIsWithin: child is within", () => {
		expect(pathIsWithin(root, path.join(root, "agent", "config.yml"))).toBe(true);
	});

	test("pathIsWithin: sibling outside root", () => {
		expect(pathIsWithin(root, path.join(HOME, ".other"))).toBe(false);
	});

	test("pathIsWithin: prefix-trap is not within", () => {
		expect(pathIsWithin(root, root + "X")).toBe(false);
	});

	test("relativePathWithinRoot: child returns relative path", () => {
		expect(
			relativePathWithinRoot(root, path.join(root, "a", "b")),
		).toEqual(path.join("a", "b"));
	});

	test("relativePathWithinRoot: outside root returns null", () => {
		expect(relativePathWithinRoot(root, HOME)).toBeNull();
	});

	test("normalizePathForComparison: linux is case-sensitive", () => {
		const a = path.join(HOME, "Tau");
		const b = path.join(HOME, "tau");
		expect(normalizePathForComparison(a)).not.toEqual(
			normalizePathForComparison(b),
		);
	});

	test("resolveEquivalentPath resolves absolute", () => {
		expect(resolveEquivalentPath(root)).toEqual(path.resolve(root));
	});
});

describe("directory probes with real tmp dirs", () => {
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tau-dirs-test-"));
	afterEach(() => {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	});

	test("directoryExists / directoryIsMissing", async () => {
		const real = path.join(tmpRoot, "real");
		fs.mkdirSync(real, { recursive: true });
		expect(await directoryExists(real)).toBe(true);
		expect(await directoryIsMissing(real)).toBe(false);
		expect(await directoryExists(path.join(tmpRoot, "nope"))).toBe(false);
		expect(await directoryIsMissing(path.join(tmpRoot, "nope"))).toBe(true);
	});

	test("directoryIsEnterable requires executable bit", async () => {
		const locked = path.join(tmpRoot, "locked");
		fs.mkdirSync(locked, { recursive: true });
		fs.chmodSync(locked, 0o444);
		try {
			expect(await directoryIsEnterable(locked)).toBe(false);
		} finally {
			fs.chmodSync(locked, 0o755);
		}
	});

	test("directoryIsEnterableSync mirrors async", async () => {
		const real = path.join(tmpRoot, "real");
		fs.mkdirSync(real, { recursive: true });
		expect(directoryIsEnterableSync(real)).toBe(true);
		expect(directoryIsEnterableSync(path.join(tmpRoot, "nope"))).toBe(false);
	});
});

describe("profile state machine (setAgentDir snapshot)", () => {
	const originalEnv = { ...process.env };
	beforeEach(() => {
		process.env = { ...originalEnv };
		delete process.env.PI_CODING_AGENT_DIR;
		delete process.env.TAU_PROFILE;
		delete process.env.PI_PROFILE;
		__resetDirsFromEnvForTests();
	});
	afterEach(() => {
		process.env = { ...originalEnv };
		__resetDirsFromEnvForTests();
	});

	test("setAgentDir overrides", () => {
		const fake = path.join(os.tmpdir(), "tau-fake-agent-dir");
		setAgentDir(fake);
		expect(getAgentDir()).toEqual(fake);
	});

	test("setProfile switches to profile resolver", () => {
		setProfile("olympus");
		expect(getConfigRootDir()).toEqual(
			path.join(HOME, CONFIG_DIR_NAME, "profiles", "olympus"),
		);
		expect(getAgentDir()).toEqual(
			path.join(HOME, CONFIG_DIR_NAME, "profiles", "olympus", "agent"),
		);
		expect(process.env.PI_CODING_AGENT_DIR).toEqual(getAgentDir());
	});

	test("setProfile then setAgentDir invalidates snapshot", () => {
		setProfile("olympus");
		setAgentDir(path.join(os.tmpdir(), "fake"));
		setProfile(undefined);
		expect(getActiveProfile()).toBeUndefined();
	});
});

describe("agent subpaths", () => {
	const fakeAgentDir = path.join(os.tmpdir(), `tau-agent-${process.pid}`);
	beforeEach(() => setAgentDir(fakeAgentDir));
	afterEach(() => fs.rmSync(fakeAgentDir, { recursive: true, force: true }));

	test("hashPath is deterministic and short", () => {
		const h1 = hashPath(fakeAgentDir);
		const h2 = hashPath(fakeAgentDir);
		expect(h1).toEqual(h2);
		expect(h1).toMatch(/^[0-9a-f]{7}$/);
	});

	test("daemon runtime dir resolves under agent dir", () => {
		const d = getDaemonRuntimeDir("/some/project");
		expect(path.isAbsolute(d)).toBe(true);
	});

	test("agent db paths live under agent dir", () => {
		expect(getAgentDbPath()).toStartWith(fakeAgentDir);
		expect(getMCPConfigPath("user")).toStartWith(fakeAgentDir);
		expect(getSSHConfigPath("user")).toStartWith(fakeAgentDir);
	});

	test("install id is stable and resettable", () => {
		__resetInstallIdCacheForTests();
		const a = getInstallId();
		__resetInstallIdCacheForTests();
		expect(getInstallId()).toEqual(a);
		expect(typeof a).toBe("string");
		expect(a.length).toBeGreaterThan(8);
	});
});

describe("worktree dir weirdness", () => {
	const originalEnv = { ...process.env };
	afterEach(() => {
		process.env = { ...originalEnv };
		delete process.env.TAU_WORKTREE_DIR;
		setWorktreesDir(undefined);
	});

	test("setWorktreesDir clears on undefined", () => {
		expect(setWorktreesDir("/tmp/x")).toEqual("/tmp/x");
		expect(setWorktreesDir(undefined)).toBeUndefined();
		expect(getWorktreesDir()).toEqual(
			path.join(HOME, CONFIG_DIR_NAME, "wt"),
		);
	});

	test("relative worktree dir is ignored", () => {
		expect(setWorktreesDir("relative/dir")).toBeUndefined();
		expect(getWorktreesDir()).toEqual(path.join(HOME, CONFIG_DIR_NAME, "wt"));
	});

	test("tilde worktree dir expands", () => {
		expect(setWorktreesDir("~/wt")).toEqual(path.join(HOME, "wt"));
		expect(getWorktreesDir()).toEqual(path.join(HOME, "wt"));
	});

	test("TAU_WORKTREE_DIR env overrides default", () => {
		process.env.TAU_WORKTREE_DIR = "/tmp/wt-env";
		expect(getWorktreesDir()).toEqual("/tmp/wt-env");
	});

	test("hashPath uses 7-hex encoding", () => {
		expect(hashPath("/a/b")).toHaveLength(7);
	});
});

describe("plugins dir with overridden home", () => {
	test("getPluginsDir(home) short-circuits deterministically", () => {
		const fakeHome = path.join(os.tmpdir(), "tau-fake-home-" + process.pid);
		fs.mkdirSync(fakeHome, { recursive: true });
		try {
			expect(getPluginsDir(fakeHome)).toEqual(
				path.join(fakeHome, CONFIG_DIR_NAME, "plugins"),
			);
		} finally {
			fs.rmSync(fakeHome, { recursive: true, force: true });
		}
	});
});

describe("project dir resolution", () => {
	const originalEnv = { ...process.env };
	afterEach(() => {
		process.env = { ...originalEnv };
		__resetProjectDirCacheForTests();
		delete process.env.PWD;
	});

	test("setProjectDir wins over cwd", () => {
		const fake = path.join(os.tmpdir(), "tau-proj-" + process.pid);
		fs.mkdirSync(fake, { recursive: true });
		setProjectDir(fake);
		expect(getProjectDir()).toEqual(fake);
	});
});

describe("log path", () => {
	test("getLogPath format is dated+pid", () => {
		const d = new Date("2026-10-30T12:34:56Z");
		expect(getLogPath(d, 999)).toEqual(
			path.join(getLogsDir(), "tau.2026-10-30.999.log"),
		);
	});
});
