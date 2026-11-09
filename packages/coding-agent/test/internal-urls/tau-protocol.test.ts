import { describe, expect, it } from "bun:test";
import { InternalUrlRouter } from "tau/internal-urls";
import * as path from "node:path";
import { getDocsDiskRoot } from "@oh-my-pi/pi-coding-agent/internal-urls/docs-index";

<<<<<<< ours — test_suite `OmpProtocolHandler` (S+F, confidence: low)
// refused_by: rename_vs_edit_guard · collision: none (both sides edited, nowhere the same lines)
describe("TauProtocolHandler", () => {
	it("treats tau://docs as the documentation root", async () => {
		const resource = await InternalUrlRouter.instance().resolve("tau://docs");

		expect(resource.content).toContain("# Documentation");
		expect(resource.content).toContain("tools/read.md");
	});

	it("resolves docs-prefixed documentation paths", async () => {
		const router = InternalUrlRouter.instance();
		const direct = await router.resolve("tau://tools/read.md");
		const prefixed = await router.resolve("tau://docs/tools/read.md");

		expect(prefixed.content).toBe(direct.content);
		expect(prefixed.content).toContain("# read");
=======
describe("OmpProtocolHandler", () => {
	it("treats omp://docs as the documentation root", async () => {
		const resource = await InternalUrlRouter.instance().resolve("omp://docs");

		expect(resource.content).toContain("# Documentation");
		expect(resource.content).toContain("tools/read.md");
	});

	it("resolves docs-prefixed documentation paths", async () => {
		const router = InternalUrlRouter.instance();
		const direct = await router.resolve("omp://tools/read.md");
		const prefixed = await router.resolve("omp://docs/tools/read.md");

		expect(prefixed.content).toBe(direct.content);
		expect(prefixed.content).toContain("# read");
	});

	it("locates a doc to the file the active corpus was read from", async () => {
		const router = InternalUrlRouter.instance();
		// A source checkout reads docs from disk; a bundled or embedded corpus
		// (e.g. after `gen:bundle`) has no file and must never link.
		const root = getDocsDiskRoot();
		const onDisk = root === null ? undefined : path.join(root, "tools", "read.md");

		// Both renderer entry points (sync read cards, async markdown links) must
		// agree on the file, or a link opens a doc `read` never resolved.
		expect(router.locateSync("omp://tools/read.md")).toBe(onDisk);
		expect(router.locateSync("omp://docs/tools/read.md:1-20")).toBe(onDisk);
		expect(await router.locate("omp://tools/read.md")).toBe(onDisk ?? null);
	});

	it("never locates a URL that names no doc on disk", async () => {
		const router = InternalUrlRouter.instance();

		// The docs root is a listing, and an unknown doc has no file: linking it
		// would open something `omp://` does not serve.
		expect(router.locateSync("omp://")).toBeUndefined();
		expect(router.locateSync("omp://docs")).toBeUndefined();
		expect(router.locateSync("omp://no-such-doc.md")).toBeUndefined();
		expect(await router.locate("omp://no-such-doc.md")).toBeNull();

		// Render paths must survive a model-authored traversal URL.
		expect(router.locateSync("omp://../AGENTS.md")).toBeUndefined();
>>>>>>> theirs — test_suite `OmpProtocolHandler` (S+F, confidence: low) · weave: run 'weave explain packages/coding-agent/test/internal-urls/tau-protocol.test.ts' for per-hunk detail, 'weave check' to verify your resolution
	});
});
