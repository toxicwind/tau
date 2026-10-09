/**
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

/**
 * Return the version sentinel exported by an addon built for `packageVersion`.
 * @param {string} packageVersion
 * @returns {string}
 */
export function versionSentinelFor(packageVersion) {
	return `${VERSION_SENTINEL_PREFIX}${packageVersion.replace(/[^A-Za-z0-9]/g, "_")}`;
}

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
