import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Model/config liveness loop.
 *
 * The failure this exists for: an undefined `modelRoles` entry does NOT fall
 * back to `default`. It falls through to `priority.json`'s `MODEL_PRIO.<role>`
 * list, whose every entry is a paid model on a provider the account usually
 * has no working credential for. A role left unset therefore fails silently
 * and expensively, once per role use per session.
 *
 * Two passes:
 *   1. Completeness — every role the engine knows about vs. the config.
 *   2. Liveness — every concrete model reference, probed for real.
 */

export type ModelRef = {
	/** Where the reference came from, e.g. "modelRoles.default" or "fallbackChains.web[3]". */
	origin: string;
	/** `provider/model` as written in config. */
	ref: string;
	provider: string;
	model: string;
};

export type ProbeVerdict =
	| "ok"
	| "no-credits"
	| "not-found"
	| "no-auth"
	| "rate-limited"
	| "timeout"
	| "error"
	/**
	 * Not an openrouter chat model, so an openrouter probe would say nothing
	 * true about it. `web/exa` is a search provider served by the engine's own
	 * web tool; POSTing it to `/chat/completions` returns `400 exa is not a
	 * valid model ID`, which reads as a broken config entry but is not one.
	 */
	| "not-chat";

/**
 * Provider prefixes the engine serves itself rather than through an
 * OpenAI-compatible chat endpoint. A chat probe against these is a category
 * error, so they are reported instead of probed.
 */
export const NON_CHAT_PROVIDERS: ReadonlySet<string> = new Set(["web", "search", "embedding"]);

export type ProbeResult = {
	ref: string;
	verdict: ProbeVerdict;
	status: number;
	latencyMs: number;
	detail: string;
};

export type UndefinedRole = {
	role: string;
	/** The paid model it silently resolves to. */
	fallsThroughTo: string | null;
};

export type AuditReport = {
	configPath: string;
	references: ModelRef[];
	probes: ProbeResult[];
	undefinedRoles: UndefinedRole[];
	/** Deduplicated verdicts keyed by ref. */
	byRef: Map<string, ProbeResult>;
};

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/** The engine's authoritative role list, read from source rather than hardcoded. */
export const MODEL_BROWSER_SRC =
	"/home/toxic/estate/ranch/stockyard/tau/packages/tui/src/overlays/model-browser.ts";
export const PRIORITY_JSON =
	"/home/toxic/estate/ranch/stockyard/tau/packages/coding-agent/src/priority.json";

function fail(message: string): never {
	throw new Error(`model-audit: ${message}`);
}

/**
 * Pull `MODEL_ROLE_IDS` out of the engine source. Fails loud rather than
 * falling back to a stale copy, because a stale list silently stops
 * reporting roles that the engine has since added.
 *
 * The type annotation is part of the match, not decoration: the engine declares
 * `export const MODEL_ROLE_IDS: ModelRole[] = [`, so a pattern that goes
 * straight from the name to `=` finds nothing and the loop dies on its first
 * real run.
 */
export function parseModelRoleIds(source: string): string[] {
	const match = /MODEL_ROLE_IDS\s*(?::[^=\n]+)?=\s*\[([^\]]*)\]/.exec(source);
	const body = match?.[1];
	if (body === undefined) fail("MODEL_ROLE_IDS not found in engine source");
	const ids = body
		.split(",")
		.map((raw) => raw.trim().replace(/^["']|["']$/g, ""))
		.filter((id) => id.length > 0);
	if (ids.length === 0) fail("MODEL_ROLE_IDS parsed to an empty list");
	return ids;
}

export type PriorityIndex = Record<string, string[]>;

export function readPriorityIndex(path: string = PRIORITY_JSON): PriorityIndex {
	if (!existsSync(path)) fail(`priority.json not found at ${path}`);
	return JSON.parse(readFileSync(path, "utf8")) as PriorityIndex;
}

/** Every concrete model reference in a parsed config tree. */
export function collectReferences(config: Record<string, unknown>): ModelRef[] {
	const refs: ModelRef[] = [];
	const push = (origin: string, raw: unknown): void => {
		if (typeof raw !== "string" || raw.length === 0) return;
		const slash = raw.indexOf("/");
		if (slash <= 0) return;
		refs.push({
			origin,
			ref: raw,
			provider: raw.slice(0, slash),
			model: raw.slice(slash + 1),
		});
	};

	const roles = config.modelRoles;
	if (roles && typeof roles === "object") {
		for (const [role, value] of Object.entries(roles as Record<string, unknown>)) {
			push(`modelRoles.${role}`, value);
		}
	}

	const subagents = config.subagents as Record<string, unknown> | undefined;
	push("subagents.defaultModel", subagents?.defaultModel);

	const retry = config.retry as Record<string, unknown> | undefined;
	const chains = retry?.fallbackChains as Record<string, unknown> | undefined;
	if (chains) {
		for (const [chainKey, chain] of Object.entries(chains)) {
			if (!Array.isArray(chain)) continue;
			for (const [index, entry] of chain.entries()) {
				push(`fallbackChains.${chainKey}[${index}]`, entry);
			}
		}
	}

	return refs;
}

/** Roles the engine knows about that the config leaves unset. */
export function findUndefinedRoles(
	roleIds: string[],
	modelRoles: Record<string, unknown>,
	priority: PriorityIndex,
): UndefinedRole[] {
	return roleIds
		.filter((role) => modelRoles[role] === undefined)
		.map((role) => ({ role, fallsThroughTo: priority[role]?.[0] ?? null }));
}

function classify(status: number, body: string): { verdict: ProbeVerdict; detail: string } {
	const detail = body.replace(/\s+/g, " ").trim().slice(0, 160);
	if (status >= 200 && status < 300) return { verdict: "ok", detail };
	if (status === 401 || status === 403) return { verdict: "no-auth", detail };
	if (status === 402) return { verdict: "no-credits", detail };
	if (status === 404) return { verdict: "not-found", detail };
	if (status === 429) return { verdict: "rate-limited", detail };
	return { verdict: "error", detail };
}

export type ProbeOptions = {
	timeoutMs: number;
	apiKey: string;
	baseUrl?: string;
};

export const DEFAULT_PROBE_TIMEOUT_MS = 20_000;

/**
 * Probe one `provider/model` for real. A missing key is reported as
 * `no-auth` without a request rather than as a misleading 404.
 */
export async function probeModel(ref: ModelRef, options: ProbeOptions): Promise<ProbeResult> {
	if (NON_CHAT_PROVIDERS.has(ref.provider)) {
		return {
			ref: ref.ref,
			verdict: "not-chat",
			status: 0,
			latencyMs: 0,
			detail: `${ref.provider}/* is served by the engine, not an openrouter chat endpoint`,
		};
	}
	if (!options.apiKey) {
		return {
			ref: ref.ref,
			verdict: "no-auth",
			status: 0,
			latencyMs: 0,
			detail: "no API key resolved for this provider",
		};
	}
	const base = options.baseUrl ?? OPENROUTER_BASE;
	const started = Date.now();
	try {
		const response = await fetch(`${base}/chat/completions`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${options.apiKey}`,
			},
			body: JSON.stringify({
				model: ref.model,
				messages: [{ role: "user", content: "Reply with the single character: 1" }],
				max_tokens: 4,
				temperature: 0,
			}),
			signal: AbortSignal.timeout(options.timeoutMs),
		});
		const body = await response.text();
		const { verdict, detail } = classify(response.status, body);
		return { ref: ref.ref, verdict, status: response.status, latencyMs: Date.now() - started, detail };
	} catch (error) {
		const name = (error as { name?: string }).name ?? "";
		if (name === "TimeoutError" || name === "AbortError") {
			return {
				ref: ref.ref,
				verdict: "timeout",
				status: 0,
				latencyMs: Date.now() - started,
				detail: `no response within ${options.timeoutMs}ms`,
			};
		}
		return {
			ref: ref.ref,
			verdict: "error",
			status: 0,
			latencyMs: Date.now() - started,
			detail: String(error).slice(0, 160),
		};
	}
}

export const PROBE_CONCURRENCY = 4;

export type RunAuditOptions = {
	configPath: string;
	/**
	 * Defaults to `resolveApiKey()`. This was a required field once, and every
	 * caller who forgot it got a clean report in which all 34 models read
	 * "no API key resolved" — a fleet of false negatives that looks exactly
	 * like a credential outage. An omitted key is now resolved, not ignored.
	 */
	apiKey?: string;
	/** Defaults to the engine's own role list in this checkout. */
	roleSourcePath?: string;
	/** Defaults to the engine's own priority table in this checkout. */
	priorityPath?: string;
	timeoutMs?: number;
	baseUrl?: string;
	concurrency?: number;
};

/** Probe every distinct reference. Duplicates are probed once, not once per origin. */
export async function runAudit(options: RunAuditOptions): Promise<AuditReport> {
	if (!existsSync(options.configPath)) fail(`config not found at ${options.configPath}`);
	const config = Bun.YAML.parse(readFileSync(options.configPath, "utf8")) as Record<string, unknown>;
	const roleSourcePath = options.roleSourcePath ?? MODEL_BROWSER_SRC;
	const priorityPath = options.priorityPath ?? PRIORITY_JSON;
	const apiKey = options.apiKey ?? resolveApiKey();
	const roleIds = parseModelRoleIds(readFileSync(roleSourcePath, "utf8"));
	const priority = readPriorityIndex(priorityPath);
	const references = collectReferences(config);
	const modelRoles = (config.modelRoles ?? {}) as Record<string, unknown>;
	const undefinedRoles = findUndefinedRoles(roleIds, modelRoles, priority);

	const distinct = [...new Map(references.map((r) => [r.ref, r])).values()];
	const concurrency = options.concurrency ?? PROBE_CONCURRENCY;
	const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
	const probes: ProbeResult[] = [];
	for (let index = 0; index < distinct.length; index += concurrency) {
		const batch = distinct.slice(index, index + concurrency);
		probes.push(
			...(await Promise.all(
				batch.map((ref) => probeModel(ref, { apiKey, timeoutMs, baseUrl: options.baseUrl })),
			)),
		);
	}

	return {
		configPath: options.configPath,
		references,
		probes,
		undefinedRoles,
		byRef: new Map(probes.map((p) => [p.ref, p])),
	};
}

/** Human-readable table. Dead references first — those are the ones to fix. */
export function formatReport(report: AuditReport): string {
	const lines: string[] = [];
	lines.push(`config: ${report.configPath}`);
	lines.push(`references: ${report.references.length} (${report.probes.length} distinct)`);

	if (report.undefinedRoles.length > 0) {
		lines.push("");
		lines.push(`UNDEFINED ROLES: ${report.undefinedRoles.length} — these do NOT fall back to default:`);
		for (const { role, fallsThroughTo } of report.undefinedRoles) {
			lines.push(
				fallsThroughTo
					? `  ${role.padEnd(14)} -> ${fallsThroughTo}  (from priority.json)`
					: `  ${role.padEnd(14)} -> no priority.json entry`,
			);
		}
	}

	// Counted apart from the dead: a `web/*` entry failing a chat probe is a
	// category error in this audit, not a broken config line, and lumping the
	// two together buries the real failures under noise.
	const dead = report.probes.filter((p) => p.verdict !== "ok" && p.verdict !== "not-chat");
	lines.push("");
	lines.push(dead.length === 0 ? "ALL REFERENCES LIVE" : `DEAD OR DEGRADED: ${dead.length}`);
	for (const probe of [...dead].sort((a, b) => a.ref.localeCompare(b.ref))) {
		lines.push(`  ${probe.verdict.padEnd(13)} ${probe.status.toString().padStart(3)} ${probe.ref}`);
		lines.push(`                ${probe.detail}`);
	}

	const skipped = report.probes.filter((p) => p.verdict === "not-chat");
	if (skipped.length > 0) {
		lines.push("");
		lines.push(`NOT PROBED (not chat endpoints): ${skipped.length}`);
		for (const probe of skipped) lines.push(`  ${probe.ref}  ${probe.detail}`);
	}

	lines.push("");
	lines.push("per-reference:");
	for (const ref of report.references) {
		const probe = report.byRef.get(ref.ref);
		const origins = report.references.filter((r) => r.ref === ref.ref).map((r) => r.origin);
		const verdict = probe ? probe.verdict : "unprobed";
		const ms = probe ? `${probe.latencyMs}ms` : "";
		lines.push(`  ${verdict.padEnd(13)} ${ref.ref.padEnd(58)} ${ms.padStart(7)}  ${origins.join(", ")}`);
	}
	return lines.join("\n");
}

/**
 * Where the config the engine actually reads lives.
 *
 * `$PI_CONFIG_DIR` is the trap: it names `~/.tau`, whose `config.yml` is a
 * 599-line file the engine never loads for settings. `settings.ts:183` puts
 * config.yml in the AGENT directory and `dirs.ts` joins
 * `PI_CODING_AGENT_DIR` to find it, so the live file is
 * `~/.tau/agent/config.yml`. Auditing the other one reports a clean config
 * while every role is dead.
 */
export function resolveConfigPath(explicit?: string): string {
	if (explicit) return resolve(explicit);
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (agentDir) {
		const candidate = join(agentDir, "config.yml");
		if (existsSync(candidate)) return candidate;
	}
	const estateScriptsAgentConfig = join(homedir(), "estate-scripts", "config", "tau", "agent", "config.yml");
	if (existsSync(estateScriptsAgentConfig)) return estateScriptsAgentConfig;
	fail(
		`no agent config.yml found; tried $PI_CODING_AGENT_DIR and ${estateScriptsAgentConfig}. Note: $PI_CONFIG_DIR/config.yml is NOT loaded for settings.`,
	);
}

/** Resolve a provider key from the environment the way the engine does. */
export function resolveApiKey(env: NodeJS.ProcessEnv = process.env): string {
	return env.OPENROUTER_API_KEY ?? env.OPENROUTER_API_KEY_FREE ?? env.ANTHROPIC_API_KEY ?? "";
}

export function describeRun(report: AuditReport): string {
	const ok = report.probes.filter((p) => p.verdict === "ok").length;
	return `audited ${report.references.length} refs: ${ok} live, ${report.probes.length - ok} dead, ${report.undefinedRoles.length} undefined roles`;
}

export const TOOL_ORIGIN_HINT = (() => {
	try {
		return basename(dirname(resolveConfigPath()));
	} catch {
		return "unknown";
	}
})();
