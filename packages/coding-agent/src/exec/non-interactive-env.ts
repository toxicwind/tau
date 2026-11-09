import { existsSync } from "node:fs";
import { $which } from "@tau/tau-utils";

/** Portable command that rejects credential prompts without assuming an FHS layout. */
export const REJECT_PROMPT_COMMAND = $which("false") ?? "false";

export const NON_INTERACTIVE_ENV: Readonly<Record<string, string>> = {
	// Disable pagers so commands don't block on interactive views.
	PAGER: "cat",
	GIT_PAGER: "cat",
	MANPAGER: "cat",
	SYSTEMD_PAGER: "cat",
	BAT_PAGER: "cat",
	DELTA_PAGER: "cat",
	GH_PAGER: "cat",
	GLAB_PAGER: "cat",
	PSQL_PAGER: "cat",
	MYSQL_PAGER: "cat",
	AWS_PAGER: "",
	HOMEBREW_PAGER: "cat",
	LESS: "FRX",
	// Disable terminal features that can block the process.
	TERM: "dumb",
	NO_COLOR: "1",
	PYTHONUNBUFFERED: "1",
	// Disable editor and terminal credential prompts.
	GIT_EDITOR: "true",
	VISUAL: "true",
	EDITOR: "true",
	GIT_TERMINAL_PROMPT: "0",
	// A config-file `sequence.editor` outranks GIT_EDITOR and would block `git rebase -i`.
	GIT_SEQUENCE_EDITOR: "true",
	// Git Credential Manager GUI/browser auth dialogs ignore GIT_TERMINAL_PROMPT.
	GCM_INTERACTIVE: "never",
	SSH_ASKPASS: REJECT_PROMPT_COMMAND,
	CI: "true",
	AGENT: "1",
	// Package manager defaults for unattended execution.
	npm_config_yes: "true",
	npm_config_update_notifier: "false",
	npm_config_fund: "false",
	npm_config_audit: "false",
	npm_config_progress: "false",
	PNPM_DISABLE_SELF_UPDATE_CHECK: "true",
	PNPM_UPDATE_NOTIFIER: "false",
	YARN_ENABLE_TELEMETRY: "0",
	YARN_ENABLE_PROGRESS_BARS: "0",
	// Cross-language/tooling non-interactive defaults.
	CARGO_TERM_PROGRESS_WHEN: "never",
	DEBIAN_FRONTEND: "noninteractive",
	PIP_NO_INPUT: "1",
	PIP_DISABLE_PIP_VERSION_CHECK: "1",
	TF_INPUT: "0",
	TF_IN_AUTOMATION: "1",
	GH_PROMPT_DISABLED: "1",
	COMPOSER_NO_INTERACTION: "1",
	CLOUDSDK_CORE_DISABLE_PROMPTS: "1",
	// Tiktoken offline cache and token-budget awareness
	TIKTOKEN_CACHE_DIR: `${process.env.HOME ?? "/home/toxic"}/.cache/tiktoken`,
};

/**
 * Locale pinned for agent commands: byte-order collation, `C` numbers, dates,
 * and English messages like `C`, but UTF-8 text, which `C` would split into bytes.
 */
const AGENT_LOCALE = "C.UTF-8";

/** Python stdio defaults for Windows, where the console code page is not UTF-8. */
const WINDOWS_PYTHON_UTF8_ENV: Readonly<Record<string, string>> = {
	PYTHONIOENCODING: "utf-8",
	PYTHONUTF8: "1",
};

function hasEnvValue(
	env: Record<string, string | undefined> | undefined,
	key: string,
	platform: NodeJS.Platform,
): boolean {
	if (!env) return false;
	if (platform !== "win32") return env[key] !== undefined;

	for (const [existingKey, value] of Object.entries(env)) {
		if (value !== undefined && existingKey.toLowerCase() === key.toLowerCase()) {
			return true;
		}
	}
	return false;
}

function hasEnvGroupValue(
	env: Record<string, string | undefined> | undefined,
	group: Readonly<Record<string, string>>,
	platform: NodeJS.Platform,
): boolean {
	for (const key in group) {
		if (hasEnvValue(env, key, platform)) return true;
	}
	return false;
}

function hasLocaleEnvValue(env: Record<string, string | undefined> | undefined, platform: NodeJS.Platform): boolean {
	if (!env) return false;
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) continue;
		const normalizedKey = platform === "win32" ? key.toUpperCase() : key;
		if (normalizedKey === "LANG" || normalizedKey.startsWith("LC_")) return true;
	}
	return false;
}

/** Copy of the base env with `CI` removed, for the `PI_BASH_NO_CI` opt-out. */
function withoutCI(env: Readonly<Record<string, string>>): Record<string, string> {
	const { CI: _ci, ...rest } = env;
	return rest;
}

/** Options for {@link buildNonInteractiveEnv}. */
export interface NonInteractiveEnvOptions {
	/** Env the child inherits from the launcher. */
	baseEnv?: Record<string, string | undefined>;
	platform?: NodeJS.Platform;
	/** Keep the inherited locale instead of pinning {@link AGENT_LOCALE}: user-typed `!` commands. */
	inheritLocale?: boolean;
}

/** Builds the per-command environment for non-interactive child processes. */
export function buildNonInteractiveEnv(
	overrides?: Record<string, string>,
	{ baseEnv = Bun.env, platform = process.platform, inheritLocale = false }: NonInteractiveEnvOptions = {},
): Record<string, string> {
	// `PI_BASH_NO_CI` (and its legacy alias) opts out of the automatic `CI=true`
	// injection. Mirrors the session-env gate in `procmgr.ts` so the opt-out
	// reaches the per-command env, which otherwise overrides the session value.
// refused_by: merge_ladder_exhausted · collision: `return overrides ? { ...base, ...overrides } : base;` +1 more
	const base =
		baseEnv.PI_BASH_NO_CI || baseEnv.CLAUDE_BASH_NO_CI ? withoutCI(NON_INTERACTIVE_ENV) : NON_INTERACTIVE_ENV;

	// Tiktoken & CLI auto-shim: ensure ~/.local/bin is on PATH and the tiktoken
	// offline cache is set. Do NOT inject a foreign Python's site-packages into
	// PYTHONPATH:
	//
	//   * It is the nvm/NODE_PATH anti-pattern — a version-manager must hand out
	//     the right interpreter via PATH, never leak another interpreter's
	//     site-packages into every child process.
	//   * Every private venv / uvx MCP server relies on an *isolated*
	//     site-packages. Merge the mise 3.14 site-packages in and ABIs collide
	//     (`pydantic_core` compiled for one CPython build resolving under
	//     another -> `ImportError: cannot import name 'ArgsKwargs'`), crashing
	//     ~80 MCP servers.
	//   * The active `python` on PATH (mise shim) already has tiktoken when
	//     needed; token tracking here only needs TIKTOKEN_CACHE_DIR.
	//   A caller/venv that legitimately sets PYTHONPATH keeps it untouched.
	const home = baseEnv.HOME ?? process.env.HOME ?? "/home/toxic";
	const localBin = `${home}/.local/bin`;
	const existingPath = overrides?.PATH ?? baseEnv.PATH ?? process.env.PATH ?? "";
	const pathWithLocalBin = existingPath.split(":").includes(localBin) ? existingPath : `${localBin}:${existingPath}`;

	// Kairos autoshim (AGENTS.md §3.2 / estate doctrine): agent bash shells are
	// non-login, so `.bash_profile`'s `export BASH_ENV=…shim.sh` never reaches
	// them. Inject BASH_ENV here so every non-interactive exec shell sources
	// the kairos shim (DEBUG trap, head/tail/timeout guards, 4s run-fast race).
	// Only when the shim file actually exists; the shim self-selects
	// interactive→idle / non-interactive→enforce, so interactive shells stay
	// unhijacked while agent shells get enforcement. Never allow an overlay to
	// force enforcement off (KAIROS_ENFORCE=0) for agent shells.
	const kairosShim = `${home}/pens/olympus/products/kairos/shim.sh`;
	const hasKairosShim = process.platform === "win32" ? false : existsSync(kairosShim);
	const kairosOverrides: Record<string, string> = {};
	if (hasKairosShim) {
		// BASH_ENV only — NOT ENV. bash reads BASH_ENV for non-interactive
		// shells; ENV is read by sh/dash and the shim is bash syntax (`[[`,
		// DEBUG trap, function wrappers), so ENV would break `sh -c` children.
		kairosOverrides.BASH_ENV = kairosShim;
		kairosOverrides.KAIROS_ENFORCE = "1";
	}

	const shimOverrides: Record<string, string> = {
		...overrides,
		PATH: pathWithLocalBin,
		TIKTOKEN_CACHE_DIR: overrides?.TIKTOKEN_CACHE_DIR ?? `${home}/.cache/tiktoken`,
		...kairosOverrides,
	};

	if (platform !== "win32") {
		return { ...base, ...shimOverrides };
	}

	const env: Record<string, string> = { ...base };
	for (const group of WINDOWS_UTF8_ENV_DEFAULT_GROUPS) {
		if (hasEnvGroupValue(baseEnv, group, platform) || hasEnvGroupValue(shimOverrides, group, platform)) {
			continue;
		}
		for (const [key, value] of group) {
			env[key] = value;
		}
	}
	return { ...env, ...shimOverrides };
}
