import { describe, expect, it } from "bun:test";
import {
	buildDeniedToolsEnv,
	deniedToolsEnv,
	extractDeniedTools,
} from "../../src/eval/deny-policy";

describe("deny-policy extraction from tools.approval", () => {
	it("returns [] for empty / undefined approval config", () => {
		expect(extractDeniedTools(undefined)).toEqual([]);
		expect(extractDeniedTools(null)).toEqual([]);
		expect(extractDeniedTools({})).toEqual([]);
	});

	it("extracts exactly the deny entries, sorted", () => {
		expect(extractDeniedTools({ bash: "deny", grep: "deny", find: "deny" })).toEqual([
			"bash",
			"find",
			"grep",
		]);
	});

	it("ignores allow/prompt decisions and unknown values", () => {
		expect(extractDeniedTools({ bash: "allow", grep: "prompt", find: "deny", read: "weird" })).toEqual([
			"find",
		]);
	});
});

describe("deniedToolsEnv serialization", () => {
	it("maps known tool names to their executable families", () => {
		expect(deniedToolsEnv(["bash", "grep"])).toBe(
			"bash:bash,sh,dash,zsh,fish;grep:grep,rg,ripgrep,egrep,fgrep",
		);
	});

	it("omits tools with no executable mapping (inert in kernels, name-gate still protects)", () => {
		expect(deniedToolsEnv(["read"])).toBe("");
	});

	it("produces undefined env when nothing is denied", () => {
		expect(buildDeniedToolsEnv({ bash: "allow" })).toBeUndefined();
		expect(buildDeniedToolsEnv(undefined)).toBeUndefined();
	});

	it("produces the env string for real deny config", () => {
		expect(buildDeniedToolsEnv({ bash: "deny", grep: "deny" })).toBe(
			"bash:bash,sh,dash,zsh,fish;grep:grep,rg,ripgrep,egrep,fgrep",
		);
	});
});