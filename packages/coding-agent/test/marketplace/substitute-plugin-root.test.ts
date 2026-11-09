import { describe, expect, it } from "bun:test";
import { substitutePluginRoot } from "tau/discovery/substitute-plugin-root";

// Use concatenation to avoid noTemplateCurlyInString lint rule on literal placeholder names
const CLAUDE_VAR = "$" + "{CLAUDE_PLUGIN_ROOT}";
const TAU_VAR = "$" + "{TAU_PLUGIN_ROOT}";

describe("substitutePluginRoot", () => {
	const ROOT = "/plugins/my-plugin";

<<<<<<< ours — scope `it("replaces OMP_PLUGIN_ROOT in strings", () ...` in test_suite `substitutePluginRoot`, deleted in theirs (S+F, confidence: low)
// refused_by: statement_fold · collision: none (no common ancestor text)
	it("replaces TAU_PLUGIN_ROOT in strings", () => {
		expect(substitutePluginRoot(`${TAU_VAR}/bin/server`, ROOT)).toBe("/plugins/my-plugin/bin/server");
	});
=======
>>>>>>> theirs — scope `it("replaces OMP_PLUGIN_ROOT in strings", () ...` deleted in theirs · weave: run 'weave explain packages/coding-agent/test/marketplace/substitute-plugin-root.test.ts' for per-hunk detail, 'weave check' to verify your resolution

	it("replaces both variables in same string", () => {
		expect(substitutePluginRoot(`${CLAUDE_VAR}:${TAU_VAR}`, ROOT)).toBe("/plugins/my-plugin:/plugins/my-plugin");
	});

	it("handles arrays recursively", () => {
		expect(substitutePluginRoot(["--config", `${CLAUDE_VAR}/config.json`], ROOT)).toEqual([
			"--config",
			"/plugins/my-plugin/config.json",
		]);
	});

	it("handles nested structures", () => {
		const input = {
			command: `${CLAUDE_VAR}/server`,
			args: ["--port", "3000"],
			env: { HOME: TAU_VAR },
		};
		expect(substitutePluginRoot(input, ROOT)).toEqual({
			command: "/plugins/my-plugin/server",
			args: ["--port", "3000"],
			env: { HOME: "/plugins/my-plugin" },
		});
	});
});
