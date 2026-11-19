import { spyOn } from "bun:test";
import * as path from "node:path";
import * as buildModule from "@tau/tau-catalog/build";
import { writeModelCache } from "@tau/tau-catalog/model-cache";
import { ModelRegistry } from "tau/config/model-registry";
import { AuthStorage } from "tau/session/auth-storage";
import { TempDir } from "@tau/tau-utils";

const tempDir = TempDir.createSync("@model-registry-lazy-probe-");
const authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
const cached = buildModule.buildModel({
	id: "cached-construction-probe",
	name: "Cached construction probe",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8192,
	maxTokens: 1024,
});
writeModelCache("anthropic", Date.now(), [cached], true, "", path.join(tempDir.path(), "models.db"));
const buildSpy = spyOn(buildModule, "buildModel");
try {
	new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
	process.stdout.write(JSON.stringify({ buildCalls: buildSpy.mock.calls.length }));
} finally {
	buildSpy.mockRestore();
	authStorage.close();
	await tempDir.remove().catch(() => {});
}
