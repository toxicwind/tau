import { describe, expect, it } from "bun:test";
<<<<<<< ours — imports `file_header` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: `import {` +5 more
import { generateThemeStyles, generateThemeVars, getTemplate, parseExportArgs } from "tau/export/html";
=======
import { parseExportArgs } from "@oh-my-pi/pi-coding-agent/export/html";
>>>>>>> theirs — imports `file_header` (S+F, confidence: low) · weave: run 'weave explain packages/coding-agent/test/export-html-themes.test.ts' for per-hunk detail, 'weave check' to verify your resolution

describe("HTML export themes", () => {
	it("parses the optional user-theme flag before or after the output path", () => {
		expect(parseExportArgs("--themes export.html")).toEqual({ outputPath: "export.html", useUserThemes: true });
		expect(parseExportArgs("export.html --themes")).toEqual({ outputPath: "export.html", useUserThemes: true });
		expect(parseExportArgs("")).toEqual({ outputPath: undefined, useUserThemes: false });
		expect(() => parseExportArgs("one.html two.html")).toThrow("Usage: /export [--themes] [path]");
	});
});
