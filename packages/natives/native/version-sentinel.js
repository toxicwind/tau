/**
<<<<<<< ours — interstitial `file_header` (T, confidence: high)
// refused_by: merge_ladder_exhausted · collision: `* Version-sentinel helpers shared by the native loader and the …` +6 more
 * Version-sentinel helpers shared by the native loader, the embed pipeline and
 * the release tooling.
 *
 * Kept in its own module so `scripts/embed-native.ts`, `scripts/gen-enums.ts`
 * and `scripts/release.ts` can reuse the sentinel vocabulary without importing
 * `loader-state.js` — which pulls in the generated `embedded-addon.js` and its
 * `with { type: "file" }` archive import. That chain fails to resolve when the
 * archive is missing, which would break `gen:native:reset` on an inconsistent
 * tree (populated manifest, deleted archive) before it can restore the
 * checked-in null stub.
=======
 * Addon release-identity helpers shared by the native loader, the embed
 * pipeline, and the post-link stamp tool (`scripts/stamp-native-version.ts`).
 *
 * Kept in its own module so `scripts/embed-native.ts` can reuse them without
 * importing `loader-state.js` and the rest of the runtime loader.
 *
 * Current addons carry a fixed-size stamp slot (`VERSION_STAMP_MAGIC` + the
 * release version + NUL padding) written after linking and reported by
 * `__piNativesBuildVersion()`. Addons published before that exported a
 * per-release `__piNativesV{major}_{minor}_{patch}` function instead; those
 * are still recognized so an old module resident across an in-place upgrade
 * is diagnosed correctly.
>>>>>>> theirs — interstitial `file_header` (T, confidence: high) · weave: run 'weave explain packages/natives/native/version-sentinel.js' for per-hunk detail, 'weave check' to verify your resolution
 */

/** Prefix every post-rebuild native addon emits. */
export const VERSION_SENTINEL_PREFIX = "__tauNativesV";

/**
 * Prefix pre-rebrand native addons still emit. The rebrand renamed the symbol
 * without bumping the release, so a `.node` published under the old name
 * carries the SAME version this tree expects; the loader must accept it rather
 * than call every already-installed addon stale.
 */
export const LEGACY_VERSION_SENTINEL_PREFIX = "__piNativesV";

/** Every prefix that names a release sentinel. Current first. */
export const VERSION_SENTINEL_PREFIXES = [VERSION_SENTINEL_PREFIX, LEGACY_VERSION_SENTINEL_PREFIX];

/** Matches `<prefix><version-with-underscores>` for any recognized prefix. */
export const VERSION_SENTINEL_NAME_SOURCE = `(?:${VERSION_SENTINEL_PREFIXES.join("|")})[A-Za-z0-9_]+`;

const VERSION_SENTINEL_ANY_RE = new RegExp(`^${VERSION_SENTINEL_NAME_SOURCE}$`);

/**
 * @param {number} byte
 * @returns {boolean}
 */
function isIdentifierByte(byte) {
	return byte === 95 || (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122);
}

/** Prefix of the stamp slot linked into every addon (`crates/pi-natives/src/lib.rs`). */
export const VERSION_STAMP_MAGIC = "PI_NATIVES_VERSION_STAMP:";

/** Total stamp slot size in bytes: magic, version, NUL padding. */
export const VERSION_STAMP_SIZE = 64;

/** Export names of pre-stamp releases (`__piNativesV18_3_2`). */
const LEGACY_SENTINEL_RE = /^__piNativesV([A-Za-z0-9_]+)$/;

/**
 * Check whether addon bytes carry the stamp for exactly `version` (a stamp for
 * `18.1.10` must not satisfy a lookup for `18.1.1`, so the version must be
 * followed by the slot's NUL padding).
 * @param {Uint8Array} bytes
 * @param {string} version
 * @returns {boolean}
 */
export function containsVersionStamp(bytes, version) {
	if (version.length === 0) return false;
	const needle = Buffer.from(`${VERSION_STAMP_MAGIC}${version}\0`, "utf8");
	return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf(needle) !== -1;
}

/**
 * Check whether pre-stamp addon bytes export the legacy sentinel for exactly
 * `version` (`__piNativesV18_3_2`, not a longer `__piNativesV18_3_20`). The
 * loader accepts such an addon for that release, so embedding may too.
 * @param {Uint8Array} bytes
 * @param {string} version
 * @returns {boolean}
 */
export function containsLegacyVersionSentinel(bytes, version) {
	if (version.length === 0) return false;
	const haystack = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const needle = Buffer.from(`__piNativesV${version.replace(/[^A-Za-z0-9]/g, "_")}`, "utf8");
	for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
		const next = haystack[at + needle.length];
		const continues =
			next !== undefined &&
			((next >= 0x30 && next <= 0x39) || (next >= 0x41 && next <= 0x5a) || (next >= 0x61 && next <= 0x7a) || next === 0x5f);
		if (!continues) return true;
	}
	return false;
}

/**
 * Release version a loaded addon reports: the post-link stamp for current
 * addons, the legacy sentinel export name for pre-stamp releases, `null` for
 * unstamped builds and addons that predate both.
 * @param {Record<string, unknown>} bindings
 * @returns {string | null}
 */
export function bindingsReleaseVersion(bindings) {
	const report = bindings.__piNativesBuildVersion;
	if (typeof report === "function") {
		try {
			const version = report();
			return typeof version === "string" && version.length > 0 ? version : null;
		} catch {
			return null;
		}
	}
	for (const key of Object.keys(bindings)) {
		const match = LEGACY_SENTINEL_RE.exec(key);
		if (match) return match[1].replace(/_/g, ".");
	}
	return null;
}

/**
 * True when the bindings identify their release at all (stamp reader or
 * legacy sentinel), i.e. they are not a pre-sentinel addon.
 * @param {Record<string, unknown>} bindings
 * @returns {boolean}
 */
export function bindingsHaveReleaseIdentity(bindings) {
	return (
		typeof bindings.__piNativesBuildVersion === "function" ||
		Object.keys(bindings).some(key => LEGACY_SENTINEL_RE.test(key))
	);
}

<<<<<<< ours — function `versionSentinelFor` (T+F, confidence: medium)
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
/**
 * Return the version sentinel exported by an addon built for `packageVersion`.
 * @param {string} packageVersion
 * @returns {string}
 */
export function versionSentinelFor(packageVersion) {
	return `${VERSION_SENTINEL_PREFIX}${packageVersion.replace(/[^A-Za-z0-9]/g, "_")}`;
}
=======
>>>>>>> theirs — function `versionSentinelFor` (T+F, confidence: medium)

/**
 * Whether `name` is a release sentinel under any recognized prefix.
 * @param {string} name
 * @returns {boolean}
 */
export function isVersionSentinelName(name) {
	return VERSION_SENTINEL_ANY_RE.test(name);
}

/**
 * Release version encoded in a sentinel name, as dotted segments. `null` when
 * `name` is not a sentinel under a recognized prefix.
 * @param {string} name
 * @returns {string | null}
 */
export function versionSentinelVersion(name) {
	if (!VERSION_SENTINEL_ANY_RE.test(name)) return null;
	const prefix = VERSION_SENTINEL_PREFIXES.find(candidate => name.startsWith(candidate));
	if (prefix === undefined) return null;
	return name.slice(prefix.length).replace(/_/g, ".");
}

<<<<<<< ours — function `containsVersionSentinel` (T+F, confidence: medium)
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
/**
 * Check for an exact version sentinel rather than a longer sentinel with the
 * expected value as its prefix (e.g. `__tauNativesV18_1_10` must not satisfy a
 * lookup for `__tauNativesV18_1_1`).
 * @param {Buffer} bytes
 * @param {string} expected
 * @returns {boolean}
 */
export function containsVersionSentinel(bytes, expected) {
	if (expected.length === 0) return false;
	let offset = 0;
	while (offset < bytes.length) {
		const index = bytes.indexOf(expected, offset);
		if (index === -1) return false;
		const next = bytes[index + expected.length];
		if (next === undefined || !isIdentifierByte(next)) return true;
		offset = index + expected.length;
	}
	return false;
}
=======
>>>>>>> theirs — function `containsVersionSentinel` (T+F, confidence: medium)
