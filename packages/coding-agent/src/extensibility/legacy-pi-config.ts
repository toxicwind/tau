/**
 * Shared layout + registry config for the legacy Pi compatibility layer.
 *
 * Both the build-time bundler plugin (`scripts/legacy-tau-virtual-module.ts`)
 * and the runtime specifier shim (`src/extensibility/plugins/legacy-tau-compat.ts`)
 * consume this module. Every specifier, namespace, shim filename, scope alias,
 * subpath remap, and bundled-package entry that used to be inlined at each
 * call site now lives here once.
 *
 * This file is NOT `legacy-pi-contract.ts`: that manifest tracks the *upstream
 * export surface* for drift checking. This file tracks *our* internal layout.
 */

/** One host workspace package retained in the binary for legacy extensions. */
export interface LegacyPiBundledPackage {
	/** Workspace directory name under `packages/`. */
	readonly dir: string;
	/** Unique identifier prefix for generated loader bindings. */
	readonly identifier: string;
	/** Compat shim filename (relative to the extensibility source dir), or null. */
	readonly rootShim: string | null;
	/**
	 * Previously published package name, registered alongside `manifest.name`.
	 * A rebrand changes the manifest name, not what the extension ecosystem
	 * imports; dropping the old name makes every legacy extension importing it
	 * fail with "no bundled module registered".
	 */
	readonly legacyName?: string;
}

/** Filenames of the compat shims served in place of canonical package roots. */
export interface LegacyPiShimFilenames {
	/** TypeBox facade served in place of bare `typebox` / `@sinclair/typebox`. */
	readonly typebox: string;
	/** tau-ai root shim re-attaching the removed `Type` / `StringEnum` exports. */
	readonly ai: string;
	/** coding-agent root shim re-attaching legacy package-root helpers. */
	readonly codingAgent: string;
	/** tau-tui root shim preserving `decodeKittyPrintable`. */
	readonly tui: string;
}

/**
 * Canonical layout + registry constants for the legacy Pi compatibility layer.
 *
 * Frozen at module load. Anything that needs a `Map`/`RegExp` should build it
 * from these primitives locally rather than storing a stateful object here.
 */
export const LEGACY_PI_CONFIG = Object.freeze({
	// ── Specifier remapping ────────────────────────────────────────────
	/** Canonical in-process scope every historical pi scope is remapped to. */
	canonicalScope: "@tau",
	/**
	 * Historical scopes that have published (or aliased) the same internal
	 * packages. `@tau` is included so canonical imports flow through the same
	 * host-bundled resolution path instead of pulling a duplicate from
	 * plugin `node_modules`.
	 */
	scopeAliases: ["tau", "oh-my-pi", "mariozechner", "earendil-works"] as const,
	/** Bare entrypoint names treated as the coding-agent root. */
	bareEntrypoints: ["tau", "oh-my-pi", "pi"] as const,
	/** Internal package basenames bundled inside the binary (tau-* + pi-* aliases). */
	packageNames: [
		"tau-agent-core",
		"tau-ai",
		"tau-coding-agent",
		"tau-agent",
		"coding-agent",
		"tau-natives",
		"tau-tui",
		"tau-utils",
		"tau-catalog",
		"pi-agent-core",
		"pi-ai",
		"pi-catalog",
		"pi-coding-agent",
		"pi-natives",
		"pi-tui",
		"pi-utils",
	] as const,
	/**
	 * Upstream-only subpath relocations. Entries ending in `/` rewrite the whole
	 * subtree; add new `pkg/from -> pkg/to` pairs whenever an upstream-only
	 * subpath breaks resolution.
	 */
	subpathRemaps: [
		["tau-agent", "tau-coding-agent"],
		["tau-agent/", "tau-coding-agent/"],
		["coding-agent", "tau-coding-agent"],
		["coding-agent/", "tau-coding-agent/"],
		["pi-coding-agent", "tau-coding-agent"],
		["pi-coding-agent/", "tau-coding-agent/"],
		["pi-tui", "tau-tui"],
		["pi-tui/", "tau-tui/"],
		["pi-ai", "tau-ai"],
		["pi-ai/", "tau-ai/"],
		["pi-agent-core", "tau-agent-core"],
		["pi-agent-core/", "tau-agent-core/"],
		["pi-natives", "tau-natives"],
		["pi-natives/", "tau-natives/"],
		["pi-utils", "tau-utils"],
		["pi-utils/", "tau-utils/"],
		["pi-catalog", "tau-catalog"],
		["pi-catalog/", "tau-catalog/"],
		["tau-ai/utils/oauth", "tau-ai/oauth"],
		["tau-ai/utils/oauth/", "tau-ai/oauth/"],
		["tau-ai/compat", "tau-ai"],
	] as readonly (readonly [string, string])[],

	// ── Virtual module namespace ───────────────────────────────────────
	/** Specifier imported by the runtime shim; provided by the build plugin. */
	virtualModuleSpecifier: "tau-legacy-tau-modules",
	/** Bun plugin namespace owning the generated loader registry. */
	virtualModuleBuildNamespace: "tau-legacy-tau-modules-build",
	/** Scheme for the bundle namespace served via `Bun.plugin onLoad`. */
	bundledVirtualScheme: "tau-legacy-tau-bundled:",
	/** Plugin namespace name for the bundle namespace. */
	bundledVirtualNamespace: "tau-legacy-tau-bundled",
	/** Scheme for the host namespace used to keep live ESM bindings live. */
	bundledHostNamespace: "tau-legacy-tau-host",

	// ── TypeBox ────────────────────────────────────────────────────────
	/** Registry key the TypeBox compat shim is exposed under. */
	typeboxModuleKey: "typebox",
	/** Bare specifiers rewritten to the TypeBox compat shim. */
	typeboxSpecifiers: ["typebox", "@sinclair/typebox"] as const,

	// ── Shim filenames ─────────────────────────────────────────────────
	shims: Object.freeze({
		typebox: "legacy-typebox.ts",
		ai: "legacy-tau-ai-shim.ts",
		codingAgent: "legacy-tau-coding-agent-shim.ts",
		tui: "legacy-tau-tui-shim.ts",
	} as const satisfies LegacyPiShimFilenames),

	// ── On-disk layout ─────────────────────────────────────────────────
	/** Repo-relative directory containing the workspace packages. */
	packagesDirname: "packages",
	/** Package-relative segments for the extensibility source directory. */
	extensibilityDir: ["src", "extensibility"] as const,
	/** Package-relative segments for the extensibility/plugins source directory. */
	pluginsDir: ["src", "extensibility", "plugins"] as const,
	/** Segments from `<package>/scripts` up to the package root. */
	packageRootFromScriptDir: [".."] as const,
	/** Segments from the package root up to the repo root. */
	repoRootFromPackageRoot: ["..", ".."] as const,

	// ── Bundled package registry ───────────────────────────────────────
	packages: [
		{ dir: "agent", identifier: "PiAgentCore", rootShim: null },
		{ dir: "ai", identifier: "PiAi", rootShim: "legacy-tau-ai-shim.ts" },
		{
			dir: "coding-agent",
			identifier: "PiCodingAgent",
			rootShim: "legacy-tau-coding-agent-shim.ts",
			legacyName: "@tau/tau-coding-agent",
		},
		{ dir: "natives", identifier: "PiNatives", rootShim: null },
		{ dir: "tui", identifier: "PiTui", rootShim: "legacy-tau-tui-shim.ts" },
		{ dir: "utils", identifier: "PiUtils", rootShim: null },
		{ dir: "catalog", identifier: "PiCatalog", rootShim: null },
	] as readonly LegacyPiBundledPackage[],

	// ── Wildcard enumeration filters ───────────────────────────────────
	/** Wildcard basenames excluded from subpath enumeration. */
	skippedWildcardBasenames: ["index"] as const,
	/** Wildcard basenames whose evaluation is unsafe on the main thread. */
	mainThreadUnsafeWildcardBasenames: ["worker-entry"] as const,
	/** Source extensions treated as importable modules (test against basenames). */
	sourceExtensionsRegex: /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/,

	// ── Path-resolution extensions ─────────────────────────────────────
	/** Extensions probed when resolving a source module file. */
	sourceModuleExtensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const,
	/** Native addon extension (napi-rs platform package convention). */
	nativeAddonExtension: ".node",
});

/** Alias for callers that just want the registry array by its old name. */
export const LEGACY_PI_BUNDLED_PACKAGES: readonly LegacyPiBundledPackage[] = LEGACY_PI_CONFIG.packages;

/**
 * Build the scope/package specifier filter from {@link LEGACY_PI_CONFIG}.
 *
 * Constructed here (not at each call site) so the runtime shim, the build
 * plugin, and any test share a single compiled `RegExp`.
 */
export function buildLegacyPiSpecifierFilter(): RegExp {
	const scopeAlt = LEGACY_PI_CONFIG.scopeAliases.join("|");
	const pkgAlt = LEGACY_PI_CONFIG.packageNames.join("|");
	return new RegExp(`^(?:@(?:${scopeAlt})/(?:${pkgAlt})|tau|oh-my-pi|pi)(?:/.*)?$`);
}

/**
 * Build the TypeBox bare-specifier filter from {@link LEGACY_PI_CONFIG}.
 *
 * Kept separate from {@link buildLegacyPiSpecifierFilter} because TypeBox is
 * matched *outside* the scope/package scheme (it's a third-party bare name).
 */
export function buildTypeBoxSpecifierFilter(): RegExp {
	const escaped = LEGACY_PI_CONFIG.typeboxSpecifiers.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	return new RegExp(`^(?:${escaped.join("|")})$`);
}

/**
 * Build a lookup map for {@link LEGACY_PI_CONFIG}.subpathRemaps.
 *
 * The map preserves insertion order, so the first matching prefix wins — same
 * as the previous inline `Map` construction.
 */
export function buildLegacyPiSubpathRemaps(): ReadonlyMap<string, string> {
	return new Map<string, string>(LEGACY_PI_CONFIG.subpathRemaps);
}
