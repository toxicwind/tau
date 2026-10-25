import { describe, expect, test } from "bun:test";
import { AstParser } from "./ast-parser";

const parser = new AstParser();

describe("AstParser.parse", () => {
	test("parses TS source with type annotations", () => {
		const ast = parser.parse("const x: number = 1;", "test.ts");
		expect(ast.program.sourceType).toBe("script");
	});

	test("parses ESM source", () => {
		const ast = parser.parse("export const x = 1;", "test.ts");
		expect(ast.program.sourceType).toBe("module");
	});

	test("recovers from a single syntax error", () => {
		const ast = parser.parse("const x = ;\nconst y = 1;", "test.ts");
		expect(ast.program).toBeDefined();
	});

	test("parses TSX with JSX plugin", () => {
		const ast = parser.parse("const el = <div />;", "test.tsx");
		expect(ast.program).toBeDefined();
	});

	test("throws a wrapped error naming the importer path", () => {
		expect(() => parser.parse("function (", "broken.ts")).toThrow(/broken\.ts/);
	});
});

describe("AstParser.collectSpecifierReferences", () => {
	test("finds static import declarations", () => {
		const refs = parser.collectSpecifierReferences('import x from "lodash";', "test.ts");
		expect(refs).toEqual([
			{ kind: "import", specifier: "lodash", start: expect.any(Number), end: expect.any(Number) },
		]);
	});

	test("finds named and namespace imports", () => {
		const refs = parser.collectSpecifierReferences(
			'import { a } from "pkg-a";\nimport * as b from "pkg-b";',
			"test.ts",
		);
		expect(refs.map(r => r.specifier)).toEqual(["pkg-a", "pkg-b"]);
	});

	test("finds export-from declarations", () => {
		const refs = parser.collectSpecifierReferences('export * from "pkg";', "test.ts");
		expect(refs).toEqual([{ kind: "import", specifier: "pkg", start: expect.any(Number), end: expect.any(Number) }]);
	});

	test("finds dynamic import() expressions", () => {
		const refs = parser.collectSpecifierReferences('const x = await import("lazy-pkg");', "test.ts");
		expect(refs.map(r => r.specifier)).toEqual(["lazy-pkg"]);
	});

	test("finds CommonJS require() calls", () => {
		const refs = parser.collectSpecifierReferences('const x = require("cjs-pkg");', "test.ts");
		expect(refs).toEqual([
			{ kind: "require", specifier: "cjs-pkg", start: expect.any(Number), end: expect.any(Number) },
		]);
	});

	test("does not record a shadowed require()", () => {
		const src = "function f(require) { return require('not-a-real-pkg'); }";
		const refs = parser.collectSpecifierReferences(src, "test.ts");
		expect(refs).toHaveLength(0);
	});

	test("does not record a shadowed exports or module binding", () => {
		const src = "function f(exports) { exports.foo = 1; }";
		const refs = parser.collectSpecifierReferences(src, "test.ts");
		// No import/require sites at all — this asserts the CommonJS detector
		// path, not the reference collector.
		expect(refs).toHaveLength(0);
	});

	test("finds createRequire(...)(...) call targets", () => {
		const src = [
			'import { createRequire } from "node:module";',
			"const require = createRequire(import.meta.url);",
			'const dep = require("ffi-napi");',
		].join("\n");
		const refs = parser.collectSpecifierReferences(src, "test.ts");
		expect(refs.map(r => r.specifier)).toContain("ffi-napi");
	});

	test("ignores import-looking text inside strings", () => {
		const src = 'const s = "import x from \\"lodash\\"";';
		const refs = parser.collectSpecifierReferences(src, "test.ts");
		expect(refs).toHaveLength(0);
	});

	test("ignores import-looking text inside template literals", () => {
		const src = "const s = `import x from 'lodash'`;";
		const refs = parser.collectSpecifierReferences(src, "test.ts");
		expect(refs).toHaveLength(0);
	});

	test("ignores import-looking text inside line comments", () => {
		const src = "// import x from 'lodash'\nconst y = 1;";
		const refs = parser.collectSpecifierReferences(src, "test.ts");
		expect(refs).toHaveLength(0);
	});

	test("records byte-accurate start/end offsets", () => {
		const src = 'import x from "lodash";';
		const [ref] = parser.collectSpecifierReferences(src, "test.ts");
		expect(src.slice(ref.start, ref.end)).toBe('"lodash"');
	});

	test("preserves source order across mixed import forms", () => {
		const src = ['import a from "first";', 'const b = require("second");', 'const c = await import("third");'].join(
			"\n",
		);
		const refs = parser.collectSpecifierReferences(src, "test.ts");
		expect(refs.map(r => r.specifier)).toEqual(["first", "second", "third"]);
	});
});

describe("AstParser.hasCommonJsSyntax", () => {
	test("returns true for a script using require()", () => {
		const ast = parser.parse('const x = require("foo");', "test.cjs");
		expect(parser.hasCommonJsSyntax(ast)).toBe(true);
	});

	test("returns true for module.exports assignment", () => {
		const ast = parser.parse("module.exports = { a: 1 };", "test.cjs");
		expect(parser.hasCommonJsSyntax(ast)).toBe(true);
	});

	test("returns true for exports.foo assignment", () => {
		const ast = parser.parse("exports.foo = 1;", "test.cjs");
		expect(parser.hasCommonJsSyntax(ast)).toBe(true);
	});

	test("returns false for pure ESM with no require/exports", () => {
		const ast = parser.parse('import x from "foo";\nexport { x };', "test.ts");
		expect(parser.hasCommonJsSyntax(ast)).toBe(false);
	});

	test("returns false when require is shadowed by a local binding", () => {
		const ast = parser.parse("function f(require) { return require('x'); }", "test.ts");
		expect(parser.hasCommonJsSyntax(ast)).toBe(false);
	});

	test("returns false when exports is shadowed by a local binding", () => {
		const ast = parser.parse("function f(exports) { exports.foo = 1; }", "test.ts");
		expect(parser.hasCommonJsSyntax(ast)).toBe(false);
	});
});

describe("AstParser.collectScoped", () => {
	test("returns selected nodes with a non-null scope", () => {
		const ast = parser.parse("const x = 1;", "test.ts");
		const selected = parser.collectScoped(ast, node => node.type === "VariableDeclaration");
		expect(selected).toHaveLength(1);
		expect(selected[0].scope).toBeDefined();
		expect(selected[0].node.type).toBe("VariableDeclaration");
	});

	test("returns nodes sorted by source start offset", () => {
		const ast = parser.parse("const a = 1;\nconst b = 2;\nconst c = 3;", "test.ts");
		const selected = parser.collectScoped(ast, node => node.type === "VariableDeclaration");
		const starts = selected.map(s => s.node.start as number);
		expect(starts).toEqual([...starts].sort((a, b) => a - b));
	});
});
