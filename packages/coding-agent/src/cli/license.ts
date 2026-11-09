import nativesNotices from "@oh-my-pi/pi-natives/THIRD-PARTY-NOTICES.txt" with { type: "text" };
import license from "../../LICENSE" with { type: "text" };
import cliNotices from "../../THIRD-PARTY-NOTICES.txt" with { type: "text" };

/**
 * `omp --license` output: the OMP license, then the notices of the two components the executable embeds — the CLI
 * and the native addon.
 */
export function formatLicenseOutput(): string {
	const sections = [license, cliNotices, nativesNotices].map(text => text.trimEnd());
<<<<<<< ours — scope `return `OMP License and Third-Party Notices\n...` in function `formatLicenseOutput` (S, confidence: medium)
// refused_by: statement_fold · collision: `return `OMP License and Third-Party Notices\n\n${rootLicense.tr…`
	return `TAU License and Third-Party Notices\n\n${rootLicense.trimEnd()}\n\n${thirdPartyNotices.trimEnd()}\n`;
=======
	return `OMP License and Third-Party Notices\n\n${sections.join("\n\n")}\n`;
>>>>>>> theirs — scope `return `OMP License and Third-Party Notices\n...` · weave: run 'weave explain packages/coding-agent/src/cli/license.ts' for per-hunk detail, 'weave check' to verify your resolution
}
