/**
 * Shared structural types for the legacy Pi compatibility layer.
 *
 * These types give every analysis, resolution, and rewrite module a single
 * vocabulary for AST nodes, scopes, and specifier references. The binding
 * flags are runtime bitmasks and are re-exported alongside the types because
 * they are only meaningful in this layer.
 */
import type { ParseResult } from "@babel/parser";

/** A parsed extension source file, as produced by `AstParser.parse`. */
export type ExtensionAst = ParseResult;

/** A single import/require site in an extension source file. */
export interface ExtensionSpecifierReference {
	readonly kind: "import" | "require";
	readonly specifier: string;
	/** Byte offset where the specifier literal begins (inclusive). */
	readonly start: number;
	/** Byte offset where the specifier literal ends (exclusive). */
	readonly end: number;
}

/**
 * Structural view of a Babel AST node. The parser hands back `ParseResult`
 * with `@babel/types` nodes; we walk them structurally because the full
 * `@babel/types` traversal machinery is not needed for our lexical analysis.
 */
export interface StructuralAstNode {
	readonly type: string;
	readonly [key: string]: unknown;
}

/** Lexical scope frame tracked during `AstParser.collectScoped`. */
export interface BindingScope {
	readonly parent: BindingScope | null;
	readonly ownsVarBindings: boolean;
	bindings: number;
}

/** A node selected by `AstParser.collectScoped`, paired with its scope. */
export interface ScopedAstNode {
	readonly node: StructuralAstNode;
	readonly scope: BindingScope;
	/** Visit order, used as a deterministic tie-break for equal `start` offsets. */
	readonly order: number;
}

// Binding-flag bitmasks. Mark whether a `require` / `exports` / `module`
// identifier is shadowed by a local binding in the current lexical scope.
export const REQUIRE_BINDING = 1 << 0;
export const EXPORTS_BINDING = 1 << 1;
export const MODULE_BINDING = 1 << 2;

/** Analysis of one source file's imports/requires and CommonJS-shaped syntax. */
export interface ExtensionSourceAnalysis {
	readonly sourceType: "script" | "module";
	readonly references: readonly ExtensionSpecifierReference[];
	/**
	 * Script source with an unshadowed `require(...)`, `exports`, or
	 * `module.exports` use. Always `false` for modules.
	 */
	readonly hasCommonJsSyntax: boolean;
}
