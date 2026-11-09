import { describe, expect, it } from "bun:test";
import { renderFormula } from "./ci-update-brew-formula";

const BASE = "https://build.stencil.so/d/omp/20261010-171748-fa5ff4a";
const FILES = {
	macosArm: { url: `${BASE}/omp-darwin-arm64`, sha256: "darwin_arm64_sha" },
	macosIntel: { url: `${BASE}/omp-darwin-x64`, sha256: "darwin_x64_sha" },
	linuxArm: { url: `${BASE}/omp-linux-arm64`, sha256: "linux_arm64_sha" },
	linuxIntel: { url: `${BASE}/omp-linux-x64`, sha256: "linux_x64_sha" },
};

<<<<<<< ours — variable `SUMS` (S+F, confidence: low)
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
const SUMS = {
	"tau-darwin-arm64": "darwin_arm64_sha",
	"tau-darwin-x64": "darwin_x64_sha",
	"tau-linux-arm64": "linux_arm64_sha",
	"tau-linux-x64": "linux_x64_sha",
};
=======
>>>>>>> theirs — variable `SUMS` (S+F, confidence: low) · weave: run 'weave explain scripts/ci-update-brew-formula.test.ts' for per-hunk detail, 'weave check' to verify your resolution

describe("renderFormula", () => {
	const formula = renderFormula("18.8.9", FILES);

	// Regression: bare-binary URLs must opt out of Homebrew's UnpackStrategy.
	// Without `using: :nounzip` the default CurlDownloadStrategy nests the file
<<<<<<< ours — scope `// Regression: bare-binary URLs must opt out ...` in test_suite `renderFormula` (F, confidence: medium)
// refused_by: statement_fold · collision: `for (const arch of ["omp-darwin-arm64", "omp-darwin-x64", "omp-…`
	// outside the staging CWD, `Dir["tau-*"].first` returns `nil`, and
	// `bin.install nil => "tau"` raises (issue #2398).
	it("attaches `using: :nounzip` to every per-platform url stanza", () => {
		const matches = formula.match(/using: :nounzip/g) ?? [];
		expect(matches).toHaveLength(4);
		for (const arch of ["tau-darwin-arm64", "tau-darwin-x64", "tau-linux-arm64", "tau-linux-x64"]) {
			expect(formula).toMatch(
				new RegExp(
					`url "https://github\\.com/[^"]+/${arch}",\\s+using: :nounzip\\s+sha256 "${SUMS[arch as keyof typeof SUMS]}"`,
				),
=======
	// outside the staging CWD, `Dir["omp-*"].first` returns `nil`, and
	// `bin.install nil => "omp"` raises (issue #2398).
	// Each stanza falls back to the GitHub release asset when the build-service
	// download fails (e.g. its R2 redirect blocked by a proxy, issue #15907).
	it("attaches `using: :nounzip` and a GitHub release mirror to every per-platform url stanza", () => {
		const matches = formula.match(/using: :nounzip/g) ?? [];
		expect(matches).toHaveLength(4);
		for (const key in FILES) {
			const file = FILES[key as keyof typeof FILES];
			const asset = file.url.slice(file.url.lastIndexOf("/") + 1);
			expect(formula).toContain(
				`url "${file.url}",\n          using: :nounzip\n      mirror "https://github.com/can1357/oh-my-pi/releases/download/v18.8.9/${asset}"\n      sha256 "${file.sha256}"`,
>>>>>>> theirs — scope `// Regression: bare-binary URLs must opt out ...`
			);
		}
	});

	// Regression: completions generation must run with HOME redirected so the
	// popened binary doesn't touch the real `~/.tau` (denied by Homebrew's
	// sandbox profile) during the build (issue #2398).
	it("wraps `generate_completions_from_executable` with a HOME redirect to buildpath", () => {
		expect(formula).toMatch(
			/with_env\(HOME: buildpath\) do\n\s+generate_completions_from_executable\(bin\/"tau", "completions", shells: \[:bash, :zsh, :fish\]\)\n\s+end/,
		);
		// And the bare form (which is what failed in the sandbox) must not appear
		// outside the `with_env` block.
		const blockless = formula.replace(/with_env\(HOME: buildpath\) do[\s\S]*?end/, "");
		expect(blockless).not.toMatch(/generate_completions_from_executable/);
	});
});
