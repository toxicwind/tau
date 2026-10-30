/**
 * Brush↔bash parity contract for the shell execution engine tau's bash tool
 * runs on (brush-core via @tau/tau-natives executeShell).
 *
 * Empirically derived 2026-10-30 on CachyOS / bash 5.3.20 (awrawr-pc): every
 * case here runs through BOTH engines and the parity cases assert the outputs
 * agree. The `test.failing` cases are the known brush divergences that justify
 * an Arch-targeted fork of brush-core — bun flips them to hard failures the
 * moment the fork fixes them, so the divergence list cannot rot silently.
 *
 * Real bash reference: spawned directly with --noprofile --norc and BASH_ENV
 * cleared, so the kairos shim on this box cannot pollute the reference.
 */
import { describe, expect, test } from "bun:test";
import { executeShell } from "@tau/tau-natives";
import { execFileSync } from "node:child_process";

async function brushRun(command: string): Promise<string> {
	let out = "";
	const result = await executeShell({ command, timeoutMs: 8000 }, (err, chunk) => {
		if (chunk) out += chunk;
	});
	return `${out.trim()}\u0000rc=${result.exitCode ?? "none"}`;
}

function bashRun(command: string): string {
	const p = Bun.spawnSync(["bash", "--noprofile", "--norc", "-c", command], {
		timeout: 8000,
		stdout: "pipe",
		stderr: "ignore",
		env: { ...process.env, BASH_ENV: "" },
	});
	return `${new TextDecoder().decode(p.stdout).trim()}\u0000rc=${p.exitCode ?? "none"}`;
}

// Await BOTH engines explicitly before comparing: a promise smuggled inside
// an expect() array is never awaited and compares as an object — vacuous.
async function expectParity(command: string): Promise<void> {
	const brush = await brushRun(command);
	const bash = bashRun(command);
	expect(brush).toBe(bash);
}

const PARITY_CASES: Array<string> = [
	// arithmetic & parameter expansion
	"echo $((2**10))",
	"echo ${PATH##*/}",
	"arr=(a b c); echo ${arr[1]}",
	"x=hello; echo ${x:1:3}",
	"v=abc; echo ${v//b/X}",
	"echo ${undefinedvar:-fallback}",
	// builtins
	"mapfile -t a <<< 'l1\nl2'; echo ${#a[@]}",
	"f() { local v=3; echo $v; }; f",
	"declare -A m; m[k]=v; echo ${m[k]}",
	"a=5; (( a += 3 )); echo $a",
	'read -r a b <<< "one two"; echo "$b"',
	"IFS=: read -r p1 p2 <<< 'a:b'; echo \"$p2\"",
	"echo one two three | while read x y; do echo \"$y\"; done",
	"echo {a..c}",
	'case abc in a*) echo m;; esac',
	"[[ -n abc && 1 -lt 2 ]] && echo yes",
	"if ! false; then echo neg; fi",
	"pushd /tmp >/dev/null && popd >/dev/null; echo ok",
	"set -o pipefail; echo ok",
	"echo $(pwd)",
	"cd /tmp; pwd",
];

describe("brush↔bash builtin parity (CachyOS, bash 5.3)", () => {
	test("brush engine is reachable", async () => {
		const out = await brushRun("echo engine-probe");
		expect(out.startsWith("engine-probe")).toBe(true);
	});

	for (const command of PARITY_CASES) {
		test(`parity: ${command}`, async () => {
			await expectParity(command);
		});
	}

	// Nested command substitution with a failing inner command: real bash
	// prints the outer text and exits 127; brush mishandles the inner failure
	// (emits "error: command not found: deep" INSIDE the captured output and
	// still exits 0).
	test.failing("parity: nested command substitution error propagates rc", async () => {
		await expectParity("echo $(echo nested $(deep))");
	});

	// EXIT traps: real bash fires them on exit; brush drops them silently.
	test.failing("parity: EXIT trap fires", async () => {
		await expectParity('trap "echo trapped" EXIT; exit 0');
	});

	// fd redirection via `exec N>file`: brush treats exec as a command, not a
	// builtin.
	test.failing("parity: exec fd redirection", async () => {
		await expectParity("exec 3>/dev/null; echo fd");
	});

	// history -c: brush errors "command history is not enabled" into the
	// captured output instead of succeeding like bash.
	test.failing("parity: history -c is a no-op success", async () => {
		await expectParity("history -c; echo ok");
	});

	// extglob matching: brush ignores `+(...)` even after shopt -s extglob.
	test.failing("parity: extglob patterns after shopt", async () => {
		await expectParity("shopt -s extglob; echo +(a)b 2>/dev/null || echo noextglob");
	});
});

describe("BASH_VERSION honesty", () => {
	// brush reports its own fake version (5.2.37(1)); scripts branching on
	// BASH_VERSION see 5.2 while the reference bash on Arch is 5.3. Not
	// assertable as parity — pinned as documentation of the divergence.
	test("brush reports a bash-compatible BASH_VERSION string", async () => {
		const out = await brushRun("echo $BASH_VERSION");
		expect(out).toMatch(/\d+\.\d+\.\d+/);
	});
});
