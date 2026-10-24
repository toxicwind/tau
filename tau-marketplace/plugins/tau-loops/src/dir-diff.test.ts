import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { censusConsumers, diffTrees, formatCensus, formatDiff, resolveDir } from "./dir-diff.ts";

const scratch: string[] = [];

function makeTree(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "tau-loops-tree-"));
	scratch.push(root);
	for (const [rel, contents] of Object.entries(files)) {
		const full = join(root, rel);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, contents);
	}
	return root;
}

afterEach(() => {
	for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("diffTrees", () => {
	test("classifies files into the four buckets", () => {
		const left = makeTree({ same: "a", changed: "left version", onlyLeft: "x" });
		const right = makeTree({ same: "a", changed: "right version", onlyRight: "y" });
		const diff = diffTrees(left, right);
		expect(diff.identical).toEqual(["same"]);
		expect(diff.differing).toEqual(["changed"]);
		expect(diff.onlyInLeft).toEqual(["onlyLeft"]);
		expect(diff.onlyInRight).toEqual(["onlyRight"]);
	});

	// The buckets are keyed by relative path, not by content hash: a file that
	// exists on only one side is never "identical", however well the contents
	// happen to line up. Pinning this matters because the twin-directory case
	// (`herd/ui-svelte` vs `herd/mesh/ui-svelte`) is only detectable through
	// the path-keyed intersection.
	test("same bytes at different paths are not identical", () => {
		const left = makeTree({ a: "payload" });
		const right = makeTree({ b: "payload" });
		const diff = diffTrees(left, right);
		expect(diff.onlyInLeft).toEqual(["a"]);
		expect(diff.onlyInRight).toEqual(["b"]);
		expect(diff.identical).toEqual([]);
	});

	test("byte-identical twins intersect as identical", () => {
		const left = makeTree({ "src/one.ts": "same", "src/two.ts": "same" });
		const right = makeTree({ "src/one.ts": "same", "src/two.ts": "same" });
		expect(diffTrees(left, right).identical).toEqual(["src/one.ts", "src/two.ts"]);
	});

	// node_modules and dist differ on every machine and on every run, so
	// including them turns the signal into noise.
	test("skips ignored directories and lockfiles by default", () => {
		const left = makeTree({ "src/app.ts": "same", "dist/bundle.js": "minified v1", "bun.lock": "x" });
		const right = makeTree({ "src/app.ts": "same", "dist/bundle.js": "minified v2", "bun.lock": "y" });
		const diff = diffTrees(left, right);
		expect(diff.identical).toEqual(["src/app.ts"]);
		expect(diff.differing).toEqual([]);
	});

	test("honours an explicit ignore set", () => {
		const left = makeTree({ "keep.ts": "same", "vendor/x.js": "v1" });
		const right = makeTree({ "keep.ts": "same", "vendor/x.js": "v2" });
		const diff = diffTrees(left, right, { ignoreDirs: new Set<string>() });
		expect(diff.differing).toEqual(["vendor/x.js"]);
	});

	test("reports paths relative to each tree root", () => {
		const left = makeTree({ "deep/nested/file.ts": "a" });
		const right = makeTree({ "deep/nested/file.ts": "b" });
		expect(diffTrees(left, right).differing).toEqual(["deep/nested/file.ts"]);
	});
});

describe("censusConsumers", () => {
	// "Is this directory live or dead" is the question that decides whether it
	// can be deleted, and "I found no references" must be a real measurement
	// rather than an assumption.
	test("finds the references that keep a directory alive", () => {
		const root = makeTree({
			"bin/run.sh": "cd ui-svelte && bun run dev\n",
			"README.md": "ui-svelte is the dashboard\n",
			"src/clean.ts": "export const x = 1;\n",
		});
		const hits = censusConsumers({ searchRoot: root, needles: ["ui-svelte"] });
		const found = hits.get("ui-svelte") ?? [];
		expect(found.length).toBe(2);
		expect(found.map((hit) => hit.file).sort()).toEqual(["README.md", "bin/run.sh"]);
		expect(found[0]?.line).toBeGreaterThan(0);
	});

	test("reports a directory with no references as dead", () => {
		const root = makeTree({ "src/clean.ts": "export const x = 1;\n" });
		const hits = censusConsumers({ searchRoot: root, needles: ["herd/ui-svelte"] });
		expect(hits.get("herd/ui-svelte")).toEqual([]);
		expect(formatCensus(hits)).toContain("NO CONSUMERS (dead)");
	});

	test("caps hits per needle so one noisy file cannot flood the report", () => {
		const noisy = Array.from({ length: 50 }, (_, i) => `needle line ${i}`).join("\n");
		const root = makeTree({ "big.txt": noisy });
		const hits = censusConsumers({ searchRoot: root, needles: ["needle"], maxHitsPerNeedle: 5 });
		expect(hits.get("needle")?.length).toBe(5);
	});

	test("does not descend into ignored directories", () => {
		const root = makeTree({ "node_modules/dep/index.js": "needle\n", "app.ts": "needle\n" });
		const hits = censusConsumers({ searchRoot: root, needles: ["needle"] });
		expect(hits.get("needle")?.map((hit) => hit.file)).toEqual(["app.ts"]);
	});
});

describe("formatting", () => {
	test("summarises a diff with all four counts", () => {
		const left = makeTree({ same: "a", changed: "l", onlyL: "x" });
		const right = makeTree({ same: "a", changed: "r", onlyR: "y" });
		const text = formatDiff(diffTrees(left, right));
		expect(text).toContain("identical: 1");
		expect(text).toContain("differing: 1");
		expect(text).toContain("only in left:  1");
		expect(text).toContain("only in right: 1");
	});
});

describe("resolveDir", () => {
	test("returns the absolute path of a real directory", () => {
		const root = makeTree({ "a.ts": "" });
		expect(resolveDir(root)).toBe(root);
	});

	// Failing loud beats a confusing diff against a path that does not exist.
	test("throws on a missing path instead of diffing nothing", () => {
		expect(() => resolveDir(join(tmpdir(), "tau-loops-does-not-exist-xyz"))).toThrow(/not a directory/);
	});
});
