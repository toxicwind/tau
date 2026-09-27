import * as fs from "node:fs";
import { statSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseEnv } from "node:util";
import { getAgentDir, getConfigRootDir, getProjectDir, refreshDirsFromEnv } from "./dirs";
export * from "./worker-host";

// ─── MONADIC ERROR HANDLING ───────────────────────────────────────
export type Try<T, E = Error> =
	| { readonly _tag: "Success"; readonly value: T }
	| { readonly _tag: "Failure"; readonly error: E };

export const Success = <T>(value: T): Try<T, never> => ({ _tag: "Success", value });
export const Failure = <E>(error: E): Try<never, E> => ({ _tag: "Failure", error });

function suppress<T>(error: T): void {}

// ─── ENVIRONMENT SERVICES ─────────────────────────────────────────
export interface EnvService {
	readonly values: Readonly<Record<string, string>>;
	get(key: string): string | undefined;
	require(key: string): string;
	tryRequire(key: string): Try<string>;
	has(key: string): boolean;
}

export function createEnvService(opts: {
	base: Record<string, string | undefined>;
	layers: ReadonlyArray<Record<string, string>>;
}): EnvService {
	const merged: Record<string, string> = {};
	for (const layer of [...opts.layers].reverse()) {
		for (const [k, v] of Object.entries(layer)) {
			if (!(k in merged) && opts.base[k] === undefined) merged[k] = v;
		}
	}
	for (const [k, v] of Object.entries(opts.base)) {
		if (v !== undefined) merged[k] = v;
	}
	return Object.freeze({
		values: Object.freeze(merged),
		get: (k: string) => merged[k],
		require: (k: string) => {
			const v = merged[k];
			if (v === undefined) throw new Error(`Missing required env: ${k}`);
			return v;
		},
		tryRequire: (k: string) => {
			const v = merged[k];
			return v !== undefined ? Success(v) : Failure(new Error(`Missing required env: ${k}`));
		},
		has: (k: string) => k in merged,
	});
}

export interface EnvReader {
	get(key: string): string | undefined;
	require(key: string): string;
	tryRequire(key: string): Try<string>;
	or(key: string, fallback: string): string;
}

export function createEnvReader(source: Record<string, string | undefined>): EnvReader {
	return {
		get: k => source[k],
		require: k => {
			const v = source[k];
			if (v === undefined) throw new Error(`Missing required environment variable: ${k}`);
			return v;
		},
		tryRequire: k => {
			const v = source[k];
			return v !== undefined ? Success(v) : Failure(new Error(`Missing env: ${k}`));
		},
		or: (k, fallback) => source[k] ?? fallback,
	};
}

// ─── VALIDATION & SANITIZATION ────────────────────────────────────
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidEnvName(name: string): boolean {
	return ENV_NAME_RE.test(name);
}
export function isSafeEnvName(name: string): boolean {
	return name.length > 0 && !name.includes("=") && !name.includes("\0");
}
export function isSafeEnvValue(value: string): boolean {
	return !value.includes("\0");
}
export function isMacosMallocStackLoggingEnvName(name: string): boolean {
	return name === "MallocStackLogging" || name === "MallocStackLoggingNoCompact";
}
export function isWsl(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
	return platform === "linux" && Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
}

const DANGEROUS_ENV_NAMES = new Set<string>([
	"NODE_OPTIONS",
	"NODE_PATH",
	"BUN_INSPECT",
	"BUN_OPTIONS",
	"LD_PRELOAD",
	"LD_LIBRARY_PATH",
	"DYLD_INSERT_LIBRARIES",
	"DYLD_LIBRARY_PATH",
	"PYTHONSTARTUP",
	"PYTHONPATH",
	"PYTHONHOME",
	"PERL5OPT",
	"PERL5LIB",
	"RUBYOPT",
	"RUBYLIB",
	"JAVA_TOOL_OPTIONS",
	"_JAVA_OPTIONS",
	"GIT_CONFIG_GLOBAL",
	"GIT_CONFIG_SYSTEM",
	"SSH_AUTH_SOCK",
	"SSH_AGENT_PID",
]);

const DOTENV_FORBIDDEN_NAMES = new Set<string>(["PATH"]);

export function isDotenvForbiddenName(name: string): boolean {
	if (DOTENV_FORBIDDEN_NAMES.has(name)) return true;
	return process.platform === "win32" && DOTENV_FORBIDDEN_NAMES.has(name.toUpperCase());
}
export function isDangerousEnvName(name: string): boolean {
	if (DANGEROUS_ENV_NAMES.has(name)) return true;
	return process.platform === "win32" && DANGEROUS_ENV_NAMES.has(name.toUpperCase());
}

const GIT_REPO_LOCATION_ENV_NAMES = [
	"GIT_DIR",
	"GIT_COMMON_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
] as const;

export function stripGitRepoLocationEnv(
	env: Record<string, string>,
	platform: NodeJS.Platform = process.platform,
): void {
	if (platform !== "win32") {
		for (const name of GIT_REPO_LOCATION_ENV_NAMES) delete env[name];
		return;
	}
	const folded = new Set<string>(GIT_REPO_LOCATION_ENV_NAMES.map(n => n.toLowerCase()));
	for (const key of Object.keys(env)) {
		if (folded.has(key.toLowerCase())) delete env[key];
	}
}

export function filterProcessEnv(env: Record<string, string | undefined>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (
			value === undefined ||
			!isSafeEnvName(key) ||
			isDangerousEnvName(key) ||
			isMacosMallocStackLoggingEnvName(key) ||
			!isSafeEnvValue(value)
		)
			continue;
		result[key] = value;
	}
	return result;
}

// ─── TRUE LAUNCH ENV RESOLUTION ───────────────────────────────────

function readLaunchEnv(): ReadonlyMap<string, string> | undefined {
	if (process.platform === "linux") {
		try {
			const values = new Map<string, string>();
			for (const entry of fs.readFileSync("/proc/self/environ", "utf8").split("\0")) {
				const separator = entry.indexOf("=");
				if (separator > 0) values.set(entry.slice(0, separator), entry.slice(separator + 1));
			}
			return values;
		} catch (error) {
			suppress(error);
		}
	}
	if (!process.execArgv.includes("--no-env-file")) return undefined;
	const values = new Map<string, string>();
	for (const key in Bun.env) {
		const value = Bun.env[key];
		if (value !== undefined) values.set(key, value);
	}
	return values;
}

const launchEnvValues = readLaunchEnv();
const projectEnvNamesLoadedByOmp = new Set<string>();
const PROVENANCE = Symbol("env-provenance");

export function filterChildShellEnvInternal(
	env: Record<string, string | undefined>,
	cwd: string,
	onDotenvValue?: (value: string) => void,
): Record<string, string> {
	const runtimeLaunchEnvValues = env === Bun.env || env === process.env ? launchEnvValues : undefined;
	const result = filterProcessEnv(env);

	const projectEnv = parseEnvFile(path.join(cwd, ".env"));
	const launchNodeEnv = runtimeLaunchEnvValues ? runtimeLaunchEnvValues.get("NODE_ENV") : env.NODE_ENV;
	const nodeEnvName = `.env.${launchNodeEnv || "development"}`;
	const modeEnv = parseEnvFile(path.join(cwd, nodeEnvName));
	const localEnv = parseEnvFile(path.join(cwd, ".env.local"));
	const modeLocalEnv = parseEnvFile(path.join(cwd, `${nodeEnvName}.local`));

	const launchEnv = { ...projectEnv, ...modeEnv, ...localEnv, ...modeLocalEnv };
	const expandedLaunchEnv = {
		...expandDotenvValues(projectEnv, result),
		...expandDotenvValues(modeEnv, result),
		...expandDotenvValues(localEnv, result),
		...expandDotenvValues(modeLocalEnv, result),
	};

	let fallbackLaunchEnv: Record<string, string> | undefined;
	let expandedFallbackLaunchEnv: Record<string, string> | undefined;

	if (!runtimeLaunchEnvValues && nodeEnvName !== ".env.development") {
		const fallbackModeEnv = parseEnvFile(path.join(cwd, ".env.development"));
		const fallbackModeLocalEnv = parseEnvFile(path.join(cwd, ".env.development.local"));
		const candidate = { ...projectEnv, ...fallbackModeEnv, ...localEnv, ...fallbackModeLocalEnv };
		const expandedCandidate = {
			...expandDotenvValues(projectEnv, result),
			...expandDotenvValues(fallbackModeEnv, result),
			...expandDotenvValues(localEnv, result),
			...expandDotenvValues(fallbackModeLocalEnv, result),
		};
		if (candidate.NODE_ENV === env.NODE_ENV || expandedCandidate.NODE_ENV === env.NODE_ENV) {
			fallbackLaunchEnv = candidate;
			expandedFallbackLaunchEnv = expandedCandidate;
		}
	}

	const allLaunchEnv = fallbackLaunchEnv ? { ...launchEnv, ...fallbackLaunchEnv } : launchEnv;

	if (onDotenvValue) {
		for (const key in allLaunchEnv) onDotenvValue(allLaunchEnv[key]!);
		for (const key in expandedLaunchEnv) onDotenvValue(expandedLaunchEnv[key]!);
	}

	for (const key in allLaunchEnv) {
		const launchValue = runtimeLaunchEnvValues?.get(key);
		if (launchValue !== undefined) {
			if (
				result[key] !== launchValue &&
				(result[key] === launchEnv[key] ||
					result[key] === expandedLaunchEnv[key] ||
					result[key] === fallbackLaunchEnv?.[key] ||
					result[key] === expandedFallbackLaunchEnv?.[key])
			) {
				result[key] = launchValue;
			}
			continue;
		}

		if (runtimeLaunchEnvValues || projectEnvNamesLoadedByOmp.has(key)) {
			const value = result[key];
			if (value !== undefined) onDotenvValue?.(value);
			delete result[key];
		} else if (
			result[key] === launchEnv[key] ||
			result[key] === expandedLaunchEnv[key] ||
			result[key] === fallbackLaunchEnv?.[key] ||
			result[key] === expandedFallbackLaunchEnv?.[key]
		) {
			const value = result[key];
			if (value !== undefined) onDotenvValue?.(value);
			delete result[key];
		}
	}

	stripGitRepoLocationEnv(result);
	return result;
}

export function filterChildShellEnv(
	env: Record<string, string | undefined>,
	cwd: string = getProjectDir(),
): Record<string, string> {
	return filterChildShellEnvInternal(env, cwd);
}

export function getDotenvEnvValues(
	cwd: string = getProjectDir(),
	env: Record<string, string | undefined> = process.env,
): string[] {
	const values = new Set<string>();
	filterChildShellEnvInternal(env, cwd, value => values.add(value));
	return [...values];
}

// ─── HIGH-PERFORMANCE INTERPOLATION ───────────────────────────────
const EXPAND_RE = /(?<!\\)\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\})/g;

export function expandDotenvValues(
	values: Record<string, string>,
	env: Record<string, string>,
): Record<string, string> {
	const expanded: Record<string, string> = {};
	for (const [key, raw] of Object.entries(values)) {
		expanded[key] = raw
			.replace(EXPAND_RE, (match, bare, braced, def) => {
				const varName = bare || braced;
				return env[varName] ?? def ?? "";
			})
			.replace(/\\\$/g, "$");
	}
	return expanded;
}

// ─── DOTENV PARSER WITH MT-MEMOIZATION ────────────────────────────
const __parseEnvFileCache = new Map<string, { mtime: number; data: Record<string, string> }>();

export function parseEnvFile(filePath: string): Record<string, string> {
	let mtime = 0;
	try {
		mtime = statSync(filePath).mtimeMs;
	} catch {}

	const cached = __parseEnvFileCache.get(filePath);
	if (cached && cached.mtime === mtime) return cached.data;

	const result: Record<string, string> = {};
	try {
		const parsed = parseEnv(fs.readFileSync(filePath, "utf-8"));
		for (const [key, value] of Object.entries(parsed)) {
			if (
				value !== undefined &&
				isValidEnvName(key) &&
				!isDangerousEnvName(key) &&
				!isDotenvForbiddenName(key) &&
				isSafeEnvValue(value)
			) {
				result[key] = value;
				if (key.startsWith("OMP_")) result[`PI_${key.slice(4)}`] = value;
			}
		}
	} catch {}

	__parseEnvFileCache.set(filePath, { mtime, data: result });
	return result;
}

// ─── SCOPED EXPLICIT RESOURCE MANAGEMENT (TS 5.2+) ────────────────
export function scopedEnv(overrides: Record<string, string | undefined>): Disposable {
	const original: Record<string, string | undefined> = {};
	for (const [k, v] of Object.entries(overrides)) {
		original[k] = process.env[k];
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	return {
		[Symbol.dispose]() {
			for (const [k, v] of Object.entries(original)) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
		},
	};
}

// ─── GLOBAL PROXY EXPORTS ─────────────────────────────────────────
export const $env: Record<string, string> = new Proxy(Bun.env as Record<string, string | undefined>, {
	get(target, prop: string) {
		if (typeof prop !== "string") return Reflect.get(target, prop);
		return target[prop] ?? "";
	},
	set(target, prop, value) {
		throw new Error(`Immutable $env constraint violation. Cannot set ${String(prop)}.`);
	},
}) as Record<string, string>;

export function $pickenv(...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = Bun.env[key]?.trim();
		if (value) return value;
	}
	return undefined;
}

export function $envExact(name: string, env: Record<string, string | undefined> = process.env): string | undefined {
	const value = env[name];
	if (value === undefined) return undefined;
	for (const key in env) {
		if (key === name) return value;
	}
	return undefined;
}

export function $envpos(name: string, defaultValue: number): number {
	const raw = $env[name];
	if (!raw) return defaultValue;
	const parsed = Number.parseInt(raw, 10);
	return Number.isNaN(parsed) || parsed <= 0 ? defaultValue : parsed;
}

// ─── RUNTIME STATE ────────────────────────────────────────────────
const BUN_TEST_ENTRY_PATTERN = /[._](?:test|spec)\.[cm]?[jt]sx?$/;

export function isBunTestRuntime(): boolean {
	if (Bun.env.PI_TEST_RUNTIME === "1") return true;
	const hasTestEnvironment = Bun.env.BUN_ENV === "test" || Bun.env.NODE_ENV === "test";
	return hasTestEnvironment && BUN_TEST_ENTRY_PATTERN.test(Bun.main);
}

let terminalHeadless = isBunTestRuntime();
let interactiveHost = false;

export function isTerminalHeadless(): boolean {
	return terminalHeadless;
}
export function setTerminalHeadless(headless: boolean): boolean {
	const previous = terminalHeadless;
	terminalHeadless = headless;
	return previous;
}

export function isInteractiveHost(): boolean {
	return interactiveHost;
}
export function setInteractiveHost(interactive: boolean): boolean {
	const previous = interactiveHost;
	interactiveHost = interactive;
	return previous;
}

export function getDbBusyTimeoutMs(): number {
	return isInteractiveHost() ? 5000 : 1000;
}
export function isCompiledBinary(): boolean {
	if (process.env.PI_COMPILED || Bun.env.PI_COMPILED) return true;
	const url = import.meta.url;
	return url.includes("$bunfs") || url.includes("~BUN") || url.includes("%7EBUN");
}

const TRUTHY: Record<string, boolean> = {
	"1": true,
	Y: true,
	y: true,
	TRUE: true,
	true: true,
	YES: true,
	yes: true,
	ON: true,
	on: true,
};

export function parseFlag(value: string | undefined, def = false): boolean {
	return value ? TRUTHY[value] === true : def;
}
export function $flag(name: string, def: boolean = false): boolean {
	return parseFlag($env[name], def);
}
