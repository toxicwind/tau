/**
 * Babel-backed lexical analysis for extension source files.
 *
 * `AstParser` owns three concerns that used to be inlined in the monolith:
 * parsing source with an extension-appropriate plugin set, walking the AST
 * to build lexical scope frames, and enumerating every static/dynamic/
 * re-export/CommonJS-require specifier with its byte range. It also exposes
 * the CommonJS-shaped-syntax predicate that used to be a closure inside the
 * analysis cache.
 *
 * All scope-walk helpers stay file-local: they are pure and stateless, and
 * exporting them would just widen the module's surface without any consumer
 * needing them.
 */
import * as path from "node:path";
import type { ParseResult, ParserPlugin } from "@babel/parser";
import { parse as parseBabel } from "@babel/parser";
import { isBareExtensionDependencySpecifier } from "../specifier/classify";
import {
	EXPORTS_BINDING,
	MODULE_BINDING,
	REQUIRE_BINDING,
	type BindingScope,
	type ExtensionSpecifierReference,
	type ScopedAstNode,
	type StructuralAstNode,
} from "../types";

// ── AST structural helpers ─────────────────────────────────────────────

function asAstNode(value: unknown): StructuralAstNode | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as { readonly type?: unknown };
	return typeof candidate.type === "string" ? (candidate as StructuralAstNode) : null;
}

function nodeArray(node: StructuralAstNode, key: string): readonly unknown[] | null {
	const value = node[key];
	return Array.isArray(value) ? value : null;
}

function nodeArgument(node: StructuralAstNode | null, index: number): StructuralAstNode | null {
	if (!node) return null;
	const values = nodeArray(node, "arguments");
	return values ? asAstNode(values[index]) : null;
}

function isIdentifier(node: StructuralAstNode | null, name: string): boolean {
	return node?.type === "Identifier" && node.name === name;
}

// ── Binding tracking ───────────────────────────────────────────────────

function trackedBinding(name: unknown): number {
	switch (name) {
		case "require":
			return REQUIRE_BINDING;
		case "exports":
			return EXPORTS_BINDING;
		case "module":
			return MODULE_BINDING;
		default:
			return 0;
	}
}

function addPatternBindings(scope: BindingScope, pattern: unknown): void {
	const stack: unknown[] = [pattern];
	while (stack.length > 0) {
		const node = asAstNode(stack.pop());
		if (!node) continue;
		switch (node.type) {
			case "Identifier":
				scope.bindings |= trackedBinding(node.name);
				break;
			case "AssignmentPattern":
				stack.push(node.left);
				break;
			case "RestElement":
				stack.push(node.argument);
				break;
			case "ArrayPattern": {
				const elements = nodeArray(node, "elements");
				if (elements) stack.push(...elements);
				break;
			}
			case "ObjectPattern": {
				const properties = nodeArray(node, "properties");
				if (!properties) break;
				for (const value of properties) {
					const property = asAstNode(value);
					if (!property) continue;
					stack.push(property.type === "RestElement" ? property.argument : property.value);
				}
				break;
			}
			case "TSParameterProperty":
				stack.push(node.parameter);
				break;
		}
	}
}

// ── Scope classification ───────────────────────────────────────────────

function isFunctionScopeNode(node: StructuralAstNode): boolean {
	switch (node.type) {
		case "FunctionDeclaration":
		case "FunctionExpression":
		case "ArrowFunctionExpression":
		case "ObjectMethod":
		case "ClassMethod":
		case "ClassPrivateMethod":
		case "TSDeclareFunction":
		case "TSDeclareMethod":
		case "DeclareFunction":
			return true;
		default:
			return false;
	}
}

function isFunctionDeclarationNode(node: StructuralAstNode): boolean {
	return node.type === "FunctionDeclaration" || node.type === "TSDeclareFunction" || node.type === "DeclareFunction";
}

function isClassScopeNode(node: StructuralAstNode): boolean {
	return node.type === "ClassDeclaration" || node.type === "ClassExpression";
}

function scopeKind(node: StructuralAstNode, parent: StructuralAstNode | null, parentKey: string | null): 0 | 1 | 2 {
	if (
		node.type === "Program" ||
		isFunctionScopeNode(node) ||
		node.type === "StaticBlock" ||
		node.type === "TSModuleBlock"
	) {
		return 2;
	}
	if (
		isClassScopeNode(node) ||
		node.type === "CatchClause" ||
		node.type === "ForStatement" ||
		node.type === "ForInStatement" ||
		node.type === "ForOfStatement" ||
		node.type === "SwitchStatement"
	) {
		return 1;
	}
	if (node.type === "BlockStatement" && !(parent && isFunctionScopeNode(parent) && parentKey === "body")) {
		return 1;
	}
	return 0;
}

function nearestVarScope(scope: BindingScope): BindingScope {
	let current = scope;
	while (!current.ownsVarBindings && current.parent) current = current.parent;
	return current;
}

function registerOuterDeclaration(node: StructuralAstNode, scope: BindingScope | null): void {
	if (!scope) return;
	if (
		(isFunctionDeclarationNode(node) && node.type !== "TSDeclareFunction" && node.type !== "DeclareFunction") ||
		(node.type === "ClassDeclaration" && node.declare !== true)
	) {
		addPatternBindings(scope, node.id);
	}
}

function registerScopeBindings(node: StructuralAstNode, scope: BindingScope): void {
	if (isFunctionScopeNode(node)) {
		addPatternBindings(scope, node.id);
		const parameters = nodeArray(node, "params");
		if (parameters) {
			for (const parameter of parameters) addPatternBindings(scope, parameter);
		}
	}
	if (isClassScopeNode(node)) addPatternBindings(scope, node.id);
	if (node.type === "CatchClause") addPatternBindings(scope, node.param);

	if (node.type === "ImportDeclaration") {
		const specifiers = nodeArray(node, "specifiers");
		if (specifiers) {
			for (const value of specifiers) {
				const specifier = asAstNode(value);
				if (specifier) addPatternBindings(scope, specifier.local);
			}
		}
	} else if (node.type === "TSImportEqualsDeclaration") {
		addPatternBindings(scope, node.id);
	} else if (node.type === "VariableDeclaration") {
		const target = node.kind === "var" ? nearestVarScope(scope) : scope;
		const declarations = nodeArray(node, "declarations");
		if (declarations) {
			for (const value of declarations) {
				const declaration = asAstNode(value);
				if (declaration) addPatternBindings(target, declaration.id);
			}
		}
	}
}

function isAstMetadataKey(key: string): boolean {
	switch (key) {
		case "loc":
		case "extra":
		case "range":
		case "comments":
		case "tokens":
		case "errors":
		case "leadingComments":
		case "trailingComments":
		case "innerComments":
		case "parent":
		case "parentPath":
		case "scope":
		case "hub":
			return true;
		default:
			return false;
	}
}

function scopeForChild(
	node: StructuralAstNode,
	key: string,
	outerScope: BindingScope | null,
	nodeScope: BindingScope,
): BindingScope {
	if (node.type === "SwitchStatement" && key === "discriminant") {
		return outerScope ?? nodeScope;
	}
	if (isFunctionScopeNode(node) && (key === "key" || key === "decorators")) {
		return outerScope ?? nodeScope;
	}
	if (isClassScopeNode(node) && key === "decorators") {
		return outerScope ?? nodeScope;
	}
	return nodeScope;
}

// ── Specifier-reference classification ─────────────────────────────────

function scopeHasBinding(scope: BindingScope, binding: number): boolean {
	let current: BindingScope | null = scope;
	while (current) {
		if ((current.bindings & binding) !== 0) return true;
		current = current.parent;
	}
	return false;
}

function isSpecifierReferenceNode(node: StructuralAstNode): boolean {
	switch (node.type) {
		case "ImportDeclaration":
		case "ExportNamedDeclaration":
		case "ExportAllDeclaration":
		case "ImportExpression":
		case "TSImportEqualsDeclaration":
		case "CallExpression":
			return true;
		default:
			return false;
	}
}

function isUncomputedMember(node: StructuralAstNode | null, objectName: string, propertyName: string): boolean {
	if (node?.type !== "MemberExpression" || node.computed === true) return false;
	return isIdentifier(asAstNode(node.object), objectName) && isIdentifier(asAstNode(node.property), propertyName);
}

function isUnshadowedExportsTarget(node: StructuralAstNode | null, scope: BindingScope): boolean {
	return (
		(isIdentifier(node, "exports") && !scopeHasBinding(scope, EXPORTS_BINDING)) ||
		(isUncomputedMember(node, "module", "exports") && !scopeHasBinding(scope, MODULE_BINDING))
	);
}

function isGlobalRequireCall(node: StructuralAstNode | null, scope: BindingScope): boolean {
	return (
		node?.type === "CallExpression" &&
		isIdentifier(asAstNode(node.callee), "require") &&
		!scopeHasBinding(scope, REQUIRE_BINDING)
	);
}

function staticMemberPropertyName(node: StructuralAstNode): string | null {
	const property = asAstNode(node.property);
	if (node.computed !== true && property?.type === "Identifier" && typeof property.name === "string") {
		return property.name;
	}
	if (node.computed === true && property?.type === "StringLiteral" && typeof property.value === "string") {
		return property.value;
	}
	return null;
}

function isCreateRequireInvocation(
	node: StructuralAstNode | null,
	createRequireBindings: ReadonlySet<string>,
	moduleNamespaceBindings: ReadonlySet<string>,
): boolean {
	if (node?.type !== "CallExpression") return false;
	const callee = asAstNode(node.callee);
	if (callee?.type === "Identifier" && typeof callee.name === "string") {
		return createRequireBindings.has(callee.name);
	}
	if (callee?.type !== "MemberExpression" || staticMemberPropertyName(callee) !== "createRequire") return false;
	const object = asAstNode(callee.object);
	return object?.type === "Identifier" && typeof object.name === "string" && moduleNamespaceBindings.has(object.name);
}

interface ScopeWalkItem {
	readonly node: StructuralAstNode;
	readonly scope: BindingScope | null;
	readonly parent: StructuralAstNode | null;
	readonly parentKey: string | null;
}

// ── Public surface ─────────────────────────────────────────────────────

/**
 * Parses an extension source file and exposes its lexical structure.
 *
 * Stateless: every method is pure and can be called concurrently. The class
 * exists only to give the three related analyses a single cohesive owner.
 */
export class AstParser {
	/**
	 * Parse a source file with the Babel plugin set appropriate for its
	 * extension, using `errorRecovery` so a file with one unparseable
	 * construct still yields a usable AST for the rest.
	 */
	parse(source: string, importerPath: string): ParseResult {
		const extension = path.extname(importerPath).toLowerCase();
		const plugins: ParserPlugin[] = ["decorators-legacy", "explicitResourceManagement"];
		if (extension === ".ts" || extension === ".mts" || extension === ".cts" || extension === ".tsx") {
			plugins.push("typescript");
		}
		if (extension === ".jsx" || extension === ".tsx") {
			plugins.push("jsx");
		}

		try {
			return parseBabel(source, {
				sourceType: "unambiguous",
				allowAwaitOutsideFunction: true,
				allowReturnOutsideFunction: true,
				allowImportExportEverywhere: true,
				allowNewTargetOutsideFunction: true,
				allowSuperOutsideMethod: true,
				allowUndeclaredExports: true,
				errorRecovery: true,
				plugins,
			});
		} catch (error) {
			throw new Error(
				`Failed to parse extension source for dependency rewriting: ${importerPath}: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			);
		}
	}

	/**
	 * Builds only the lexical information needed by legacy extension
	 * rewriting. Scope frames are fully populated before selected nodes are
	 * returned, so hoisted and TDZ bindings behave independently of textual
	 * declaration order.
	 */
	collectScoped(root: unknown, select: (node: StructuralAstNode) => boolean): ScopedAstNode[] {
		const rootNode = asAstNode(root);
		if (!rootNode) return [];

		const selected: ScopedAstNode[] = [];
		const stack: ScopeWalkItem[] = [{ node: rootNode, scope: null, parent: null, parentKey: null }];
		const seen = new WeakSet<object>();
		let order = 0;
		while (stack.length > 0) {
			const item = stack.pop();
			if (!item || seen.has(item.node)) continue;
			seen.add(item.node);

			registerOuterDeclaration(item.node, item.scope);
			const kind = scopeKind(item.node, item.parent, item.parentKey);
			const activeScope: BindingScope | null =
				kind === 0
					? item.scope
					: {
							parent: item.scope,
							ownsVarBindings: kind === 2,
							bindings: 0,
						};
			if (activeScope) {
				registerScopeBindings(item.node, activeScope);
				if (select(item.node)) selected.push({ node: item.node, scope: activeScope, order });
			}
			order++;

			for (const key in item.node) {
				if (isAstMetadataKey(key)) continue;
				const childScope = activeScope ? scopeForChild(item.node, key, item.scope, activeScope) : null;
				const value = item.node[key];
				if (Array.isArray(value)) {
					for (const element of value) {
						const child = asAstNode(element);
						if (child) stack.push({ node: child, scope: childScope, parent: item.node, parentKey: key });
					}
				} else {
					const child = asAstNode(value);
					if (child) stack.push({ node: child, scope: childScope, parent: item.node, parentKey: key });
				}
			}
		}

		selected.sort((left, right) => {
			const leftStart = typeof left.node.start === "number" ? left.node.start : Number.MAX_SAFE_INTEGER;
			const rightStart = typeof right.node.start === "number" ? right.node.start : Number.MAX_SAFE_INTEGER;
			return leftStart - rightStart || left.order - right.order;
		});
		return selected;
	}

	/**
	 * Collect every static, dynamic, re-export, and direct CommonJS require
	 * specifier in `source`. Parsing keeps import-looking text in strings,
	 * templates, regex literals, and comments out of dependency resolution.
	 */
	collectSpecifierReferences(
		source: string,
		importerPath: string,
		ast: ParseResult = this.parse(source, importerPath),
	): ExtensionSpecifierReference[] {
		const references: ExtensionSpecifierReference[] = [];
		const record = (kind: ExtensionSpecifierReference["kind"], literal: unknown): void => {
			const node = asAstNode(literal);
			if (
				node?.type === "StringLiteral" &&
				typeof node.value === "string" &&
				typeof node.start === "number" &&
				typeof node.end === "number"
			) {
				references.push({ kind, specifier: node.value, start: node.start, end: node.end });
			}
		};

		const createRequireBindings = new Set<string>();
		const moduleNamespaceBindings = new Set<string>();
		for (const { node } of this.collectScoped(ast, candidate => candidate.type === "ImportDeclaration")) {
			const sourceNode = asAstNode(node.source);
			if (
				sourceNode?.type !== "StringLiteral" ||
				(sourceNode.value !== "node:module" && sourceNode.value !== "module")
			) {
				continue;
			}
			for (const value of Array.isArray(node.specifiers) ? node.specifiers : []) {
				const specifier = asAstNode(value);
				const local = asAstNode(specifier?.local);
				if (local?.type !== "Identifier" || typeof local.name !== "string") continue;
				if (specifier?.type === "ImportNamespaceSpecifier") {
					moduleNamespaceBindings.add(local.name);
				} else if (specifier?.type === "ImportSpecifier") {
					const imported = asAstNode(specifier.imported);
					if (
						(imported?.type === "Identifier" && imported.name === "createRequire") ||
						(imported?.type === "StringLiteral" && imported.value === "createRequire")
					) {
						createRequireBindings.add(local.name);
					}
				}
			}
		}

		for (const { node, scope } of this.collectScoped(ast, isSpecifierReferenceNode)) {
			if (
				node.type === "ImportDeclaration" ||
				node.type === "ExportNamedDeclaration" ||
				node.type === "ExportAllDeclaration"
			) {
				record("import", node.source);
			} else if (node.type === "ImportExpression") {
				record("import", node.source);
			} else if (node.type === "TSImportEqualsDeclaration") {
				const moduleReference = asAstNode(node.moduleReference);
				if (moduleReference?.type === "TSExternalModuleReference") {
					record("require", moduleReference.expression);
				}
			} else if (node.type === "CallExpression") {
				const callee = asAstNode(node.callee);
				if (callee?.type === "Import") {
					record("import", nodeArgument(node, 0));
				} else if (isIdentifier(callee, "require") && !scopeHasBinding(scope, REQUIRE_BINDING)) {
					record("require", nodeArgument(node, 0));
				} else if (isCreateRequireInvocation(callee, createRequireBindings, moduleNamespaceBindings)) {
					// `createRequire(base)(spec)` — pin the invoked bare dependency so it
					// loads without a runtime `node_modules` lookup. Relative specifiers
					// resolve against `base`, which is not rewritten, so restrict to bare.
					const argument = nodeArgument(node, 0);
					if (
						argument?.type === "StringLiteral" &&
						typeof argument.value === "string" &&
						isBareExtensionDependencySpecifier(argument.value)
					) {
						record("require", argument);
					}
				}
			}
		}
		return references;
	}

	/**
	 * Whether `ast` is a script that uses `require(...)`, `exports`, or
	 * `module.exports` in an unshadowed position — i.e. a CommonJS-shaped
	 * source. Always returns `false` for module sources; callers that need
	 * the strict `sourceType === "script"` gate should check it themselves.
	 */
	hasCommonJsSyntax(ast: ParseResult): boolean {
		return this.collectScoped(
			ast,
			node => node.type === "CallExpression" || node.type === "MemberExpression",
		).some(({ node, scope }) => {
			if (isGlobalRequireCall(node, scope)) return true;
			if (node.type !== "MemberExpression") return false;
			return isUnshadowedExportsTarget(node, scope) || isUnshadowedExportsTarget(asAstNode(node.object), scope);
		});
	}
}
