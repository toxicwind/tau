import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	ADVISOR_MUTATING_TOOLS,
	classifyAdvisorSandbox,
	confineAdvisorWriteTarget,
	type AdvisorSandbox,
} from "../../src/advisor/sandbox";

describe("classifyAdvisorSandbox", () => {
	it("defaults to read-only when the sandbox field is absent", () => {
		expect(classifyAdvisorSandbox(undefined)).toEqual({ mode: "read-only", dir: undefined });
	});

	it("accepts an explicit read-only mode", () => {
		expect(classifyAdvisorSandbox("read-only")).toEqual({ mode: "read-only", dir: undefined });
	});

	it("accepts an absolute directory as a confined-write sandbox", () => {
		const value = classifyAdvisorSandbox("/tmp/sandbox");
		expect(value.mode).toBe("confined");
		expect(value.dir).toBe("/tmp/sandbox");
	});

	it("rejects a relative directory (must be absolute to be unambiguous)", () => {
		expect(() => classifyAdvisorSandbox("scratch/notes")).toThrow(/absolute/i);
	});

	it("rejects a non-directory garbage value", () => {
		expect(() => classifyAdvisorSandbox("full")).toThrow(/read-only|absolute/i);
	});
});

describe("ADVISOR_MUTATING_TOOLS", () => {
	it("names the file-mutating tools that read-only advisors must not hold", () => {
		for (const tool of ["write", "edit", "ast_edit"]) {
			expect(ADVISOR_MUTATING_TOOLS.has(tool)).toBe(true);
		}
	});

	it("keeps inspection tools out of the mutating set", () => {
		for (const tool of ["read", "glob", "ast_grep", "lsp"]) {
			expect(ADVISOR_MUTATING_TOOLS.has(tool)).toBe(false);
		}
	});
});

describe("confineAdvisorWriteTarget", () => {
	let root: string;
	beforeEach(async () => {
		root = await fsp.mkdtemp(path.join(os.tmpdir(), "tau-advisor-sandbox-"));
	});
	afterEach(async () => {
		await fsp.rm(root, { recursive: true, force: true });
	});

	const confined = (): AdvisorSandbox => ({ mode: "confined", dir: root });

	it("allows a path inside the sandbox root", () => {
		expect(confineAdvisorWriteTarget(path.join(root, "notes.txt"), confined())).toBe(
			path.join(root, "notes.txt"),
		);
	});

	it("allows a nested path under the sandbox root", () => {
		expect(confineAdvisorWriteTarget(path.join(root, "sub", "deep", "file.ts"), confined())).toBe(
			path.join(root, "sub", "deep", "file.ts"),
		);
	});

	it("rejects a path outside the sandbox root", () => {
		expect(() => confineAdvisorWriteTarget("/etc/passwd", confined())).toThrow(/outside.*sandbox/i);
	});

	it("rejects a sibling that only shares a prefix (no trailing separator confusion)", () => {
		const evil = `${root}-evil/file.ts`;
		expect(() => confineAdvisorWriteTarget(evil, confined())).toThrow(/outside.*sandbox/i);
	});

	it("rejects a relative path that escapes via ..", () => {
		expect(() => confineAdvisorWriteTarget(path.join(root, "..", "escape.ts"), confined())).toThrow(
			/outside.*sandbox/i,
		);
	});

	it("denies write targets entirely for read-only sandboxes", () => {
		const readOnly: AdvisorSandbox = { mode: "read-only", dir: undefined };
		expect(() => confineAdvisorWriteTarget(path.join(root, "notes.txt"), readOnly)).toThrow(/read-only/i);
	});
});