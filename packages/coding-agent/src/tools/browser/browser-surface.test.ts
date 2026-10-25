// browser-surface.test.ts
//
// Bun test suite for the browser surface manifests and their generator.
// Run: bun test browser-surface.test.ts
//
// The test imports the macro module WITHOUT the { type: "macro" } attribute,
// so its exports behave as ordinary functions. This exercises the same code
// paths the transpiler runs, but lets us call them repeatedly and inspect
// the returned strings.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
	generateAll,
	generateDeclarations,
	generateDirectMethods,
	generateElementMethods,
	generateFrameMethods,
	generatePyMethods,
	loadManifests,
	type SurfaceManifest,
} from "./browser-surface-macro.ts";

const SURFACE_DIR = join(import.meta.dir, "surface");

describe("manifest loading", () => {
	test("surface/ exists and contains element/frame/tab manifests", () => {
		const files = readdirSync(SURFACE_DIR).filter(f => f.endsWith(".json"));
		expect(files).toContain("element.json");
		expect(files).toContain("frame.json");
		expect(files).toContain("tab.json");
	});

	test("loadManifests returns three manifests with valid structure", () => {
		const manifests = loadManifests();
		expect(manifests.length).toBeGreaterThanOrEqual(3);
		for (const m of manifests) {
			expect(typeof m.namespace).toBe("string");
			expect(typeof m.receiver).toBe("string");
			expect(typeof m.doc).toBe("string");
			expect(Array.isArray(m.methods)).toBe(true);
			expect(m.methods.length).toBeGreaterThan(0);
			for (const method of m.methods) {
				expect(typeof method.name).toBe("string");
				expect(method.name.length).toBeGreaterThan(0);
			}
		}
	});

	test("no duplicate method names within any namespace", () => {
		for (const m of loadManifests()) {
			const seen = new Set<string>();
			for (const method of m.methods) {
				expect(seen.has(method.name)).toBe(false);
				seen.add(method.name);
			}
		}
	});

	test("every async method has a returns field", () => {
		for (const m of loadManifests()) {
			for (const method of m.methods) {
				if (method.async) expect(method.returns).toBeTruthy();
			}
		}
	});
});

describe("generateDirectMethods", () => {
	const output = generateDirectMethods();
	const parsed: string[] = JSON.parse(output);

	test("emits a parseable JSON array", () => {
		expect(Array.isArray(parsed)).toBe(true);
	});

	test("contains core tab methods", () => {
		expect(parsed).toContain("url");
		expect(parsed).toContain("title");
		expect(parsed).toContain("goto");
		expect(parsed).toContain("evaluate");
		expect(parsed).toContain("screenshot");
		expect(parsed).toContain("reactEnable");
		expect(parsed).toContain("webmcpList");
		expect(parsed).toContain("recordStart");
	});

	test("does not contain element-only methods", () => {
		expect(parsed).not.toContain("isHidden");
		expect(parsed).not.toContain("boundingBox");
		expect(parsed).not.toContain("scrollIntoView");
	});

	test("does not contain frame-only methods", () => {
		expect(parsed).not.toContain("waitForSelector");
	});

	test("count is at least 100", () => {
		expect(parsed.length).toBeGreaterThanOrEqual(100);
	});
});

describe("generateElementMethods", () => {
	const output = generateElementMethods();
	const parsed: string[] = JSON.parse(output);

	test("emits a parseable JSON array", () => {
		expect(Array.isArray(parsed)).toBe(true);
	});

	test("contains expected element methods", () => {
		expect(parsed).toContain("click");
		expect(parsed).toContain("fill");
		expect(parsed).toContain("check");
		expect(parsed).toContain("uncheck");
		expect(parsed).toContain("isHidden");
		expect(parsed).toContain("boundingBox");
		expect(parsed).toContain("scrollIntoView");
		expect(parsed).toContain("evaluate");
	});

	test("count is exactly 24", () => {
		expect(parsed.length).toBe(24);
	});
});

describe("generateFrameMethods", () => {
	const output = generateFrameMethods();
	const parsed: string[] = JSON.parse(output);

	test("emits a parseable JSON array", () => {
		expect(Array.isArray(parsed)).toBe(true);
	});

	test("contains expected frame methods", () => {
		expect(parsed).toContain("click");
		expect(parsed).toContain("fill");
		expect(parsed).toContain("ariaSnapshot");
		expect(parsed).toContain("waitFor");
		expect(parsed).toContain("screenshot");
	});

	test("count is exactly 15", () => {
		expect(parsed.length).toBe(15);
	});
});

describe("generatePyMethods", () => {
	const output = generatePyMethods();

	test("emits tuple declarations for each namespace", () => {
		expect(output).toContain("_ELEMENT_METHODS = (");
		expect(output).toContain("_FRAME_METHODS = (");
		expect(output).toContain("_TAB_METHODS = (");
	});

	test("includes tab methods", () => {
		expect(output).toContain('"goto"');
		expect(output).toContain('"screenshot"');
		expect(output).toContain('"reactEnable"');
	});

	test("every tuple is balanced", () => {
		const opens = (output.match(/\(/g) || []).length;
		const closes = (output.match(/\)/g) || []).length;
		expect(opens).toBe(closes);
	});
});

describe("generateDeclarations", () => {
	const output = generateDeclarations();

	test("emits interface blocks for each receiver", () => {
		expect(output).toContain("interface BrowserElement {");
		expect(output).toContain("interface BrowserFrame {");
		expect(output).toContain("interface BrowserTabHelpers {");
	});

	test("preserves JSDoc comments", () => {
		expect(output).toContain("/** Click this element. */");
		expect(output).toContain("/** Navigate the page. */");
	});

	test("emits async return types", () => {
		expect(output).toContain("Promise<string>");
		expect(output).toContain("Promise<void>");
	});

	test("emits generic method signatures", () => {
		expect(output).toMatch(/evaluate<R,\s*TArgs>/);
	});

	test("handles optional arguments", () => {
		expect(output).toMatch(/\w+\?:\s/);
	});

	test("handles rest arguments", () => {
		expect(output).toMatch(/\.\.\.\w+:\s/);
	});

	test("balanced braces across all interfaces", () => {
		const opens = (output.match(/\{/g) || []).length;
		const closes = (output.match(/\}/g) || []).length;
		expect(opens).toBe(closes);
	});
});

describe("generateAll", () => {
	test("returns all five outputs from a single call", () => {
		const all = generateAll();
		expect(all.directMethods).toBeTruthy();
		expect(all.elementMethods).toBeTruthy();
		expect(all.frameMethods).toBeTruthy();
		expect(all.pyMethods).toBeTruthy();
		expect(all.declarations).toBeTruthy();
	});

	test("outputs are consistent with individual generators", () => {
		const all = generateAll();
		expect(all.directMethods).toBe(generateDirectMethods());
		expect(all.elementMethods).toBe(generateElementMethods());
		expect(all.frameMethods).toBe(generateFrameMethods());
		expect(all.pyMethods).toBe(generatePyMethods());
		expect(all.declarations).toBe(generateDeclarations());
	});
});

describe("cross-namespace invariants", () => {
	test("element methods are a strict subset of the union of all method names", () => {
		const union = new Set<string>();
		for (const m of loadManifests()) for (const x of m.methods) union.add(x.name);
		for (const n of JSON.parse(generateElementMethods())) expect(union.has(n)).toBe(true);
		for (const n of JSON.parse(generateFrameMethods())) expect(union.has(n)).toBe(true);
	});

	test("tab methods do not collide with element-only methods", () => {
		const tabSet = new Set(JSON.parse(generateDirectMethods()));
		const elementSet = new Set(JSON.parse(generateElementMethods()));
		const frameSet = new Set(JSON.parse(generateFrameMethods()));
		// isHidden / boundingBox are element-only and must not appear in tab
		expect(tabSet.has("isHidden")).toBe(false);
		expect(tabSet.has("boundingBox")).toBe(false);
		// waitFor exists only on frame
		expect(frameSet.has("waitFor")).toBe(true);
	});

	test("manifest files are byte-stable across reloads", () => {
		const a = generateAll();
		const b = generateAll();
		expect(a.directMethods).toBe(b.directMethods);
		expect(a.elementMethods).toBe(b.elementMethods);
		expect(a.frameMethods).toBe(b.frameMethods);
		expect(a.pyMethods).toBe(b.pyMethods);
		expect(a.declarations).toBe(b.declarations);
	});
});

describe("template marker contracts", () => {
	test("prelude.js declares the three generated markers", async () => {
		const { default: src } = await import("./prelude.js", { with: { type: "text" } });
		expect(src).toContain("/*__GENERATED_directMethods__*/[]");
		expect(src).toContain("/*__GENERATED_elementMethods__*/[]");
		expect(src).toContain("/*__GENERATED_frameMethods__*/[]");
	});

	test("prelude.py declares the python marker", async () => {
		const { default: src } = await import("./prelude.py", { with: { type: "text" } });
		expect(src).toContain("(__GENERATED_PY__)");
	});

	test("declarations.d.ts no longer carries the fake default export", async () => {
		const { default: src } = await import("./declarations.d.ts", { with: { type: "text" } });
		expect(src).not.toContain("export default declarations;");
		expect(src).not.toContain('const declarations: string = "";');
	});
});

describe("adversarial & boundary manifest invariants (weird tests)", () => {
	test("manifest method names reject prototype poisoning & object builtins", () => {
		const all = generateAll();
		const forbidden = [
			"__proto__",
			"constructor",
			"prototype",
			"valueOf",
			"toString",
			"hasOwnProperty",
			"isPrototypeOf",
		];
		const jsonDirect = JSON.parse(all.directMethods) as string[];
		const jsonElement = JSON.parse(all.elementMethods) as string[];
		const jsonFrame = JSON.parse(all.frameMethods) as string[];

		for (const name of forbidden) {
			expect(jsonDirect).not.toContain(name);
			expect(jsonElement).not.toContain(name);
			expect(jsonFrame).not.toContain(name);
		}
	});

	test("python tuples in generatePyMethods use strictly valid syntax and no empty strings", () => {
		const py = generatePyMethods();
		expect(py).toMatch(/_TAB_METHODS\s*=\s*\([^\)]*\)/);
		expect(py).toMatch(/_ELEMENT_METHODS\s*=\s*\([^\)]*\)/);
		expect(py).toMatch(/_FRAME_METHODS\s*=\s*\([^\)]*\)/);
		// No empty item string inside tuple `("",` or `""`
		expect(py).not.toMatch(/\(\s*""\s*[,)]/);
		expect(py).not.toMatch(/,\s*""\s*[,)]/);
	});

	test("typescript declarations have no unclosed quotes or syntax breakage", () => {
		const decls = generateDeclarations();
		// Balanced interface blocks
		const openBraces = (decls.match(/\{/g) || []).length;
		const closeBraces = (decls.match(/\}/g) || []).length;
		expect(openBraces).toBe(closeBraces);
		expect(openBraces).toBeGreaterThanOrEqual(3);

		// No raw unescaped regex artifacts or NaN
		expect(decls).not.toContain("NaN");
		expect(decls).not.toContain("undefined");
	});

	test("directMethods array contains only unique identifier strings", () => {
		const all = generateAll();
		const direct = JSON.parse(all.directMethods) as string[];
		const set = new Set(direct);
		expect(set.size).toBe(direct.length);
		for (const m of direct) {
			expect(m).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
		}
	});
});
