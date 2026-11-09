import { describe, expect, it } from "bun:test";
import { parseArgs } from "tau/cli/args";

describe("parseArgs — --print-thoughts flag", () => {
	it("does not consume the next argument", () => {
		const result = parseArgs(["--print", "--print-thoughts", "explain"]);
		expect(result.print).toBe(true);
		expect(result.printThoughts).toBe(true);
		expect(result.messages).toEqual(["explain"]);
	});
});
