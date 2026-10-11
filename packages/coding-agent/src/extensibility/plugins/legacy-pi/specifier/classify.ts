/**
 * Specifier classification helpers shared by the AST parser, the package
 * resolver, and the extension graph walker.
 *
 * These functions are deliberately pure and dependency-free so any module in
 * the legacy-pi tree can use them without creating a cycle.
 */
import { isBuiltin } from "node:module";

/**
 * Whether `specifier` is a bare package dependency — not relative, not a `#`
 * alias, not a builtin, not a URL with a scheme.
 */
export function isBareExtensionDependencySpecifier(specifier: string): boolean {
	if (
		specifier.startsWith(".") ||
		specifier.startsWith("/") ||
		specifier.startsWith("#") ||
		specifier.startsWith("node:") ||
		specifier.startsWith("bun:") ||
		/^[a-z][a-z0-9+.-]*:/i.test(specifier)
	) {
		return false;
	}
	const packageName = specifier.startsWith("@")
		? specifier.split("/").slice(0, 2).join("/")
		: specifier.split("/")[0];
	return Boolean(packageName && !isBuiltin(specifier));
}

/** A parsed bare specifier: the package name and its optional subpath. */
export interface BarePackageSpecifier {
	readonly name: string;
	readonly subpath: string | null;
}

/** Split a bare specifier into its package name and (possibly null) subpath. */
export function splitBarePackageSpecifier(specifier: string): BarePackageSpecifier | null {
	const parts = specifier.split("/");
	if (specifier.startsWith("@")) {
		const [scope, name, ...rest] = parts;
		if (!scope || !name) return null;
		return { name: `${scope}/${name}`, subpath: rest.length > 0 ? rest.join("/") : null };
	}
	const [name, ...rest] = parts;
	if (!name) return null;
	return { name, subpath: rest.length > 0 ? rest.join("/") : null };
}

/** Escape a string for embedding in a `RegExp` source. */
export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
