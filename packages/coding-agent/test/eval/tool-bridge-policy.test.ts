import { describe, expect, test } from "bun:test";

/**
 * Bridge-policy parity with oh-my-pi (8d1dfcd5ab): checkpoint/rewind are
 * session-recognized ONLY as direct toolResult messages. A bridged call would
 * report success without taking effect, so they must be:
 *   1. rejected at the bridge call site (tau already does this inline), AND
 *   2. excluded from the bridge-callable tool set (the shared policy).
 *
 * The shared policy module is the contract under test.
 */
import { isEvalBridgeToolCallable, EVAL_BRIDGE_EXCLUDED_TOOLS } from "../../src/eval/tool-bridge-policy";

describe("eval bridge tool policy", () => {
	test("excludes checkpoint and rewind from bridge-callable set", () => {
		expect(isEvalBridgeToolCallable({ name: "checkpoint" })).toBe(false);
		expect(isEvalBridgeToolCallable({ name: "rewind" })).toBe(false);
	});

	test("allows normal tools", () => {
		expect(isEvalBridgeToolCallable({ name: "read" })).toBe(true);
		expect(isEvalBridgeToolCallable({ name: "bash" })).toBe(true);
		expect(isEvalBridgeToolCallable({ name: "eval" })).toBe(true);
	});

	test("exclusion list is exactly checkpoint+rewind", () => {
		expect([...EVAL_BRIDGE_EXCLUDED_TOOLS].sort()).toEqual(["checkpoint", "rewind"]);
	});

	test("policy tolerates missing name (returns callable)", () => {
		expect(isEvalBridgeToolCallable({})).toBe(true);
	});
});
