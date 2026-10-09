import { createRequire } from "node:module";
import { versionSentinelVersion } from "../../packages/natives/native/version-sentinel.js";

/** Release numbering the install smoke compares across candidate addons. */
const RELEASE_VERSION_RE = /^\d+\.\d+\.\d+$/;

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
	return versions.length === 1 ? versions[0] : undefined;
}

if (import.meta.main) {
	const addonPath = process.argv[2];
	if (!addonPath) throw new Error("Usage: bun scripts/install-tests/native-version.ts <addon-path>");
	const require = createRequire(import.meta.url);
	const bindings = require(addonPath) as Record<string, unknown>;
	const version = nativeVersionFromExports(Object.keys(bindings));
	if (!version) throw new Error(`Native addon has no unique release version sentinel: ${addonPath}`);
	process.stdout.write(version);
}
