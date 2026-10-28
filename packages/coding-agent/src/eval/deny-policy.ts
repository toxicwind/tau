/**
 * deny-policy.ts — carry `tools.approval.<tool>: deny` INTO eval kernels.
 *
 * CVE-2026-1037 (estate anomaly #37, verified 2026-10-28)
 * ========================================================
 * The approval gate (`tools.approval`) is enforced per tool NAME in the host
 * (`approval.ts` → `resolveApproval` throws on deny). Eval kernels are spawned
 * as worker subprocesses (`subprocess/worker-client.ts` → `Bun.spawn`) and
 * hand user code raw Python `subprocess` / JS `Bun.$`. A deny configured as
 * `tools.approval.bash: deny` therefore binds ONLY the literal `bash` tool:
 *
 *     config.yml  tools.approval: { bash: deny, grep: deny, find: deny }
 *     eval cell   subprocess.run(["bash", "-lc", "…"])   // runs, no gate
 *
 * The policy is a name filter, not a capability fence: any agent can reach
 * bash/grep/find by calling them from inside an eval kernel. This module is
 * the enforcement shim: it converts the deny list to a machine-readable
 * `TAU_DENIED_TOOLS` env var (`tool:exe,exe;tool:exe…`) that the kernel
 * preludes (py/prelude.py, js/shared/runtime.ts) consult before every
 * `spawn`/`Popen`/`Bun.$`, so the DENY follows the CAPABILITY instead of the
 * tool name.
 */

/**
 * Tool-name → executable families the kernel may try to reach.
 *
 * Keeping the mapping HERE (host side, one place) means the preludes never
 * hardcode policy; they receive the already-resolved deny list as env. Add a
 * tool here when it (a) has an `tools.approval` knob and (b) maps to binaries
 * a kernel could spawn directly.
 */
const DENIED_TOOL_EXECUTABLES: Record<string, string[]> = {
	bash: ["bash", "sh", "dash", "zsh", "fish"],
	grep: ["grep", "rg", "ripgrep", "egrep", "fgrep"],
	find: ["find", "fd", "fdfind"],
};

/**
 * Seriaize a resolved deny list for `TAU_DENIED_TOOLS`.
 *
 * @example
 *   deniedToolsEnv(["bash", "grep"])
 *   // "bash:bash,sh,dash,zsh,fish;grep:grep,rg,ripgrep,egrep,fgrep"
 */
export function deniedToolsEnv(deniedTools: readonly string[]): string {
	const parts: string[] = [];
	for (const tool of deniedTools) {
		const executables = DENIED_TOOL_EXECUTABLES[tool];
		if (executables && executables.length > 0) {
			parts.push(`${tool}:${executables.join(",")}`);
		}
	}
	return parts.join(";");
}

/**
 * Parse `tools.approval` settings into the set of DENIED tool names.
 *
 * The settings record values are strings ("allow" | "deny" | "prompt");
 * only `deny` propagates. Anything else is policy for the host-side gate to
 * handle. Unknown tool names are still included if deny (the preludes simply
 * have no exec family for them, so they're inert — the host name-gate still
 * protects the named tool).
 */
export function extractDeniedTools(
	approval: Record<string, unknown> | undefined | null,
): string[] {
	if (!approval) return [];
	const denied: string[] = [];
	for (const [tool, decision] of Object.entries(approval)) {
		if (decision === "deny") denied.push(tool);
	}
	return denied.sort();
}

/** Single entry point: settings `tools.approval` value → TAU_DENIED_TOOLS env value. */
export function buildDeniedToolsEnv(
	approval: Record<string, unknown> | undefined | null,
): string | undefined {
	const denied = extractDeniedTools(approval);
	if (denied.length === 0) return undefined;
	return deniedToolsEnv(denied);
}