import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Database, Statement } from "bun:sqlite";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
<<<<<<< ours — imports `file_header` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: `import { COMPOSER_DEFAULTS, type ComposerStatusSnapshot } from …` +2 more
import { COMPOSER_DEFAULTS, type ComposerStatusSnapshot } from "@tau/tau-tui/prompt/composer";
import {
	readComposerStartupCache,
	writeComposerLspCache,
	writeComposerRecentSessionsCache,
	writeComposerStatusCache,
	writeComposerUiCache,
	writeComposerWelcomeCache,
} from "@tau/tau-tui/prompt/composer-cache";
import { getComposerCacheDir } from "@tau/tau-utils/dirs";
=======
import { COMPOSER_DEFAULTS, type ComposerStatusCache } from "@oh-my-pi/pi-tui/prompt/composer";
import { ComposerCache } from "@oh-my-pi/pi-tui/prompt/composer-cache";
>>>>>>> theirs — imports `file_header` (S+F, confidence: low) · weave: run 'weave explain packages/tui/test/composer-cache.test.ts' for per-hunk detail, 'weave check' to verify your resolution

function statusFor(thinkingLevel: ThinkingLevel): ComposerStatusCache {
	return {
		borderColor: { prefix: "\x1b[36m", suffix: "\x1b[39m" },
		statusLine: {
			settings: { leftSegments: ["model", "path", "git"], contextLine: "embedded" },
			gitEnabled: true,
			thinkingLevel,
			autoThinking: false,
			fastMode: false,
			usingSubscription: true,
			autoCompactEnabled: true,
			compactionBoundaries: { thresholdPercent: 80, speculationPercent: null },
		},
	};
}

describe("composer startup cache", () => {
	let root: string;
	let dbPath: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-composer-cache-"));
		dbPath = path.join(root, "cache", "composer.db");
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

<<<<<<< ours — scope `it("round-trips per-project UI, status, recen...` in test_suite `composer startup cache` (S+F, confidence: low)
// refused_by: statement_fold · collision: `const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "omp-compos…`
	it("round-trips per-project UI, status, recent-session JSONL, and LSP speculation", async () => {
		const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "tau-composer-cache-"));
		const otherCwd = `${cwd}-other`;
		const key = Bun.hash.wyhash(path.resolve(cwd)).toString(16).padStart(16, "0");
		const cacheDir = path.join(getComposerCacheDir(), key);
		try {
			const preferences = { ...COMPOSER_DEFAULTS, composerShape: "rail", autocompleteMaxVisible: 7 };
			const recentSessions = [{ name: "cached work", timeAgo: "3m ago" }];
			const lspServers = [{ name: "rust-analyzer", status: "connecting" as const, fileTypes: [".rs"] }];
			const status: ComposerStatusSnapshot = {
				shape: "rail",
				topBorder: { content: "placeholder", width: 11 },
				bottomLines: ["", "placeholder"],
			};
			await Promise.all([
				writeComposerUiCache(cwd, preferences, {
					symbolPreset: "ascii",
					colorBlindMode: true,
					darkTheme: "dark",
					lightTheme: "light",
				}),
				writeComposerRecentSessionsCache(cwd, recentSessions),
				writeComposerLspCache(cwd, lspServers),
				writeComposerStatusCache(cwd, status),
				writeComposerWelcomeCache(cwd, { modelName: "Claude Fable 5", providerName: "anthropic" }),
			]);
=======
	it("round-trips per-project speculation and serves settings-derived rows to projects without their own", () => {
		const project = path.join(root, "project");
		const other = path.join(root, "other");
		const preferences = { ...COMPOSER_DEFAULTS, composerShape: "rail", autocompleteMaxVisible: 7 };
		const theme = { symbolPreset: "ascii" as const, colorBlindMode: true, darkTheme: "dark", lightTheme: "light" };
		const status = statusFor(ThinkingLevel.High);
>>>>>>> theirs — scope `it("round-trips per-project UI, status, recen...`

		const writer = ComposerCache.open(dbPath);
		writer.writeUi(project, preferences, theme);
		writer.writeStatus(project, status);
		writer.close();

		// A separate connection sees everything: the next launch reads what this one wrote.
		const reader = ComposerCache.open(dbPath);
		expect(reader.read(project)).toEqual({ preferences, theme, status });
		// Theme and status follow the user.
		expect(reader.read(other)).toEqual({ preferences, theme, status });
		reader.close();
	});

	it("prefers a project's own status over the last status written elsewhere", () => {
		const cache = ComposerCache.open(dbPath);
		cache.writeStatus(path.join(root, "a"), statusFor(ThinkingLevel.Low));
		cache.writeStatus(path.join(root, "b"), statusFor(ThinkingLevel.High));

		expect(cache.read(path.join(root, "a")).status?.statusLine.thinkingLevel).toBe(ThinkingLevel.Low);
		expect(cache.read(path.join(root, "fresh")).status?.statusLine.thinkingLevel).toBe(ThinkingLevel.High);
		cache.close();
	});

	it("skips write transactions for identical payloads", () => {
		const project = path.join(root, "project");
		const cache = ComposerCache.open(dbPath);
		const observer = new Database(dbPath, { readonly: true });
		// data_version moves only when another connection commits a change.
		const dataVersion = () => observer.query<{ data_version: number }, []>("PRAGMA data_version").get()?.data_version;
		const statementRuns = vi.spyOn(Statement.prototype, "run");
		const transactions = vi.spyOn(Database.prototype, "transaction");
		try {
			cache.writeStatus(project, statusFor(ThinkingLevel.High));
			const written = dataVersion();
			statementRuns.mockClear();
			transactions.mockClear();

			// Same connection: nothing reaches SQLite.
			cache.writeStatus(project, statusFor(ThinkingLevel.High));
			// Next launch: values learned by read() are not written back either.
			const next = ComposerCache.open(dbPath);
			next.read(project);
			next.writeStatus(project, statusFor(ThinkingLevel.High));
			expect(statementRuns).not.toHaveBeenCalled();
			expect(transactions).not.toHaveBeenCalled();

			// Without a prior read, the upsert guard still leaves identical rows untouched.
			const blind = ComposerCache.open(dbPath);
			blind.writeStatus(project, statusFor(ThinkingLevel.High));
			expect(dataVersion()).toBe(written);

			next.writeStatus(project, statusFor(ThinkingLevel.Low));
			expect(dataVersion()).not.toBe(written);
			expect(cache.read(path.join(root, "fresh")).status?.statusLine.thinkingLevel).toBe(ThinkingLevel.Low);
			next.close();
			blind.close();
		} finally {
			statementRuns.mockRestore();
			transactions.mockRestore();
			observer.close();
			cache.close();
		}
	});

	it("drops a store written in an older payload format", async () => {
		const project = path.join(root, "project");
		await fs.mkdir(path.dirname(dbPath), { recursive: true });
		const legacy = new Database(dbPath);
		legacy.run(
			"CREATE TABLE entries (project TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (project, kind)) WITHOUT ROWID",
		);
		legacy.run("INSERT INTO entries VALUES (?, ?, ?)", [
			project,
			"status",
			JSON.stringify(statusFor(ThinkingLevel.High)),
		]);
		legacy.close();

		const cache = ComposerCache.open(dbPath);
		expect(cache.read(project).status).toBeUndefined();
		cache.close();
	});

<<<<<<< ours — scope `it("ignores legacy status snapshots", async (...` in test_suite `composer startup cache`, deleted in theirs (S+F, confidence: low)
// refused_by: statement_fold · collision: none (no common ancestor text)
	it("ignores legacy status snapshots", async () => {
		const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "tau-composer-cache-legacy-status-"));
		const key = Bun.hash.wyhash(path.resolve(cwd)).toString(16).padStart(16, "0");
		const cacheDir = path.join(getComposerCacheDir(), key);
		try {
			await Bun.write(
				path.join(cacheDir, "status.json"),
				JSON.stringify({
					version: 1,
					shape: "band",
					topBorder: { content: "Stale Model | stale-branch | /stale/location", width: 48 },
					bottomLines: ["", "Stale Model | stale-branch | /stale/location"],
				}),
			);

			expect(readComposerStartupCache(cwd).status).toBeUndefined();
		} finally {
			await Promise.all([
				fs.rm(cwd, { recursive: true, force: true }),
				fs.rm(cacheDir, { recursive: true, force: true }),
			]);
		}
	});
=======
>>>>>>> theirs — scope `it("ignores legacy status snapshots", async (...` deleted in theirs

	it("loads XDG_CACHE_HOME from the home .env before the first cache access", async () => {
		if (process.platform === "win32") return;

<<<<<<< ours — scope `it("loads XDG_CACHE_HOME from the home .env b...` in test_suite `composer startup cache` (F, confidence: medium)
// refused_by: statement_fold · collision: `const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-compo…` +4 more
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "tau-composer-cache-dotenv-"));
		const home = path.join(root, "home");
		const xdgCache = path.join(root, "xdg-cache");
		const project = path.join(root, "project");
		try {
			await Promise.all([
				fs.mkdir(home, { recursive: true }),
				fs.mkdir(path.join(xdgCache, "tau"), { recursive: true }),
			]);
			await Bun.write(path.join(home, ".env"), `XDG_CACHE_HOME=${xdgCache}\n`);

			const composerCacheModule = Bun.resolveSync("@tau/tau-tui/prompt/composer-cache", import.meta.dir);
			const script = [
				'import * as path from "node:path";',
				`import { writeComposerWelcomeCache } from ${JSON.stringify(composerCacheModule)};`,
				`const project = ${JSON.stringify(project)};`,
				'await writeComposerWelcomeCache(project, { modelName: "model", providerName: "provider" });',
				'const key = Bun.hash.wyhash(path.resolve(project)).toString(16).padStart(16, "0");',
				`const expected = path.join(${JSON.stringify(xdgCache)}, "tau", "cache", "composer", key, "welcome.json");`,
				"process.stdout.write(String(await Bun.file(expected).exists()));",
			].join("\n");
			const proc = Bun.spawn([process.execPath, "--no-env-file", "--no-install", "--eval", script], {
				cwd: root,
				env: {
					...process.env,
					HOME: home,
					XDG_CACHE_HOME: undefined,
					PI_CODING_AGENT_DIR: undefined,
					TAU_PROFILE: undefined,
					PI_PROFILE: undefined,
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
=======
		const home = path.join(root, "home");
		const xdgCache = path.join(root, "xdg-cache");
		const project = path.join(root, "project");
		await Promise.all([
			fs.mkdir(home, { recursive: true }),
			fs.mkdir(path.join(xdgCache, "omp"), { recursive: true }),
		]);
		await Bun.write(path.join(home, ".env"), `XDG_CACHE_HOME=${xdgCache}\n`);

		const composerCacheModule = Bun.resolveSync("@oh-my-pi/pi-tui/prompt/composer-cache", import.meta.dir);
		const script = [
			'import * as path from "node:path";',
			`import { ComposerCache } from ${JSON.stringify(composerCacheModule)};`,
			"const cache = ComposerCache.open();",
			`cache.writeUi(${JSON.stringify(project)}, {}, {});`,
			"cache.close();",
			`const expected = path.join(${JSON.stringify(xdgCache)}, "omp", "cache", "composer.db");`,
			"process.stdout.write(String(await Bun.file(expected).exists()));",
		].join("\n");
		const proc = Bun.spawn([process.execPath, "--no-env-file", "--no-install", "--eval", script], {
			cwd: root,
			env: {
				...process.env,
				HOME: home,
				XDG_CACHE_HOME: undefined,
				PI_CODING_AGENT_DIR: undefined,
				OMP_PROFILE: undefined,
				PI_PROFILE: undefined,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
>>>>>>> theirs — scope `it("loads XDG_CACHE_HOME from the home .env b...`

		expect(exitCode, stderr).toBe(0);
		expect(stdout).toBe("true");
	});
});
