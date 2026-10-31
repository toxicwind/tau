/**
 * Layout + registry config for the legacy Pi compatibility layer.
 *
 * Single source of truth for every specifier, namespace, scheme, shim
 * filename, scope alias, subpath remap, and bundled-package entry used by
 * the runtime shim, the build plugin, and the test seams.
 *
 * This is NOT `legacy-pi-contract.ts`. That manifest tracks the *upstream*
 * export surface for drift checking. This file tracks *our* internal layout.
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

/** On-disk layout segments, relative to the coding-agent package root. */
export interface LegacyPiLayout {
	/** Repo-relative directory containing the workspace packages. */
	readonly packagesDirname: string;
	/** Package-relative segments for the extensibility source directory. */
	readonly extensibilityDir: readonly string[];
	/** Package-relative segments for the extensibility/plugins source directory. */
	readonly pluginsDir: readonly string[];
	/** Package-relative segments for this modular directory. */
	readonly legacyPiDir: readonly string[];
	/** Segments from `<package>/scripts` up to the package root. */
	readonly packageRootFromScriptDir: readonly string[];
	/** Segments from the package root up to the repo root. */
	readonly repoRootFromPackageRoot: readonly string[];
}

/** The frozen config shape exported as {@link LEGACY_PI_CONFIG}. */
export interface LegacyPiConfig {
	readonly canonicalScope: string;
	readonly scopeAliases: readonly string[];
	readonly bareEntrypoints: readonly string[];
	readonly packageNames: readonly string[];
	readonly subpathRemaps: readonly (readonly [string, string])[];

	readonly virtualModuleSpecifier: string;
	readonly virtualModuleBuildNamespace: string;
	readonly bundledVirtualScheme: string;
	readonly bundledVirtualNamespace: string;
	readonly bundledHostNamespace: string;

	readonly typeboxModuleKey: string;
	readonly typeboxSpecifiers: readonly string[];

	readonly shims: LegacyPiShimFilenames;
	readonly layout: LegacyPiLayout;
	readonly packages: readonly LegacyPiBundledPackage[];

	readonly skippedWildcardBasenames: readonly string[];
	readonly mainThreadUnsafeWildcardBasenames: readonly string[];
	readonly sourceExtensionsRegex: RegExp;

	readonly sourceModuleExtensions: readonly string[];
	readonly nativeAddonExtension: string;
}

/**
 * Canonical layout + registry constants for the legacy Pi compatibility
 * layer. Frozen at module load; consumers that need a `Map`/`RegExp` build it
 * via the helpers below rather than storing stateful objects here.
 */
export const LEGACY_PI_CONFIG: LegacyPiConfig = Object.freeze({
	// ── Specifier remapping ────────────────────────────────────────────
	canonicalScope: "@tau",
	scopeAliases: ["tau", "oh-my-pi", "mariozechner", "earendil-works"] as const,
	bareEntrypoints: ["tau", "oh-my-pi", "pi"] as const,
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
	virtualModuleSpecifier: "tau-legacy-tau-modules",
	virtualModuleBuildNamespace: "tau-legacy-tau-modules-build",
	bundledVirtualScheme: "tau-legacy-tau-bundled:",
	bundledVirtualNamespace: "tau-legacy-tau-bundled",
	bundledHostNamespace: "tau-legacy-tau-host",

	// ── TypeBox ────────────────────────────────────────────────────────
	typeboxModuleKey: "typebox",
	typeboxSpecifiers: ["typebox", "@sinclair/typebox"] as const,

	// ── Shim filenames ─────────────────────────────────────────────────
	shims: Object.freeze({
		typebox: "legacy-typebox.ts",
		ai: "legacy-tau-ai-shim.ts",
		codingAgent: "legacy-tau-coding-agent-shim.ts",
		tui: "legacy-tau-tui-shim.ts",
	} as const satisfies LegacyPiShimFilenames),

	// ── On-disk layout ─────────────────────────────────────────────────
	layout: Object.freeze({
		packagesDirname: "packages",
		extensibilityDir: ["src", "extensibility"] as const,
		pluginsDir: ["src", "extensibility", "plugins"] as const,
		legacyPiDir: ["src", "extensibility", "plugins", "legacy-pi"] as const,
		packageRootFromScriptDir: [".."] as const,
		repoRootFromPackageRoot: ["..", ".."] as const,
	} as const satisfies LegacyPiLayout),

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
	skippedWildcardBasenames: ["index"] as const,
	mainThreadUnsafeWildcardBasenames: ["worker-entry"] as const,
	sourceExtensionsRegex: /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/,

	// ── Path-resolution extensions ─────────────────────────────────────
	sourceModuleExtensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const,
	nativeAddonExtension: ".node",
});

/** Convenience alias for the registry array. */
export const LEGACY_PI_BUNDLED_PACKAGES: readonly LegacyPiBundledPackage[] = LEGACY_PI_CONFIG.packages;

/** Build the scope/package specifier filter from {@link LEGACY_PI_CONFIG}. */
export function buildLegacyPiSpecifierFilter(): RegExp {
	const scopeAlt = LEGACY_PI_CONFIG.scopeAliases.join("|");
	const pkgAlt = LEGACY_PI_CONFIG.packageNames.join("|");
	return new RegExp(`^(?:@(?:${scopeAlt})/(?:${pkgAlt})|tau|oh-my-pi|pi)(?:/.*)?$`);
}

/** Build the TypeBox bare-specifier filter from {@link LEGACY_PI_CONFIG}. */
export function buildTypeBoxSpecifierFilter(): RegExp {
	const escaped = LEGACY_PI_CONFIG.typeboxSpecifiers.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	return new RegExp(`^(?:${escaped.join("|")})$`);
}

/** Build a lookup map for {@link LEGACY_PI_CONFIG}.subpathRemaps. */
export function buildLegacyPiSubpathRemaps(): ReadonlyMap<string, string> {
	return new Map<string, string>(LEGACY_PI_CONFIG.subpathRemaps);
}
