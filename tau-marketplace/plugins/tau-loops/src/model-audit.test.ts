import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	collectReferences,
	findUndefinedRoles,
	parseModelRoleIds,
	probeModel,
	readPriorityIndex,
	resolveConfigPath,
} from "./model-audit.ts";

// The engine's real declaration, type annotation and all. An earlier version
// of this fixture omitted the annotation, which let a parser that could not
// see past `: ModelRole[]` pass its tests and then die on the first live run.
const ROLE_SOURCE = `export const MODEL_ROLE_IDS: ModelRole[] = [
	"default",
	"smol",
	"slow",
	"vision",
	"plan",
	"commit",
	"tiny",
	"memory",
	"task",
	"advisor",
	"image",
	"web",
	"speech",
	"dictation",
	"judge",
];`;

const PRIORITY = {
	smol: ["google-antigravity/gemini-3.8-flash"],
	slow: ["anthropic/claude-opus-5-5"],
};

describe("parseModelRoleIds", () => {
	test("reads the ids out of the engine source", () => {
		const roles = parseModelRoleIds(ROLE_SOURCE);
		expect(roles).toHaveLength(15);
		expect(roles).toContain("default");
		expect(roles).toContain("judge");
		expect(roles).not.toContain("ROLE_IDS");
	});

	// A stale hardcoded list would silently stop reporting roles the engine has
	// since added, which is the exact failure this function exists to prevent.
	test("fails loud rather than returning a stale default", () => {
		expect(() => parseModelRoleIds("const SOMETHING_ELSE = [];")).toThrow(/MODEL_ROLE_IDS/);
	});
});

describe("collectReferences", () => {
	test("finds every place a model is named", () => {
		const config = {
			modelRoles: { default: "openrouter/nvidia/nemotron-3.5-lightning:free" },
			subagents: { defaultModel: "openrouter/liquid/lfm-2.5-2.6b:free" },
			retry: { fallbackChains: { "openrouter/*": ["openrouter/qwen/qwen3.8-27b:free"] } },
		};
		const refs = collectReferences(config);
		const found = refs.map((r) => `${r.origin}=${r.ref}`);
		expect(found).toEqual([
			"modelRoles.default=openrouter/nvidia/nemotron-3.5-lightning:free",
			"subagents.defaultModel=openrouter/liquid/lfm-2.5-2.6b:free",
			"fallbackChains.openrouter/*[0]=openrouter/qwen/qwen3.8-27b:free",
		]);
		expect(refs.every((r) => r.provider === "openrouter")).toBe(true);
	});

	test("keeps non-openrouter providers addressable", () => {
		const refs = collectReferences({ modelRoles: { default: "kilo/cohere/north-mini-code:free" } });
		expect(refs[0]?.provider).toBe("kilo");
		expect(refs[0]?.model).toBe("cohere/north-mini-code:free");
	});

	test("a config with no models yields no references", () => {
		expect(collectReferences({ model: "m", providers: { p1: {} } })).toEqual([]);
	});
});

describe("findUndefinedRoles", () => {
	// This is the incident: 12 of 15 roles were unset, and an unset role does
	// NOT fall back to `default` — it falls through to priority.json's paid
	// list, so the session silently burned ~100 doomed calls per open.
	test("names the paid model an unset role falls through to", () => {
		const modelRoles = { default: "openrouter/nvidia/nemotron-3.5-lightning:free" };
		const roles = parseModelRoleIds(ROLE_SOURCE);
		const undefinedRoles = findUndefinedRoles(roles, modelRoles, PRIORITY);
		const byRole = new Map(undefinedRoles.map((u) => [u.role, u.fallsThroughTo]));

		expect(byRole.get("smol")).toBe("google-antigravity/gemini-3.8-flash");
		expect(byRole.get("slow")).toBe("anthropic/claude-opus-5-5");
		expect(byRole.has("default")).toBe(false);
		// 15 roles, 1 defined.
		expect(undefinedRoles).toHaveLength(14);
	});

	// `default` has no priority entry at all, so an unset default does not fall
	// anywhere — it collides with the bundled cursor/default catalog id. Saying
	// "unknown" is the honest answer; inventing a model would not be.
	test("a role with no priority entry is reported as unknown, not guessed", () => {
		const undefinedRoles = findUndefinedRoles(["default"], {}, PRIORITY);
		expect(undefinedRoles).toHaveLength(1);
		expect(undefinedRoles[0]?.fallsThroughTo).toBeNull();
	});

	test("a fully defined config reports nothing undefined", () => {
		const roles = ["default", "smol"];
		expect(findUndefinedRoles(roles, { default: "a/b", smol: "c/d" }, PRIORITY)).toEqual([]);
	});
});

describe("readPriorityIndex", () => {
	test("reads model ids out of a priority table", () => {
		const dir = mkdtempSync(join(tmpdir(), "tau-loops-prio-"));
		const path = join(dir, "priority.json");
		// priority.json is a flat role -> model[] table, not a wrapped object.
		writeFileSync(path, JSON.stringify(PRIORITY));
		const index = readPriorityIndex(path);
		expect(index.smol?.[0]).toBe("google-antigravity/gemini-3.8-flash");
	});

	test("a missing file is an error, not an empty index", () => {
		expect(() => readPriorityIndex("/nonexistent/priority.json")).toThrow();
	});
});
/** Set an env var for the duration of `body`, restoring the prior state after. */
function withEnv(name: string, value: string, body: () => void): void {
	const previous = process.env[name];
	process.env[name] = value;
	try {
		body();
	} finally {
		if (previous === undefined) Reflect.deleteProperty(process.env, name);
		else process.env[name] = previous;
	}
}

describe("resolveConfigPath", () => {
	// $PI_CONFIG_DIR is the trap: it names a directory whose config.yml the
	// engine never loads for settings, so auditing it reports a clean config
	// while every role is dead.
	test("ignores $PI_CONFIG_DIR and uses the agent dir", () => {
		const dir = mkdtempSync(join(tmpdir(), "tau-loops-cfg-"));
		writeFileSync(join(dir, "config.yml"), "modelRoles:\n  default: x/y\n");
		withEnv("PI_CODING_AGENT_DIR", dir, () => {
			expect(resolveConfigPath()).toBe(join(dir, "config.yml"));
		});
	});

	test("an explicit path always wins", () => {
		expect(resolveConfigPath("/tmp/somewhere/config.yml")).toBe("/tmp/somewhere/config.yml");
	});
});

describe("probeModel provider routing", () => {
	const ref = { origin: "modelRoles.web", ref: "web/exa", provider: "web", model: "exa" };

	// `web/exa` is a search provider, not a chat model. Probing it against
	// OpenRouter returns `400 exa is not a valid model ID`, which reads like a
	// broken config entry and is not one — so it must not be probed at all.
	test("a non-chat provider is reported, not probed", async () => {
		const result = await probeModel(ref, { apiKey: "sk-test", timeoutMs: 20_000 });
		expect(result.verdict).toBe("not-chat");
		expect(result.status).toBe(0);
		expect(result.detail).toContain("not an openrouter chat endpoint");
	});

	test("a chat provider with no key is no-auth, not not-chat", async () => {
		const chatRef = {
			origin: "modelRoles.default",
			ref: "openrouter/some/model:free",
			provider: "openrouter",
			model: "some/model:free",
		};
		const result = await probeModel(chatRef, { apiKey: "", timeoutMs: 20_000 });
		expect(result.verdict).toBe("no-auth");
	});
});
