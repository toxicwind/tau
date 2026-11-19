import { sanitizeDisplayWarnings } from "@tau/tau-tui/render/render-utils";

/**
 * Startup-time Python-eval availability warning.
 *
 * Ported from oh-my-pi `eval/startup-warning.ts` (upstream 8d1dfcd5ab lineage),
 * tau-adapted: settings registry reads are injected (tau's settings registry
 * lives in `config/settings-schema.ts`, not a per-domain module), and the
 * availability probe is injected so tests stay hermetic.
 *
 * Contract: warn ONCE on a broken *enabled* Python kernel so the failure
 * surfaces at startup instead of at first eval dispatch. Disabled backends
 * are intentional and never reported.
 */

const PYTHON_FIX_HINT =
	"Install Python 3.8+ or set python.interpreter, then verify with `tau setup python --check`.";

export interface PythonEvalWarningInput {
	cwd: string;
	/** `settings.get("eval.py")` — is the Python backend enabled at all? */
	isEnabled: () => boolean;
	interpreter?: string;
	signal?: AbortSignal;
	/** Injected probe (defaults to the real `checkPythonKernelAvailability`). */
	checkAvailability?: (cwd: string, interpreter?: string) => Promise<{ ok: boolean; reason?: string }>;
	/** `settings.get("eval.js")` — shapes the message when Python is broken. */
	jsEnabled?: boolean;
}

export async function resolvePythonEvalWarning(input: PythonEvalWarningInput): Promise<string | undefined> {
	if (!input.isEnabled()) return undefined;
	const check =
		input.checkAvailability ??
		(async () => {
			const { checkPythonKernelAvailability } = await import("./py/kernel");
			return checkPythonKernelAvailability(input.cwd, input.interpreter);
		});
	const availability = await check(input.cwd, input.interpreter);
	if (availability.ok || input.signal?.aborted) return undefined;
	// The reason embeds interpreter paths and spawn errors: shorten home, strip
	// controls, bound length (same sanitization contract as advisor warnings).
	const [reason] = sanitizeDisplayWarnings([availability.reason ?? "no working Python interpreter"]);
	return input.jsEnabled
		? `Python eval unavailable (${reason}); eval will run JavaScript only. ${PYTHON_FIX_HINT}`
		: `Eval tool unavailable: ${reason}, and JavaScript eval is disabled. ${PYTHON_FIX_HINT}`;
}

/**
 * {@link resolvePythonEvalWarning}, gated to a fresh install's first launch.
 *
 * `lastChangelogVersion` is the marker as read before this launch's changelog
 * step (see `utils/changelog.ts` marker file). That step writes it, except for
 * `--continue`, `--resume`, and foreign session imports; those launches are
 * skipped so they cannot repeat the warning on every resumed start.
 */
export async function resolveFirstLaunchPythonEvalWarning(input: {
	lastChangelogVersion: string | undefined;
	args: Pick<
		Args,
		"continue" | "resume" | "fromClaude" | "fromCodex" | "tools" | "noTools"
	>;
	cwd: string;
	isEnabled: () => boolean;
	interpreter?: string;
	checkAvailability?: (cwd: string, interpreter?: string) => Promise<{ ok: boolean; reason?: string }>;
	jsEnabled?: boolean;
}): Promise<string | undefined> {
	if (input.lastChangelogVersion !== undefined) return undefined;
	if (input.args.continue || input.args.resume || input.args.fromClaude || input.args.fromCodex) return undefined;
	// An explicit --tools list wins over --noTools, matching session tool selection.
	const evalExposed = input.args.tools ? input.args.tools.includes("eval") : !input.args.noTools;
	if (!evalExposed) return undefined;
	return resolvePythonEvalWarning({
		cwd: input.cwd,
		isEnabled: input.isEnabled,
		interpreter: input.interpreter,
		checkAvailability: input.checkAvailability,
		jsEnabled: input.jsEnabled,
	});
}

type Args = {
	continue?: boolean;
	resume?: boolean | string;
	fromClaude?: boolean;
	fromCodex?: boolean;
	tools?: string[];
	noTools?: boolean;
};
