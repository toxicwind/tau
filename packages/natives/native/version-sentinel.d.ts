/** Prefix every post-rebuild native addon emits. */
export const VERSION_SENTINEL_PREFIX: string;

/** Prefix pre-rebrand native addons still emit. */
export const LEGACY_VERSION_SENTINEL_PREFIX: string;

/** Every prefix that names a release sentinel. Current first. */
export const VERSION_SENTINEL_PREFIXES: string[];

/** Matches `<prefix><version-with-underscores>` for any recognized prefix. */
export const VERSION_SENTINEL_NAME_SOURCE: string;

/** Return the native-addon export expected for a package version. */
export function versionSentinelFor(packageVersion: string): string;

/** Whether `name` is a release sentinel under any recognized prefix. */
export function isVersionSentinelName(name: string): boolean;

/** Release version encoded in a sentinel name, or `null` when it is not one. */
export function versionSentinelVersion(name: string): string | null;

/** Check whether addon bytes contain the exact expected version sentinel. */
export function containsVersionSentinel(bytes: Buffer, expected: string): boolean;
