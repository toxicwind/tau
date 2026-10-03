import { describe, expect, it } from "bun:test";
import { InternalUrlRouter } from "tau/internal-urls";

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
	});
});
