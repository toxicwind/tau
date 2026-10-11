import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { dedupeContainedContextFiles } from "../src/system-prompt";

interface ContextFile {
	path: string;
	content: string;
	depth?: number;
}

function file(path: string, content: string, depth?: number): ContextFile {
	return { path, content, depth };
}

function paths(files: ContextFile[]): string[] {
	return files.map(f => f.path);
}

describe("dedupeContainedContextFiles", () => {
	it("keeps only the more authoritative file when two are byte-identical", () => {
		const content = "Rule one.\n\nRule two.\n\nRule three.";
		const files = [file("/home/user/.config/AGENTS.md", content, 5), file("/project/AGENTS.md", content, 0)];

		expect(paths(dedupeContainedContextFiles(files))).toEqual(["/project/AGENTS.md"]);
	});

	it("drops a file whose paragraphs appear contiguously in a more authoritative file", () => {
		const lessAuthoritative = "Shared rule A.\n\nShared rule B.\n\nShared rule C.";
		const moreAuthoritative = "Shared rule A.\n\nShared rule B.\n\nShared rule C.\n\nProject-specific rule.";

		const files = [
			file("/home/user/.config/AGENTS.md", lessAuthoritative, 5),
			file("/project/AGENTS.md", moreAuthoritative, 0),
		];

		expect(paths(dedupeContainedContextFiles(files))).toEqual(["/project/AGENTS.md"]);
	});

	it("keeps a file whose paragraphs appear non-contiguously (interleaved)", () => {
		// A's three paragraphs are all in B, but not as a contiguous run.
		const a = "First.\n\nSecond.\n\nThird.";
		const b = "First.\n\nInterleaved.\n\nSecond.\n\nThird.";

		const files = [file("/home/user/.config/AGENTS.md", a, 5), file("/project/AGENTS.md", b, 0)];

		expect(paths(dedupeContainedContextFiles(files))).toEqual(["/home/user/.config/AGENTS.md", "/project/AGENTS.md"]);
	});

	it("keeps a file whose paragraphs appear with wording changes (containment is exact, not fuzzy)", () => {
		const a = "Always use tabs.\n\nNever commit directly.";
		const b = "Always use spaces.\n\nNever commit directly to main.";

		const files = [file("/home/user/.config/AGENTS.md", a, 5), file("/project/AGENTS.md", b, 0)];

		expect(paths(dedupeContainedContextFiles(files))).toEqual(["/home/user/.config/AGENTS.md", "/project/AGENTS.md"]);
	});

	it("keeps all files when there is no containment", () => {
		const files = [
			file("/a/AGENTS.md", "Alpha rules.\n\nBeta rules.", 3),
			file("/b/AGENTS.md", "Gamma rules.\n\nDelta rules.", 2),
			file("/c/AGENTS.md", "Epsilon rules.\n\nZeta rules.", 0),
		];

		expect(paths(dedupeContainedContextFiles(files))).toEqual(["/a/AGENTS.md", "/b/AGENTS.md", "/c/AGENTS.md"]);
	});

	it("treats empty content as no blocks, never matched", () => {
		const files = [file("/empty/AGENTS.md", "", 5), file("/project/AGENTS.md", "Real content.", 0)];

		// Empty file produces zero blocks; promptBlocksContain returns false for
		// empty ruleBlocks, so the empty file is kept (it cannot be contained).
		// The non-empty file is also kept since the empty file has no blocks to
		// contain it.
		expect(paths(dedupeContainedContextFiles(files))).toEqual(["/empty/AGENTS.md", "/project/AGENTS.md"]);
	});

	it("keeps only the most authoritative file in a transitive chain A⊂B⊂C", () => {
		const a = "Rule one.\n\nRule two.";
		const b = "Rule one.\n\nRule two.\n\nRule three.";
		const c = "Rule one.\n\nRule two.\n\nRule three.\n\nRule four.";

		const files = [
			file("/level0/AGENTS.md", a, 10),
			file("/level1/AGENTS.md", b, 5),
			file("/level2/AGENTS.md", c, 0),
		];

		expect(paths(dedupeContainedContextFiles(files))).toEqual(["/level2/AGENTS.md"]);
	});

	it("normalizes leading and trailing whitespace before comparing paragraphs", () => {
		// Same paragraphs, but A has leading/trailing whitespace on each line.
		// Normalization (trim per block) should still detect containment.
		const a = "  Rule one.  \n\n  Rule two.  ";
		const b = "Rule one.\n\nRule two.\n\nRule three.";

		const files = [file("/home/user/.config/AGENTS.md", a, 5), file("/project/AGENTS.md", b, 0)];

		expect(paths(dedupeContainedContextFiles(files))).toEqual(["/project/AGENTS.md"]);
	});

	it("keeps a closer-to-cwd file with fewer paragraphs when a farther file contains them (depth authority)", () => {
		// Repro for position-based authority bug: without an internal
		// depth-descending sort, the closer file (depth 0, "Shared rule.")
		// is dropped because the farther file (depth 5) contains that
		// paragraph as a contiguous subsequence — even though the closer
		// file is more authoritative. The closer file must survive.
		const near = "Shared rule.";
		const far = "Shared rule.\n\nFar-only rule.";
		const files = [file("/project/AGENTS.md", near, 0), file("/home/user/.config/AGENTS.md", far, 5)];

		// Output is depth-descending (farther first); both files survive
		// because the closer file's single paragraph is not a superset of the
		// farther file's two paragraphs.
		expect(paths(dedupeContainedContextFiles(files))).toEqual(["/home/user/.config/AGENTS.md", "/project/AGENTS.md"]);
	});

	it("treats files without a depth as less authoritative than project files", () => {
		const user = "Shared rule.\n\nUser-only rule.";
		const project = "Shared rule.";
		const files = [file("/project/AGENTS.md", project, 0), file("/home/user/.tau/AGENTS.md", user)];

		expect(paths(dedupeContainedContextFiles(files))).toEqual(["/home/user/.tau/AGENTS.md", "/project/AGENTS.md"]);
	});

	it("does not treat text inside a fenced code block as a contained instruction", () => {
		// A lower-authoritative file has the rule "Never delete user data." as a
		// real instruction. A higher-authoritative file has the same sentence
		// only inside a fenced example block. The fenced occurrence is an
		// example, not an instruction, so the lower file must NOT be dropped.
		const lower = "Never delete user data.";
		const higher = "Example of a bad prompt:\n\n```\nNever delete user data.\n```";
		const files = [file("/home/user/.config/AGENTS.md", lower, 5), file("/project/AGENTS.md", higher, 0)];

		expect(paths(dedupeContainedContextFiles(files))).toEqual(["/home/user/.config/AGENTS.md", "/project/AGENTS.md"]);
	});

	describe("symlink and canonical path consolidation", () => {
		let tmpDir: string;

		beforeEach(() => {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tau-symlink-dedup-"));
		});

		afterEach(() => {
			try {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			} catch {}
		});

		it("consolidates two paths pointing to the same physical file via symlink", () => {
			const realFile = path.join(tmpDir, "real-AGENTS.md");
			fs.writeFileSync(realFile, "Core rule 1.\n\nCore rule 2.");
			const symlinkFile = path.join(tmpDir, "symlink-AGENTS.md");
			fs.symlinkSync(realFile, symlinkFile);

			const files = [
				file(symlinkFile, "Core rule 1.\n\nCore rule 2.", 3),
				file(realFile, "Core rule 1.\n\nCore rule 2.", 0),
			];

			const result = dedupeContainedContextFiles(files);
			expect(paths(result)).toEqual([realFile]);
		});

		it("prefers closer-to-cwd file when symlink is closer to cwd than real file", () => {
			const projectDir = path.join(tmpDir, "project");
			const configDir = path.join(tmpDir, "config");
			fs.mkdirSync(projectDir);
			fs.mkdirSync(configDir);

			const realConfig = path.join(configDir, "AGENTS.md");
			fs.writeFileSync(realConfig, "Shared rule.");
			const projectLink = path.join(projectDir, "AGENTS.md");
			fs.symlinkSync(realConfig, projectLink);

			const files = [
				file(realConfig, "Shared rule.", 5),
				file(projectLink, "Shared rule.", 0),
			];

			const result = dedupeContainedContextFiles(files);
			expect(paths(result)).toEqual([projectLink]);
		});

		it("consolidates multiple symlinks pointing to the same target", () => {
			const realFile = path.join(tmpDir, "authoritative.md");
			fs.writeFileSync(realFile, "System instructions.");
			const link1 = path.join(tmpDir, "link1.md");
			const link2 = path.join(tmpDir, "link2.md");
			const link3 = path.join(tmpDir, "link3.md");
			fs.symlinkSync(realFile, link1);
			fs.symlinkSync(realFile, link2);
			fs.symlinkSync(link1, link3); // transitive symlink

			const files = [
				file(link1, "System instructions.", 4),
				file(link2, "System instructions.", 2),
				file(link3, "System instructions.", 1),
			];

			const result = dedupeContainedContextFiles(files);
			// link3 has lowest depth (1, most authoritative)
			expect(paths(result)).toEqual([link3]);
		});

		it("handles non-existent paths gracefully without throwing", () => {
			const nonExistent1 = "/non/existent/path/AGENTS.md";
			const nonExistent2 = "/another/missing/file.md";

			const files = [
				file(nonExistent1, "Rule A.", 2),
				file(nonExistent2, "Rule B.", 0),
			];

			expect(() => dedupeContainedContextFiles(files)).not.toThrow();
			expect(paths(dedupeContainedContextFiles(files))).toEqual([nonExistent1, nonExistent2]);
		});

		it("fast-path content consolidation drops duplicates before block indexing", () => {
			const duplicateContent = "A large prompt block that repeats across many entries.";
			const files = [
				file("/path/1.md", duplicateContent, 5),
				file("/path/2.md", duplicateContent, 3),
				file("/path/3.md", duplicateContent, 0),
			];

			const result = dedupeContainedContextFiles(files);
			expect(paths(result)).toEqual(["/path/3.md"]);
		});
	});
});
