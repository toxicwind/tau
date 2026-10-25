import { describe, expect, it } from "vitest";
import * as shim from "../../src/extensibility/legacy-tau-coding-agent-shim";
import { LEGACY_PI_ROOT_EXPORTS } from "../../src/extensibility/legacy-pi-contract";

describe("legacy pi contract — shim export surface", () => {
	for (const [name, kind] of Object.entries(LEGACY_PI_ROOT_EXPORTS)) {
		if (kind === "type") continue;
		it(`exposes ${name} as ${kind}`, () => {
			expect(shim, `missing export: ${name}`).toHaveProperty(name);
			if (kind === "class") {
				// A class is a function, but we also want to check that it's a class (constructor)
				expect(typeof (shim as any)[name]).toBe("function");
				// Check that it has a prototype (which is an object)
				expect(typeof (shim as any)[name].prototype).toBe("object");
			} else {
				expect(typeof (shim as any)[name]).toBe(kind);
			}
		});
	}
});
