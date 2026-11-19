/**
 * kairos autoshim contract — RED to GREEN.
 *
 * The estate doctrine (AGENTS.md §3.2) requires kairos enforcement in EVERY
 * agent bash shell: the DEBUG trap, head/tail/timeout guards, run-fast/4s race,
 * and the LD_/RF_/DELEND_CODE_RACE env it exports must be live when the coding
 * agent runs a command. `.bash_profile` sets `BASH_ENV=shim.sh` for login
 * shells only; the agent's own executor shells are non-login, so the coding
 * agent must inject BASH_ENV itself. This spec pins that contract.
 *
 * Current state (2026-11-02): buildNonInteractiveEnv never sets BASH_ENV and
 * shell-snapshot actively deletes it → agent shells run raw bash (no
 * two_sec_slow, no KAIROS_ENFORCE, real /usr/bin/head). This test is RED;
 * the fix is to source the kairos shim in the agent's non-interactive env.
 */
import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { buildNonInteractiveEnv } from "tau/exec/non-interactive-env";

const SHIM_PATH = "/home/toxic/pens/olympus/products/kairos/shim.sh";

/** Spawn non-interactive bash exactly like the executor does (env overlay). */
async function probeShellEnv(env: Record<string, string>): Promise<string> {
	const proc = Bun.spawn([
		"bash",
		"-c",
		[
			`echo "BASH_ENV=[$BASH_ENV]"`,
			`type two_sec_slow 2>/dev/null || echo "two_sec_slow=missing"`,
			`type _2s_slow 2>/dev/null || echo "_2s_slow=missing"`,
			`echo "KAIROS_ENFORCE=[$KAIROS_ENFORCE]"`,
			`echo "KAIROS_SHIM_MODE=[$KAIROS_SHIM_MODE]"`,
			`echo "RF_BIN=[$RF_BIN]"`,
			`echo "RF_DEADLINE=[$RF_DEADLINE]"`,
			`echo "DELEND_CODE_RACE=[$DELEND_CODE_RACE]"`,
			`echo "RIPGREP_CONFIG_PATH=[$RIPGREP_CONFIG_PATH]"`,
			`echo "BASH_2S_SHIM=[$BASH_2S_SHIM]"`,
			`echo "LD_PRELOAD=[$LD_PRELOAD]"`,
			`head --version | head -1 || true`,
			`type head 2>/dev/null || echo "head=missing"`,
		].join("\n"),
	], {
		// Executor shells inherit the parent process env with the non-interactive
		// overlay applied on top (HOME must be present for the shim to resolve
		// $HOME/.local/bin/run-fast).
		env: { ...Bun.env, ...env, TERM: "dumb" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	return stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
}

describe("kairos autoshim in agent exec shells", () => {
	it("carries BASH_ENV pointing at the kairos shim", () => {
		const env = buildNonInteractiveEnv();
		expect(env.BASH_ENV).toBe(SHIM_PATH);
		expect(env.KAIROS_ENFORCE ?? "").not.toBe("0"); // never disable enforcement
	});

	it("sources the shim into a spawned non-interactive bash (functions + env live)", async () => {
		const env = buildNonInteractiveEnv();
		const out = await probeShellEnv(env);
		expect(out).toContain(`BASH_ENV=[${SHIM_PATH}]`);
		expect(out).toContain("KAIROS_ENFORCE=[1]");
		expect(out).toContain("KAIROS_SHIM_MODE=[agent]");
		// The shim's own enforcement family (two_sec_slow is the .bashrc
		// interactive alias; agent shells get the shim's _2s_* functions).
		expect(out).toContain("_2s_slow is a function");
		expect(out).not.toContain("_2s_slow=missing");
		expect(out).toContain("RF_DEADLINE=[4.0]");
		expect(out).toContain("DELEND_CODE_RACE=[");
		expect(out).toContain("RIPGREP_CONFIG_PATH=[");
		expect(out).toContain("BASH_2S_SHIM=[1]");
	});

	it("does not leak the shim into interactive model/test shells (KAIROS_ENFORCE=0)", async () => {
		const env = buildNonInteractiveEnv();
		// Interactive shells must never be hijacked: the guard only enforces in
		// non-interactive agent shells. Setting KAIROS_ENFORCE=1 explicitly is the
		// opt-in; an env overlay must not force it off for agent shells.
		expect(env.KAIROS_ENFORCE).toBe("1");
	});

	it("keeps BASH_ENV intact when the shim exists (snapshot must not strip it)", async () => {
		expect(await Bun.file(SHIM_PATH).exists()).toBe(true);
		const env = buildNonInteractiveEnv();
		expect(env.BASH_ENV).toBe(SHIM_PATH);
	});
});