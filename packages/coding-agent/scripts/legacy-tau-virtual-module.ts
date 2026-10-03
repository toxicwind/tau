import * as path from "node:path";
import { isEnoent } from "@tau/tau-utils/fs-error";

/** Build-time specifier resolved to bundled legacy Pi module namespaces. */
export const LEGACY_PI_MODULES_SPECIFIER = "tau-legacy-tau-modules";

const VIRTUAL_NAMESPACE = "tau-legacy-tau-modules-build";
const packageDir = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(packageDir, "..", "..");

interface BundledPackage {
	readonly dir: string;
	readonly identifier: string;
	readonly rootShim: string | null;
	/**
	 * Previously published package name, registered alongside `manifest.name`.
	 * A rebrand changes what the manifest is called, not what the extension
	 * ecosystem imports: the runtime shim only ever looks up `@tau/*`
	 * keys (see `PI_PACKAGE_NAMES` in legacy-tau-compat.ts), so dropping the
	 * old name from this registry makes every legacy extension importing it
	 * fail with "no bundled module registered".
	 */
	readonly legacyName?: string;
}

const BUNDLED_PACKAGES: readonly BundledPackage[] = [
	{ dir: "agent", identifier: "PiAgentCore", rootShim: null },
	{ dir: "ai", identifier: "PiAi", rootShim: "legacy-tau-ai-shim.ts" },
	{
		dir: "coding-agent",
		identifier: "PiCodingAgent",
		rootShim: "legacy-tau-coding-agent-shim.ts",
		// Renamed to `tau` in the tau->tau rebrand; the published scope did not move with it.
		legacyName: "tau",
	},
	{ dir: "natives", identifier: "PiNatives", rootShim: null },
	{ dir: "tui", identifier: "PiTui", rootShim: "legacy-tau-tui-shim.ts" },
	{ dir: "utils", identifier: "PiUtils", rootShim: null },
];

const TYPEBOX_MODULE_KEY = "typebox";
const TYPEBOX_COMPAT_MODULE = "legacy-typebox.ts";
const SKIPPED_WILDCARD_BASENAMES = new Set(["index"]);
const MAIN_THREAD_UNSAFE_WILDCARD_BASENAMES = new Set(["worker-entry"]);

/** One namespace module the binary must retain for legacy extension imports. */
export interface BundledPiEntry {
	/** Canonical import key exposed to extensions. */
	readonly key: string;
	/** Unique identifier used by the virtual module's generated import. */
	readonly binding: string;
	/** Package or absolute source specifier compiled into the binary. */
	readonly importSpecifier: string;
}

interface WildcardPattern {
	readonly exportPrefix: string;
	readonly exportSuffix: string;
	readonly sourcePrefix: string;
	readonly sourceSuffix: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bindingForSubpath(identifier: string, subpath: string): string {
	const segments = subpath
		.split("/")
		.filter(Boolean)
		.map(segment =>
			segment
				.split(/[-_]/)
				.filter(Boolean)
				.map(part => part.charAt(0).toUpperCase() + part.slice(1))
				.join(""),
		);
	return `bundled${identifier}${segments.join("")}`;
}

function isSafeWildcardBasename(basename: string): boolean {
	if (!basename || basename.startsWith(".") || basename.startsWith("_")) return false;
	if (SKIPPED_WILDCARD_BASENAMES.has(basename)) return false;
	if (MAIN_THREAD_UNSAFE_WILDCARD_BASENAMES.has(basename)) return false;
	return !/\.(test|spec|d|generated|bench)$/.test(basename);
}

function parseWildcardPattern(exportKey: string, sourcePattern: string): WildcardPattern | null {
	const exportStar = exportKey.indexOf("*");
	const sourceStar = sourcePattern.indexOf("*");
	if (exportStar === -1 || sourceStar === -1) return null;
	if (exportKey.indexOf("*", exportStar + 1) !== -1) return null;
	if (sourcePattern.indexOf("*", sourceStar + 1) !== -1) return null;
	if (!sourcePattern.startsWith("./")) return null;
	return {
		exportPrefix: exportKey.slice(2, exportStar),
		exportSuffix: exportKey.slice(exportStar + 1),
		sourcePrefix: sourcePattern.slice(2, sourceStar),
		sourceSuffix: sourcePattern.slice(sourceStar + 1),
	};
}

function exportImportTarget(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (isRecord(value) && typeof value.import === "string") return value.import;
	return null;
}

function shimSpecifier(file: string): string {
	return path.join(packageDir, "src", "extensibility", file);
}

/**
 * Derive the bundled legacy Pi module surface from current package exports.
 * Named wildcard exports are expanded from source; root catch-alls stay out to
 * avoid importing CLI entrypoints and other non-extension surfaces.
 */
export async function collectBundledPiEntries(): Promise<BundledPiEntry[]> {
	const entries: BundledPiEntry[] = [];
	const seenKeys = new Set<string>();
	// Static-shaped lookup: binding -> the one import target it may load. Also
	// serves as the "binding already emitted" test.
	const importSpecifierByBinding: Record<string, string> = {};
	function addEntry(key: string, binding: string, importSpecifier: string): void {
		if (seenKeys.has(key)) return;
		// One binding backs several registry keys (a rebranded package is
		// reachable under both names), so a repeat is only legal when it agrees
		// on the import target. The generated loader emits one `const` per
		// binding, and two different targets would collide on it.
		const claimed = importSpecifierByBinding[binding];
		if (claimed !== undefined && claimed !== importSpecifier) {
			throw new Error(`Duplicate bundled Pi binding ${binding} for ${key}`);
		}
		seenKeys.add(key);
		importSpecifierByBinding[binding] = importSpecifier;
		entries.push({ key, binding, importSpecifier });
	}

	for (const pkg of BUNDLED_PACKAGES) {
		const packageRoot = path.join(repoRoot, "packages", pkg.dir);
		const manifestPath = path.join(packageRoot, "package.json");
		const manifest: unknown = await Bun.file(manifestPath).json();
		if (!isRecord(manifest) || typeof manifest.name !== "string") {
			throw new Error(`Bundled Pi package manifest has no name: ${manifestPath}`);
		}
		const exportsField = isRecord(manifest.exports) ? manifest.exports : {};
		const rootSpecifier = pkg.rootShim ? shimSpecifier(pkg.rootShim) : manifest.name;

		// Enumerate the package's subpath surface once, then register it under
		// every name the package answers to. Registry keys are what extensions
		// import; import specifiers stay on the real package name, so a rebrand
		// can never strand a subpath that only resolves under the new name.
		const subpaths: string[] = [];
		for (const exportKey in exportsField) {
			if (!exportKey.startsWith("./") || exportKey === "." || exportKey.includes("*")) continue;
			subpaths.push(exportKey.slice(2));
		}

		for (const exportKey in exportsField) {
			if (!exportKey.startsWith("./") || exportKey === "." || !exportKey.includes("*")) continue;
			const sourcePattern = exportImportTarget(exportsField[exportKey]);
			if (!sourcePattern) continue;
			const pattern = parseWildcardPattern(exportKey, sourcePattern);
			if (!pattern || !/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/.test(pattern.sourceSuffix)) continue;
			if (pattern.exportPrefix === "" || pattern.exportPrefix === "/") continue;

			const sourceDir = path.join(packageRoot, pattern.sourcePrefix);
			try {
				// Recursive on purpose: Node matches `*` in an `exports` pattern across
				// `/`, so `./slash-commands/*` genuinely serves
				// `slash-commands/helpers/active-oauth-account`. Enumerating only the
				// top level left every nested key out of the compiled registry, where
				// it fell through to `Bun.resolveSync` and died under bunfs — so such
				// an import worked from source and failed inside a binary.
				const glob = new Bun.Glob(`**/*${pattern.sourceSuffix}`);
				const matches: string[] = [];
				for await (const match of glob.scan({ cwd: sourceDir, onlyFiles: true })) {
					// Bun.Glob yields host separators; the export keys and generated
					// identifiers below are `/`-shaped. Same normalization as
					// `generate-docs-index.ts`.
					matches.push(match.split(path.sep).join("/"));
				}
				matches.sort();
				for (const match of matches) {
					if (!match.endsWith(pattern.sourceSuffix)) continue;
					const basename = match.slice(0, match.length - pattern.sourceSuffix.length);
					const segments = basename.split("/");
					// Every directory on the way has to be importable too: a private or
					// hidden folder is no more exported than a private file.
					if (segments.some(segment => segment.startsWith(".") || segment.startsWith("_"))) continue;
					if (!isSafeWildcardBasename(segments.at(-1) ?? "")) continue;
					subpaths.push(`${pattern.exportPrefix}${basename}${pattern.exportSuffix}`);
				}
			} catch (error) {
				if (!isEnoent(error)) throw error;
			}
		}

		const registryNames = pkg.legacyName ? [manifest.name, pkg.legacyName] : [manifest.name];
		for (const registryName of registryNames) {
			addEntry(registryName, `bundled${pkg.identifier}`, rootSpecifier);
			for (const subpath of subpaths) {
				addEntry(
					`${registryName}/${subpath}`,
					bindingForSubpath(pkg.identifier, subpath),
					`${manifest.name}/${subpath}`,
				);
			}
		}
	}

	addEntry(TYPEBOX_MODULE_KEY, "bundledTypeBoxShim", shimSpecifier(TYPEBOX_COMPAT_MODULE));
	return entries;
}

/** Render the lazy loader registry; exported so tests can execute the generated module. */
export function __renderLegacyPiVirtualModule(entries: readonly BundledPiEntry[]): string {
	// One `const` per binding: aliased registry keys share their binding, so
	// emitting per entry would redeclare the same identifier.
	const loaders: string[] = [];
	const emittedBindings = new Set<string>();
	for (const entry of entries) {
		if (emittedBindings.has(entry.binding)) continue;
		emittedBindings.add(entry.binding);
		loaders.push(`const ${entry.binding} = () => import(${JSON.stringify(entry.importSpecifier)});`);
	}
	const modules = entries.map(entry => `\t${JSON.stringify(entry.key)}: ${entry.binding},`);
	return [...loaders, "", "export const BUNDLED_PI_MODULE_LOADERS = {", ...modules, "};", ""].join("\n");
}

/**
 * Build plugin that materializes lazy legacy Pi module loaders entirely in
 * memory. Literal dynamic imports retain every compile-time edge without
 * evaluating unrelated host modules during extension bootstrap.
 */
export async function createLegacyPiVirtualModulePlugin(): Promise<Bun.BunPlugin> {
	const source = __renderLegacyPiVirtualModule(await collectBundledPiEntries());
	return {
		name: "tau:legacy-tau-modules",
		setup(build) {
			build.onResolve({ filter: /^tau-legacy-tau-modules$/ }, () => ({
				path: LEGACY_PI_MODULES_SPECIFIER,
				namespace: VIRTUAL_NAMESPACE,
			}));
			build.onLoad({ filter: /.*/, namespace: VIRTUAL_NAMESPACE }, () => ({ contents: source, loader: "ts" }));
		},
	};
}
