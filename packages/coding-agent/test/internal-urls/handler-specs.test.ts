/**
 * Contract: every scheme the router registers declares a `SchemeSpec`, and the
 * spec agrees with the handler's hooks. `register()` reads `spec.write?.via`
 * while installing a handler, so a handler that lost its `spec` (a half-applied
 * refactor) takes the whole router down with
 * `TypeError: undefined is not an object (evaluating 'spec.write')` — and with it
 * every tool that touches an internal URL, `bash` included.
 */
import { describe, expect, it } from "bun:test";
import { InternalUrlRouter } from "tau/internal-urls/router";

const BACKINGS = new Set(["file", "virtual", "remote", "device"]);
const SELECTORS = new Set(["lines", "none", "opaque"]);
const SCOPES = new Set(["workspace", "sandbox", "coordination", "device", "reply"]);

describe("InternalUrlRouter scheme specs", () => {
	it("constructs without throwing", () => {
		expect(() => InternalUrlRouter.instance()).not.toThrow();
	});

	it("declares a spec for every registered scheme", () => {
		const router = InternalUrlRouter.instance();
		const specs = router.specs();
		expect(specs.size).toBeGreaterThan(10);
		for (const [scheme, spec] of specs) {
			if (!spec) throw new Error(`${scheme}:// has no spec`);
			expect(BACKINGS.has(spec.backing)).toBe(true);
			expect(SELECTORS.has(spec.selectors)).toBe(true);
			expect(typeof spec.immutable).toBe("boolean");
		}
	});

	it("keeps the write policy in step with the handler's write hook", () => {
		const router = InternalUrlRouter.instance();
		for (const scheme of router.specs().keys()) {
			const handler = router.getHandler(scheme);
			if (!handler) throw new Error(`${scheme}:// has no handler`);
			const policy = router.spec(scheme)?.write;
			expect(policy?.via === "handler", `${scheme}:// write.via`).toBe(handler.write !== undefined);
			if (policy) {
				expect(SCOPES.has(policy.scope)).toBe(true);
				expect(typeof policy.tier).toBe("function");
			}
		}
	});

	it("backs every file-written scheme with a locate hook", () => {
		const router = InternalUrlRouter.instance();
		for (const [scheme, spec] of router.specs()) {
			if (spec.write?.via !== "file") continue;
			const handler = router.getHandler(scheme);
			expect(handler?.locate, `${scheme}:// writes through file but cannot locate`).toBeInstanceOf(Function);
			expect(spec.backing).toBe("file");
			expect(spec.immutable).toBe(false);
		}
	});
});