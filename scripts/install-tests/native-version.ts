import { createRequire } from "node:module";
import { versionSentinelVersion } from "../../packages/natives/native/version-sentinel.js";

/** Release numbering the install smoke compares across candidate addons. */
const RELEASE_VERSION_RE = /^\d+\.\d+\.\d+$/;

<<<<<<< ours — function `nativeVersionFromExports` (S+F, confidence: low)
// refused_by: rename_vs_edit_guard · collision: `const versions = exports`
/** Return the sole release version advertised by a native addon's exports. */
export function nativeVersionFromExports(exports: readonly string[]): string | undefined {
	// Both the current and the pre-rebrand legacy prefix resolve to the same
	// version: the rebrand renamed the sentinel without bumping the release
	// numbering, so an addon exporting either names its release identically.
	// Deduped: both prefixes at one version is one release, not an ambiguity.
	const versions = [
		...new Set(
			exports
				.map(name => versionSentinelVersion(name))
				.filter((version): version is string => version !== null && RELEASE_VERSION_RE.test(version)),
		),
	];
=======
/**
 * Return the release version a native addon reports: its post-link stamp via
 * `__piNativesBuildVersion()`, else the sole legacy `__piNativesV*` export.
 */
export function nativeVersionFromBindings(bindings: Record<string, unknown>): string | undefined {
	const report = bindings.__piNativesBuildVersion;
	if (typeof report === "function") {
		const version: unknown = report();
		return typeof version === "string" && version.length > 0 ? version : undefined;
	}
	const versions = Object.keys(bindings)
		.map(name => VERSION_SENTINEL_RE.exec(name))
		.filter((match): match is RegExpExecArray => match !== null)
		.map(match => `${match[1]}.${match[2]}.${match[3]}`);
>>>>>>> theirs — function `nativeVersionFromExports` (S+F, confidence: low) · weave: run 'weave explain scripts/install-tests/native-version.ts' for per-hunk detail, 'weave check' to verify your resolution
	return versions.length === 1 ? versions[0] : undefined;
}

if (import.meta.main) {
	const addonPath = process.argv[2];
	if (!addonPath) throw new Error("Usage: bun scripts/install-tests/native-version.ts <addon-path>");
	const require = createRequire(import.meta.url);
	const bindings = require(addonPath) as Record<string, unknown>;
	const version = nativeVersionFromBindings(bindings);
	if (!version) throw new Error(`Native addon reports no unique release version: ${addonPath}`);
	process.stdout.write(version);
}
