import { describe, expect, it, beforeAll } from "vitest";
import { resolveVirtualModule } from "../../src/extensibility/legacy-bundled-resolver";
import { LEGACY_PI_ROOT_EXPORTS } from "../../src/extensibility/legacy-pi-contract";

describe("legacy pi loader — virtual bundle resolution", () => {
	let mod: unknown;
	beforeAll(async () => {
		mod = await resolveVirtualModule("tau-legacy-tau-bundled:@earendil-works/pi-coding-agent");
	});

	for (const [name, kind] of Object.entries(LEGACY_PI_ROOT_EXPORTS)) {
		if (kind === "type") continue;
		it(`exposes ${name} as ${kind}`, () => {
			expect(mod, `virtual bundle missing ${name}`).toHaveProperty(name);
			if (kind === "class") {
				// A class is a function, but we also want to check that it's a class (constructor)
				expect(typeof mod[name]).toBe("function");
				// Check that it has a prototype (which is an object)
				expect(typeof mod[name].prototype).toBe("object");
			} else {
				expect(typeof mod[name]).toBe(kind);
			}
		});
	}
});
