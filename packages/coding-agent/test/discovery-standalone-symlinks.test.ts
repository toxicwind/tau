import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { clearCache, walkUp } from "../src/capability/fs";
import { loadStandaloneContextFiles } from "../src/discovery/helpers";

describe("discovery symlink awareness", () => {
	let tmpDir: string;

	beforeEach(() => {
		clearCache();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tau-disc-symlink-"));
	});

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {}
	});

	it("walkUp resolves symlinked files and directories", async () => {
		const targetFile = path.join(tmpDir, "real-target.txt");
		fs.writeFileSync(targetFile, "target content");
		const subDir = path.join(tmpDir, "sub");
		fs.mkdirSync(subDir);
		const linkInSub = path.join(subDir, "link-to-target.txt");
		fs.symlinkSync(targetFile, linkInSub);

		// walkUp from subDir looking for link-to-target.txt
		const foundFile = await walkUp(subDir, "link-to-target.txt", { file: true });
		expect(foundFile).toBe(linkInSub);

		// Symlinked directory
		clearCache();
		const realDir = path.join(tmpDir, "real-dir");
		fs.mkdirSync(realDir);
		const linkDir = path.join(subDir, "link-to-dir");
		fs.symlinkSync(realDir, linkDir);

		const foundDir = await walkUp(subDir, "link-to-dir", { dir: true });
		expect(foundDir).toBe(linkDir);
	});

	it("loadStandaloneContextFiles does not read the same canonical file twice via symlinks", async () => {
		const rootDir = path.join(tmpDir, "workspace");
		const childDir = path.join(rootDir, "child");
		fs.mkdirSync(rootDir);
		fs.mkdirSync(childDir);

		const canonicalAgents = path.join(rootDir, "AGENTS.md");
		fs.writeFileSync(canonicalAgents, "# Standing Rules\n\nRule 1.\nRule 2.");

		// Create a symlink in child directory pointing to root AGENTS.md
		const childSymlink = path.join(childDir, "AGENTS.md");
		fs.symlinkSync(canonicalAgents, childSymlink);

		const ctx = {
			cwd: childDir,
			home: tmpDir,
			repoRoot: rootDir,
		};

		const result = await loadStandaloneContextFiles(ctx, "agents-md", "AGENTS.md");

		// Should find only ONE item (the first encountered closest to cwd) instead of duplicating the canonical file
		expect(result.items.length).toBe(1);
		expect(result.items[0].path).toBe(childSymlink);
		expect(result.items[0].content).toContain("Rule 1");
	});
});
