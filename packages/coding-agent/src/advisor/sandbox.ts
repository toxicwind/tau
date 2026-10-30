import * as path from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult } from "@tau/tau-agent-core";
import { ToolError } from "@tau/tau-tui/tools/tool-errors";

/**
 * Advisor write-sandbox contract (2026-10-30 architect directive: tauvisor
 * must be sandboxed — the live advisor previously held write/edit/ast_edit
 * grants with no confinement).
 *
 * Every advisor config resolves to exactly one {@link AdvisorSandbox}:
 * - `read-only` (default when `sandbox` is absent): the advisor holds NO
 *   mutating tools; every write-shaped tool in the grant is stripped at
 *   runtime, so a prompt that says "run no tools" is enforced structurally,
 *   not by asking nicely.
 * - `confined` (`sandbox: <absolute dir>`): the path-scoped mutating tools
 *   stay granted but every write target must resolve under the sandbox dir.
 *   Anything else — the live tree, `..` escapes, prefix-colliding siblings —
 *   is rejected with a ToolError naming the rule. Non-path-scoped mutators
 *   (eval/task/computer/debug) are still stripped: they fork/exec and can
 *   reach any path, so no directory confine could bound them.
 */
export type AdvisorSandbox = { mode: "read-only"; dir?: undefined } | { mode: "confined"; dir: string };

/** The mutating tools a read-only advisor must never hold. */
export const ADVISOR_MUTATING_TOOLS: ReadonlySet<string> = new Set([
	"write",
	"edit",
	"ast_edit",
	"eval",
	"task",
	"computer",
	"debug",
]);

/**
 * Mutating tools whose effect is a file path and can therefore be confined to
 * a sandbox directory. The exec/fork tools are deliberately absent: they
 * escape any directory bound.
 */
export const ADVISOR_PATH_CONFINABLE_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "ast_edit"]);

/**
 * Parse the `sandbox:` field of one advisor entry.
 * Absent → read-only (safe default). `read-only` → read-only. An absolute
 * path → confined. Anything else is a config error the caller surfaces as a
 * warning (never a crash).
 */
export function classifyAdvisorSandbox(raw: string | undefined): AdvisorSandbox {
	if (raw === undefined || raw === "" || raw === "read-only") {
		return { mode: "read-only" };
	}
	if (path.isAbsolute(raw)) {
		return { mode: "confined", dir: raw };
	}
	throw new ToolError(
		`Advisor sandbox must be "read-only" or an absolute directory (got ${JSON.stringify(raw)})`,
	);
}

/**
 * Resolve a write target against a sandbox, or throw.
 * Read-only sandboxes deny everything with a read-only error; confined
 * sandboxes require the resolved absolute path to be a strict descendant of
 * the sandbox dir (the lexical check rejects `..` escapes and prefix
 * collisions like `/tmp/sbx` vs `/tmp/sbx-evil`).
 */
export function confineAdvisorWriteTarget(target: string, sandbox: AdvisorSandbox): string {
	const resolved = path.resolve(target);
	if (sandbox.mode === "read-only") {
		throw new ToolError(
			`Advisor write denied: "${target}" — this advisor is read-only (sandbox: read-only).`,
		);
	}
	const root = path.resolve(sandbox.dir);
	const relative = path.relative(root, resolved);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new ToolError(
			`Advisor write denied: "${target}" is outside the advisor sandbox (${root}).`,
		);
	}
	return resolved;
}

/**
 * Filter a granted tool list against a sandbox:
 * - read-only strips every mutating tool;
 * - confined keeps the path-scoped mutators (write/edit/ast_edit) — their
 *   targets are confined at call time — and strips the exec/fork ones.
 * Non-mutating tools always survive.
 */
export function applySandboxToToolGrant(
	tools: readonly string[] | undefined,
	sandbox: AdvisorSandbox,
): string[] | undefined {
	if (tools === undefined) return undefined;
	if (sandbox.mode === "confined") {
		return tools.filter(name => !ADVISOR_MUTATING_TOOLS.has(name) || ADVISOR_PATH_CONFINABLE_TOOLS.has(name));
	}
	return tools.filter(name => !ADVISOR_MUTATING_TOOLS.has(name));
}

/**
 * Wrap one granted tool so its path arguments are checked against the sandbox
 * before the real execute runs. Only the path-scoped mutators need wrapping;
 * other tools pass through unchanged.
 */
export function wrapAdvisorToolForSandbox<T extends { name: string; execute: Function }>(
	tool: T,
	sandbox: AdvisorSandbox,
): T {
	if (sandbox.mode !== "confined" || !ADVISOR_PATH_CONFINABLE_TOOLS.has(tool.name)) return tool;
	const name = tool.name;
	const execute = tool.execute.bind(tool) as AgentTool["execute"];
	const wrapped: T = {
		...tool,
		execute: (async (args: Record<string, unknown>, context: AgentToolContext): Promise<AgentToolResult> => {
			const confined = { ...args };
			if (typeof args.path === "string") {
				confined.path = confineAdvisorWriteTarget(args.path, sandbox);
			}
			if (Array.isArray(args.paths)) {
				confined.paths = (args.paths as unknown[]).map(p =>
					typeof p === "string" ? confineAdvisorWriteTarget(p, sandbox) : p,
				);
			}
			return await execute(confined, context);
		}) as AgentTool["execute"],
	};
	return wrapped;
}