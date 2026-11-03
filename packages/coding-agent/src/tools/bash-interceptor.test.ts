/**
 * bash-interceptor.test.ts — pin the interceptor's real contract.
 *
 * Ground truth (2026-11-02): `bashInterceptor.enabled` defaults FALSE and the
 * live config has it false — so the whole rule table ships dead. These tests
 * pin what checkBashInterception ACTUALLY does when called, so flipping the
 * default / swapping block→kairos-rewrite is a measured change.
 */
import { describe, expect, test } from "bun:test";
import {
	checkBashInterception,
	type InterceptionResult,
} from "./bash-interceptor";
import { DEFAULT_BASH_INTERCEPTOR_RULES } from "../config/settings-schema";

const ALL_TOOLS = [
	"bash",
	"read",
	"grep",
	"glob",
	"edit",
	"write",
	"eval",
	"ffs",
];

function block(r: InterceptionResult): boolean {
	return r.block === true;
}

describe("interceptor rule table (default rules)", () => {
	test("grep blocked when grep tool is available", () => {
		const r = checkBashInterception("grep -r foo .", ["grep"], DEFAULT_BASH_INTERCEPTOR_RULES);
		expect(block(r)).toBe(true);
		expect(r.suggestedTool).toBe("grep");
		expect(r.message).toContain("Blocked:");
		expect(r.message).toContain("Original command: grep -r foo .");
	});

	test("cat blocked with read suggestion", () => {
		const r = checkBashInterception("cat README.md", ["read"]);
		expect(block(r)).toBe(true);
		expect(r.suggestedTool).toBe("read");
	});

	test("find -name blocked with glob suggestion", () => {
		const r = checkBashInterception("find . -name '*.ts'", ["glob"]);
		expect(block(r)).toBe(true);
		expect(r.suggestedTool).toBe("glob");
	});

	test("sed -i blocked with edit suggestion", () => {
		const r = checkBashInterception("sed -i 's/a/b/' f.txt", ["edit"]);
		expect(block(r)).toBe(true);
		expect(r.suggestedTool).toBe("edit");
	});

	test("nohup blocked toward bash service mode", () => {
		const r = checkBashInterception("nohup server > log &", ["bash"]);
		expect(block(r)).toBe(true);
		expect(r.suggestedTool).toBe("bash");
	});

	test("bare ls / pwd / true are NOT blocked", () => {
		for (const cmd of ["ls -la", "pwd", "true", "git status", "bun test"]) {
			expect(block(checkBashInterception(cmd, ALL_TOOLS))).toBe(false);
		}
	});

	test("rule only blocks when the suggested tool is available", () => {
		// grep rule matches, but no `grep` tool in the surface → pass through.
		expect(block(checkBashInterception("grep foo file", ["bash", "read"]))).toBe(false);
	});
});

describe("interception candidates (env + pipelines)", () => {
	test("leading env assignment still intercepted", () => {
		const r = checkBashInterception("FOO=1 grep x file", ["grep"]);
		expect(block(r)).toBe(true);
	});

	test("env-only command is not falsely intercepted", () => {
		expect(block(checkBashInterception("FOO=1", ["grep"]))).toBe(false);
		expect(block(checkBashInterception("DEBUG=1 PATH=x ls", ["grep"]))).toBe(false);
	});

	test("cd ... && wrapper is intercepted (raw command form)", () => {
		// bash.ts passes rawCommand (with the cd) as originalCommand; the
		// checkDedicated-command path uses the cwd-normalized command too.
		const r = checkBashInterception("cd /tmp && grep x f", ["grep"], DEFAULT_BASH_INTERCEPTOR_RULES, "cd /tmp && grep x f");
		expect(block(r)).toBe(true);
	});

	test("piped-stdin grep stage is NOT interceptable (no path tool replaces it)", () => {
		const r = checkBashInterception("ls | grep x", ["grep"]);
		expect(block(r)).toBe(false);
	});
});

describe("dirty flags + malformed rules", () => {
	test("invalid regex rule is skipped (no throw)", () => {
		const bad = [{ pattern: "([unclosed", tool: "read", message: "x" }];
		expect(() => checkBashInterception("cat a", ["read"], bad)).not.toThrow();
		expect(block(checkBashInterception("cat a", ["read"], bad))).toBe(false);
	});

	test("custom rule set works standalone", () => {
		const custom = [{ pattern: "^\\s*(dog)\\s+", tool: "read", message: "use read for dog" }];
		expect(block(checkBashInterception("dog x", ["read"], custom))).toBe(true);
		expect(block(checkBashInterception("cat x", ["read"], custom))).toBe(false);
	});
});

describe("fork rewrite policy (fix-don't-scold)", () => {
	const KAIROS = { rewriteToKairos: true };

	test("matched command rewrites to kairos wrap instead of blocking", () => {
		const r = checkBashInterception("grep -r foo .", ["grep"], DEFAULT_BASH_INTERCEPTOR_RULES, "grep -r foo .", KAIROS);
		expect(r.block).toBe(false);
		expect(r.rewrittenCommand).toBe("kairos run -- grep -r foo .");
	});

	test("rewrite fires even when the suggested tool is NOT available", () => {
		// The whole point: the command still runs (under kairos), it never dead-ends.
		const r = checkBashInterception("cat x", ["bash"], DEFAULT_BASH_INTERCEPTOR_RULES, "cat x", KAIROS);
		expect(r.block).toBe(false);
		expect(r.rewrittenCommand).toBe("kairos run -- cat x");
	});

	test("non-matching commands never rewrite", () => {
		const r = checkBashInterception("git status", ALL_TOOLS, DEFAULT_BASH_INTERCEPTOR_RULES, "git status", KAIROS);
		expect(r.block).toBe(false);
		expect(r.rewrittenCommand).toBeUndefined();
	});

	test("env-prefixed command rewrites the FULL original", () => {
		const r = checkBashInterception("FOO=1 grep x f", ["grep"], DEFAULT_BASH_INTERCEPTOR_RULES, "FOO=1 grep x f", KAIROS);
		expect(r.rewrittenCommand).toBe("kairos run -- FOO=1 grep x f");
	});

	test("upstream policy (default execution arg) still hard-blocks", () => {
		// No execution arg = upstream semantics: block with message.
		const r = checkBashInterception("grep foo f", ["grep"]);
		expect(block(r)).toBe(true);
		expect(r.rewrittenCommand).toBeUndefined();
	});
});