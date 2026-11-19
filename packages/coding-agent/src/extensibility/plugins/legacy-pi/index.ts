/**
 * Public surface of the legacy Pi compatibility layer.
 *
 * Consumers import from this barrel rather than reaching into subdirectories,
 * so the internal module layout can evolve without churning call sites.
 *
 * The layer is not yet complete: this barrel currently exposes the config,
 * shared types, specifier classification, and source analysis modules. The
 * resolution / graph / rewrite modules land next and will be re-exported here
 * as they arrive.
 */

// Config
export {
	buildLegacyPiSpecifierFilter,
	buildLegacyPiSubpathRemaps,
	buildTypeBoxSpecifierFilter,
	LEGACY_PI_BUNDLED_PACKAGES,
	LEGACY_PI_CONFIG,
	type LegacyPiBundledPackage,
	type LegacyPiConfig,
	type LegacyPiLayout,
	type LegacyPiShimFilenames,
} from "./config";

// Types
export {
	EXPORTS_BINDING,
	MODULE_BINDING,
	REQUIRE_BINDING,
	type BindingScope,
	type ExtensionAst,
	type ExtensionSourceAnalysis,
	type ExtensionSpecifierReference,
	type ScopedAstNode,
	type StructuralAstNode,
} from "./types";

// Specifier classification
export {
	escapeRegExp,
	isBareExtensionDependencySpecifier,
	splitBarePackageSpecifier,
	type BarePackageSpecifier,
} from "./specifier/classify";

// Analysis
export { AstParser } from "./analysis/ast-parser";
export { EXTENSION_PARSE_CACHE_SCHEMA_VERSION, ExtensionParseCache } from "./analysis/analysis-cache";
export { extensionParseCacheKey, SourceAnalyzer } from "./analysis/source-analyzer";
