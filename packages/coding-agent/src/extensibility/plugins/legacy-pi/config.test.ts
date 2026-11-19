import { describe, expect, test } from "bun:test";
import {
	buildLegacyPiSpecifierFilter,
	buildLegacyPiSubpathRemaps,
	buildTypeBoxSpecifierFilter,
	LEGACY_PI_BUNDLED_PACKAGES,
	LEGACY_PI_CONFIG,
} from "./config";

describe("LEGACY_PI_CONFIG", () => {
	test("is frozen at the top level", () => {
		expect(Object.isFrozen(LEGACY_PI_CONFIG)).toBe(true);
		expect(Object.isFrozen(LEGACY_PI_CONFIG.shims)).toBe(true);
		expect(Object.isFrozen(LEGACY_PI_CONFIG.layout)).toBe(true);
	});

	test("canonical scope is @tau", () => {
		expect(LEGACY_PI_CONFIG.canonicalScope).toBe("@tau");
	});

	test("scope aliases include every historical publisher", () => {
		expect(LEGACY_PI_CONFIG.scopeAliases).toContain("mariozechner");
		expect(LEGACY_PI_CONFIG.scopeAliases).toContain("earendil-works");
		expect(LEGACY_PI_CONFIG.scopeAliases).toContain("oh-my-pi");
		expect(LEGACY_PI_CONFIG.scopeAliases).toContain("tau");
	});

	test("coding-agent carries the legacy @tau/tau-coding-agent alias", () => {
		const entry = LEGACY_PI_CONFIG.packages.find(p => p.dir === "coding-agent");
		expect(entry).toBeDefined();
		expect(entry?.legacyName).toBe("@tau/tau-coding-agent");
		expect(entry?.rootShim).toBe("legacy-tau-coding-agent-shim.ts");
	});

	test("every bundled package with a shim names an existing filename", () => {
		for (const pkg of LEGACY_PI_CONFIG.packages) {
			if (pkg.rootShim === null) continue;
			expect(pkg.rootShim).toMatch(/^legacy-.*\.ts$/);
		}
	});

	test("shim filenames cover all four root shims", () => {
		expect(LEGACY_PI_CONFIG.shims.typebox).toBe("legacy-typebox.ts");
		expect(LEGACY_PI_CONFIG.shims.ai).toBe("legacy-tau-ai-shim.ts");
		expect(LEGACY_PI_CONFIG.shims.codingAgent).toBe("legacy-tau-coding-agent-shim.ts");
		expect(LEGACY_PI_CONFIG.shims.tui).toBe("legacy-tau-tui-shim.ts");
	});

	test("LEGACY_PI_BUNDLED_PACKAGES mirrors packages", () => {
		expect(LEGACY_PI_BUNDLED_PACKAGES).toBe(LEGACY_PI_CONFIG.packages);
	});
});

describe("buildLegacyPiSpecifierFilter", () => {
	const filter = buildLegacyPiSpecifierFilter();

	test("matches canonical scoped packages", () => {
		expect(filter.test("@tau/tau-coding-agent")).toBe(true);
		expect(filter.test("@tau/tau-ai")).toBe(true);
		expect(filter.test("@tau/pi-coding-agent")).toBe(true);
	});

	test("matches historical scopes", () => {
		expect(filter.test("@mariozechner/pi-coding-agent")).toBe(true);
		expect(filter.test("@earendil-works/pi-tui")).toBe(true);
		expect(filter.test("@oh-my-pi/pi-utils")).toBe(true);
	});

	test("matches bare entrypoints", () => {
		expect(filter.test("tau")).toBe(true);
		expect(filter.test("oh-my-pi")).toBe(true);
		expect(filter.test("pi")).toBe(true);
	});

	test("matches subpaths of bare entrypoints", () => {
		expect(filter.test("tau/export/html")).toBe(true);
		expect(filter.test("pi/providers/cursor")).toBe(true);
	});

	test("rejects unrelated packages", () => {
		expect(filter.test("lodash")).toBe(false);
		expect(filter.test("@vue/core")).toBe(false);
		expect(filter.test("react")).toBe(false);
	});
});

describe("buildTypeBoxSpecifierFilter", () => {
	const filter = buildTypeBoxSpecifierFilter();

	test("matches both TypeBox spellings", () => {
		expect(filter.test("typebox")).toBe(true);
		expect(filter.test("@sinclair/typebox")).toBe(true);
	});

	test("rejects TypeBox subpaths (only root is remapped)", () => {
		expect(filter.test("@sinclair/typebox/compiler")).toBe(false);
		expect(filter.test("typebox/value")).toBe(false);
	});

	test("rejects unrelated packages", () => {
		expect(filter.test("zod")).toBe(false);
	});
});

describe("buildLegacyPiSubpathRemaps", () => {
	const remaps = buildLegacyPiSubpathRemaps();

	test("preserves insertion order for prefix-first matching", () => {
		const keys = [...remaps.keys()];
		expect(keys[0]).toBe("tau-agent");
		expect(keys.indexOf("tau-agent")).toBeLessThan(keys.indexOf("tau-agent/"));
	});

	test("exact entries win over subtree entries", () => {
		expect(remaps.get("tau-agent")).toBe("tau-coding-agent");
		expect(remaps.get("tau-agent/")).toBe("tau-coding-agent/");
	});

	test("every entry is a [from, to] string pair", () => {
		for (const [from, to] of remaps) {
			expect(typeof from).toBe("string");
			expect(typeof to).toBe("string");
			expect(from.length).toBeGreaterThan(0);
			expect(to.length).toBeGreaterThan(0);
		}
	});

	test("returns a fresh Map per call (no shared mutable state)", () => {
		const a = buildLegacyPiSubpathRemaps();
		const b = buildLegacyPiSubpathRemaps();
		expect(a).not.toBe(b);
		a.set("__mutated__", "__value__");
		expect(b.has("__mutated__")).toBe(false);
	});
});
