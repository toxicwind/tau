import { describe, expect, test } from "bun:test";
import { rewriteGitWorktreeAdd } from "./bash-worktree-rewrite";
import {
	extractFlatShellCommandSegments,
	extractLeadingCdTarget,
	extractLiteralAndChainSegments,
	readShellWord,
	tokenizeShellSegments,
} from "./shell-tokenize";

const TAU = ["tau"];

describe("tokenizeShellSegments — real shell tokenization", () => {
	test("splits on whitespace, honors quotes", () => {
		expect(tokenizeShellSegments("git worktree add")).toEqual([["git", "worktree", "add"]]);
		expect(tokenizeShellSegments(`git commit -m 'two words'`)).toEqual([["git", "commit", "-m", "two words"]]);
	});

	test("quotes glue tokens together mid-word", () => {
		expect(tokenizeShellSegments(`echo a'b'c`)).toEqual([["echo", "abc"]]);
	});

	test("operators split commands", () => {
		expect(tokenizeShellSegments("a && b").length).toBe(2);
		expect(tokenizeShellSegments("a | b").length).toBe(2);
		expect(tokenizeShellSegments("a; b").length).toBe(2);
	});
});

describe("rewriteGitWorktreeAdd — supported forms only", () => {
	test("plain add rewrites through tau with explicit -- separator", () => {
		expect(rewriteGitWorktreeAdd("git worktree add ../wt", TAU)).toBe(
			"tau worktree add -- ../wt",
		);
	});

	test("-b branch is carried, with quoting for unsafe names", () => {
		expect(rewriteGitWorktreeAdd("git worktree add -b feature/x ../wt", TAU)).toBe(
			"tau worktree add -b feature/x -- ../wt",
		);
		expect(rewriteGitWorktreeAdd("git worktree add -b 'has space' ../wt", TAU)).toBe(
			"tau worktree add -b 'has space' -- ../wt",
		);
	});

	test("-C path is preserved before the subcommand", () => {
		expect(rewriteGitWorktreeAdd("git -C repo worktree add ../wt", TAU)).toBe(
			"tau worktree add -C repo -- ../wt",
		);
	});

	test("--detach and --quiet translate to tau flags", () => {
		expect(rewriteGitWorktreeAdd("git worktree add --detach -q ../wt", TAU)).toBe(
			"tau worktree add --detach -q -- ../wt",
		);
		expect(rewriteGitWorktreeAdd("git worktree add -d ../wt path2", TAU)).toBe(
			"tau worktree add --detach -q -- ../wt path2".replace(" -q", ""), // -d maps to --detach only
		);
	});

	test("a second branch flag aborts the rewrite (left for git)", () => {
		const cmd = "git worktree add -b a -B b ../wt";
		expect(rewriteGitWorktreeAdd(cmd, TAU)).toBe(cmd);
	});

	test("unknown git flags abort the rewrite", () => {
		const cmd = "git worktree add --track ../wt";
		expect(rewriteGitWorktreeAdd(cmd, TAU)).toBe(cmd);
	});

	test("shell expansions abort the rewrite", () => {
		for (const cmd of [
			"git worktree add $PWD/wt",
			"git worktree add ../$(basename $x)",
			"git worktree add ~/wt",
			"git worktree add ../wt?x",
		]) {
			expect(rewriteGitWorktreeAdd(cmd, TAU)).toBe(cmd);
		}
	});

	test("non-git and non-worktree-add commands pass through untouched", () => {
		for (const cmd of [
			"git worktree list",
			"git worktree remove ../wt",
			"git status",
			"ls -la",
		]) {
			expect(rewriteGitWorktreeAdd(cmd, TAU)).toBe(cmd);
		}
	});

	test("piped stdin segments abort the whole rewrite", () => {
		const cmd = "echo x | git worktree add ../wt";
		expect(rewriteGitWorktreeAdd(cmd, TAU)).toBe(cmd);
	});

	test("chained commands rewrite only the supported segment", () => {
		expect(rewriteGitWorktreeAdd("git fetch && git worktree add ../wt", TAU)).toBe(
			"git fetch && tau worktree add -- ../wt",
		);
	});

	test("half-parsed branch flag aborts", () => {
		const cmd = "git worktree add -b";
		expect(rewriteGitWorktreeAdd(cmd, TAU)).toBe(cmd);
	});

	test("zero or three positionals abort", () => {
		expect(rewriteGitWorktreeAdd("git worktree add", TAU)).toBe("git worktree add");
		const three = "git worktree add a b c";
		expect(rewriteGitWorktreeAdd(three, TAU)).toBe(three);
	});
});

describe("extractLeadingCdTarget", () => {
	test("cd extracts target and rest", () => {
		expect(extractLeadingCdTarget("cd /tmp && ls")).toEqual({ path: "/tmp", rest: "ls" });
	});
	test("non-cd commands return null", () => {
		expect(extractLeadingCdTarget("ls /tmp")).toBeNull();
	});
});

describe("readShellWord", () => {
	test("plain word reads to whitespace", () => {
		expect(readShellWord("abc def")).toEqual({ value: "abc", rest: "def" });
	});
	test("unterminated quote is rejected", () => {
		expect(readShellWord("'abc")).toBe("unterminated");
	});
	test("escaped separators do not split", () => {
		const word = readShellWord(`a\\ b c`);
		expect(word).toEqual({ value: "a b", rest: "c" });
	});
});
