/** Prefix every post-rebuild native addon emits. */
export const VERSION_SENTINEL_PREFIX: string;

/** Prefix pre-rebrand native addons still emit. */
export const LEGACY_VERSION_SENTINEL_PREFIX: string;

/** Every prefix that names a release sentinel. Current first. */
export const VERSION_SENTINEL_PREFIXES: string[];

/** Matches `<prefix><version-with-underscores>` for any recognized prefix. */
export const VERSION_SENTINEL_NAME_SOURCE: string;

/** Whether `name` is a release sentinel under any recognized prefix. */
export function isVersionSentinelName(name: string): boolean;

/** Release version encoded in a sentinel name, or `null` when it is not one. */
export function versionSentinelVersion(name: string): string | null;

/** Prefix of the post-link stamp slot linked into every addon. */
export const VERSION_STAMP_MAGIC: string;

/** Total stamp slot size in bytes: magic, version, NUL padding. */
export const VERSION_STAMP_SIZE: number;

/** Check whether addon bytes carry the stamp for exactly `version`. */
export function containsVersionStamp(bytes: Uint8Array, version: string): boolean;

/** Check whether pre-stamp addon bytes export the legacy `__piNativesV*` sentinel for exactly `version`. */
export function containsLegacyVersionSentinel(bytes: Uint8Array, version: string): boolean;

/** Release a loaded addon reports (stamp, or legacy `__piNativesV*` export), or `null`. */
export function bindingsReleaseVersion(bindings: Record<string, unknown>): string | null;

/** True when the bindings identify their release at all (stamp reader or legacy sentinel). */
export function bindingsHaveReleaseIdentity(bindings: Record<string, unknown>): boolean;
