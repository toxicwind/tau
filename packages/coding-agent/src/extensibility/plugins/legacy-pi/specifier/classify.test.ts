import { describe, expect, test } from "bun:test";
import { escapeRegExp, isBareExtensionDependencySpecifier, splitBarePackageSpecifier } from "./classify";

describe("isBareExtensionDependencySpecifier", () => {
	test("accepts unscoped bare packages", () => {
		expect(isBareExtensionDependencySpecifier("lodash")).toBe(true);
		expect(isBareExtensionDependencySpecifier("chalk")).toBe(true);
	});

	test("accepts scoped bare packages", () => {
		expect(isBareExtensionDependencySpecifier("@sinclair/typebox")).toBe(true);
		expect(isBareExtensionDependencySpecifier("@modelcontextprotocol/sdk")).toBe(true);
	});

	test("rejects relative specifiers", () => {
		expect(isBareExtensionDependencySpecifier("./helper")).toBe(false);
		expect(isBareExtensionDependencySpecifier("../sibling")).toBe(false);
		expect(isBareExtensionDependencySpecifier(".")).toBe(false);
	});

	test("rejects absolute specifiers", () => {
		expect(isBareExtensionDependencySpecifier("/usr/local/lib")).toBe(false);
	});

	test("rejects package-imports aliases", () => {
		expect(isBareExtensionDependencySpecifier("#src/foo")).toBe(false);
	});

	test("rejects node: and bun: builtins", () => {
		expect(isBareExtensionDependencySpecifier("node:fs")).toBe(false);
		expect(isBareExtensionDependencySpecifier("bun:sqlite")).toBe(false);
	});

	test("rejects bare Node builtin names", () => {
		expect(isBareExtensionDependencySpecifier("fs")).toBe(false);
		expect(isBareExtensionDependencySpecifier("path")).toBe(false);
	});

	test("rejects URL-shaped schemes", () => {
		expect(isBareExtensionDependencySpecifier("https://example.com")).toBe(false);
		expect(isBareExtensionDependencySpecifier("data:text/plain,hi")).toBe(false);
	});
});

describe("splitBarePackageSpecifier", () => {
	test("splits unscoped names without subpaths", () => {
		expect(splitBarePackageSpecifier("lodash")).toEqual({ name: "lodash", subpath: null });
	});

	test("splits unscoped names with subpaths", () => {
		expect(splitBarePackageSpecifier("lodash/fp/map")).toEqual({
			name: "lodash",
			subpath: "fp/map",
		});
	});

	test("splits scoped names without subpaths", () => {
		expect(splitBarePackageSpecifier("@scope/pkg")).toEqual({
			name: "@scope/pkg",
			subpath: null,
		});
	});

	test("splits scoped names with subpaths", () => {
		expect(splitBarePackageSpecifier("@scope/pkg/sub/path")).toEqual({
			name: "@scope/pkg",
			subpath: "sub/path",
		});
	});

	test("returns null for empty or malformed scoped names", () => {
		expect(splitBarePackageSpecifier("")).toBeNull();
		expect(splitBarePackageSpecifier("@")).toBeNull();
		expect(splitBarePackageSpecifier("@scope")).toBeNull();
	});
});

describe("escapeRegExp", () => {
	test("escapes every regex metacharacter", () => {
		expect(escapeRegExp("a.b*c+d?e^f$g{h}i(j)k|l)m[n]o")).toBe(
			"a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\)m\\[n\\]o",
		);
	});

	test("leaves plain strings unchanged", () => {
		expect(escapeRegExp("tau-legacy-tau-modules")).toBe("tau-legacy-tau-modules");
	});

	test("escaped output compiles to a literal-matching regex", () => {
		const original = "tau-legacy-tau-modules";
		const re = new RegExp(`^${escapeRegExp(original)}$`);
		expect(re.test(original)).toBe(true);
		expect(re.test("tau.legacy.tau.modules")).toBe(false);
	});
});
