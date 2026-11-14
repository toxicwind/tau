import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * TDD tests for Google Antigravity TOS violation cleanup.
 *
 * Two faults collided:
 *   1. cloudcode-pa.googleapis.com 403 TOS_VIOLATION — consumer IDE OAuth
 *      token piped into third-party agent harness via google-antigravity/*.
 *   2. FreeInference concurrency_limit_exceeded (limit: 1) — background
 *      memory/title turns colliding with active turn on shared FreeInference slot.
 *
 * Cleanup sequence (must pass BEFORE submitting Google appeal form):
 *   A. Purge google-antigravity from both hosts' active configs.
 *   B. Rebind default/smol/memory roles away from google-antigravity
 *      AND away from concurrent FreeInference slots.
 *   C. Revoke cached OAuth tokens (welcome.json composer cache).
 *   D. Verify zero active role bindings remain.
 */

const HOME = process.env.HOME ?? "/home/toxic";
const OMP_AGENT_DIR = path.join(HOME, ".omp", "agent");
const TAU_SSOT_DIR = path.join(HOME, "pens", "olympus", "ssot", "tau");
const MIMETITE_DIR = path.join(HOME, "pens", "geode", "products", "mimetite");

const GOOGLE_ANTIGRAVITY = "google-antigravity";
const CLOUDCODE_PA = "cloudcode-pa.googleapis.com";

const SAFE_ROLE_MODELS = [
	"mimetite/freeinference/deepseek-v4-flash",
	"mimetite/freeinference/qwen3.6-35b",
	"inception/mercury-3",
	"bornite/qwen3.5-9b-Q5_K_M",
];

function readYamlFiles(dir: string): Array<{ file: string; content: string }> {
	const results: Array<{ file: string; content: string }> = [];
	const walk = (d: string) => {
		let entries: string[];
		try {
			entries = fs.readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(d, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile() && /\.(yml|yaml)$/.test(entry.name)) {
				try {
					results.push({ file: full, content: fs.readFileSync(full, "utf8") });
				} catch {}
			}
		}
	};
	walk(dir);
	return results;
}

function readJsonFiles(dir: string): Array<{ file: string; content: unknown }> {
	const results: Array<{ file: string; content: unknown }> = [];
	const walk = (d: string) => {
		let entries: string[];
		try {
			entries = fs.readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(d, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile() && entry.name === "welcome.json") {
				try {
					results.push({
						file: full,
						content: JSON.parse(fs.readFileSync(full, "utf8")),
					});
				} catch {}
			}
		}
	};
	walk(dir);
	return results;
}

function findGoogleAntigravityRoles(content: string): string[] {
	const roles: string[] = [];
	const lines = content.split("\n");
	for (const line of lines) {
		if (/google-antigravity\//.test(line)) {
			// Match role: model patterns like "  default: google-antigravity/gemini-3.8-flash"
			const roleMatch = line.match(/^\s*([a-zA-Z]+):\s*google-antigravity\//);
			if (roleMatch) roles.push(roleMatch[1]);
		}
	}
	return roles;
}

function findCloudcodePaRefs(content: string): string[] {
	const refs: string[] = [];
	const lines = content.split("\n");
	for (const line of lines) {
		const trimmed = line.trimStart();
		// Skip comments — they're explanatory, not active bindings
		if (trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
		if (line.includes(CLOUDCODE_PA)) refs.push(line.trim());
	}
	return refs;
}

// ── Suite A: Purge google-antigravity from active configs ──────────────────

describe("A. Purge google-antigravity from active omp/tau configs", () => {
	test("no active omp agent config binds google-antigravity/* to any role", () => {
		const configFiles = readYamlFiles(OMP_AGENT_DIR).filter(
			(f) => f.file.endsWith("config.yml") && !f.file.includes(".bak-") && !f.file.includes(".pre-ssot"),
		);
		let violations = 0;
		for (const { file, content } of configFiles) {
			const roles = findGoogleAntigravityRoles(content);
			if (roles.length > 0) {
				console.log(`VIOLATION in ${file}: roles bound to google-antigravity/*: ${roles.join(", ")}`);
				violations += roles.length;
			}
		}
		expect(violations).toBe(0);
	});

	test("no active tau SSOT config references google-antigravity/*", () => {
		const configFiles = readYamlFiles(TAU_SSOT_DIR);
		let violations = 0;
		for (const { file, content } of configFiles) {
			if (/google-antigravity\//.test(content)) {
				console.log(`VIOLATION in ${file}: contains google-antigravity/* reference`);
				violations++;
			}
		}
		expect(violations).toBe(0);
	});

	test("no config references cloudcode-pa.googleapis.com (suspended endpoint)", () => {
		const allConfigs = [...readYamlFiles(OMP_AGENT_DIR), ...readYamlFiles(TAU_SSOT_DIR)];
		let violations = 0;
		for (const { file, content } of allConfigs) {
			const refs = findCloudcodePaRefs(content);
			if (refs.length > 0) {
				console.log(`VIOLATION in ${file}: cloudcode-pa.googleapis.com refs: ${refs.length}`);
				violations += refs.length;
			}
		}
		expect(violations).toBe(0);
	});
});

// ── Suite B: Roles rebound to safe alternatives ────────────────────────────

describe("B. Roles rebound away from google-antigravity and concurrent FreeInference", () => {
	test("omp default role is not google-antigravity and not concurrent FreeInference", () => {
		const configFiles = readYamlFiles(OMP_AGENT_DIR).filter(
			(f) => f.file.endsWith("config.yml") && !f.file.includes(".bak-") && !f.file.includes(".pre-ssot"),
		);
		let found = false;
		for (const { content } of configFiles) {
			const defaultMatch = content.match(/^\s*default:\s*(\S+)/m);
			if (defaultMatch) {
				const model = defaultMatch[1];
				expect(model).not.toMatch(/^google-antigravity\//);
				expect(model).not.toMatch(/^freeinference\//);
				found = true;
			}
		}
		if (!found) console.log("WARNING: no 'default' role found in active omp config");
	});

	test("omp smol role is not google-antigravity and not concurrent FreeInference", () => {
		const configFiles = readYamlFiles(OMP_AGENT_DIR).filter(
			(f) => f.file.endsWith("config.yml") && !f.file.includes(".bak-") && !f.file.includes(".pre-ssot"),
		);
		let found = false;
		for (const { content } of configFiles) {
			const smolMatch = content.match(/^\s*smol:\s*(\S+)/m);
			if (smolMatch) {
				const model = smolMatch[1];
				expect(model).not.toMatch(/^google-antigravity\//);
				expect(model).not.toMatch(/^freeinference\//);
				found = true;
			}
		}
		if (!found) console.log("WARNING: no 'smol' role found in active omp config");
	});

	test("omp memory/task roles are not google-antigravity and not concurrent FreeInference", () => {
		const configFiles = readYamlFiles(OMP_AGENT_DIR).filter(
			(f) => f.file.endsWith("config.yml") && !f.file.includes(".bak-") && !f.file.includes(".pre-ssot"),
		);
		const memoryRoles = ["memory", "task", "commit"];
		for (const role of memoryRoles) {
			let found = false;
			for (const { content } of configFiles) {
				const match = content.match(new RegExp(`^\\s*${role}:\\s*(\\S+)`, "m"));
				if (match) {
					const model = match[1];
					expect(model).not.toMatch(/^google-antigravity\//);
					expect(model).not.toMatch(/^freeinference\//);
					found = true;
				}
			}
			if (!found) console.log(`WARNING: no '${role}' role found in active omp config`);
		}
	});

	test("SSOT tau default/slow/fast roles bound to safe models", () => {
		const configFiles = readYamlFiles(TAU_SSOT_DIR);
		let found = 0;
		for (const { content } of configFiles) {
			for (const role of ["default", "slow", "fast", "smol", "backup"]) {
				const match = content.match(new RegExp(`^\\s*${role}:\\s*(\\S+)`, "m"));
				if (match) {
					const model = match[1];
					expect(model).not.toMatch(/^google-antigravity\//);
					found++;
				}
			}
		}
		expect(found).toBeGreaterThan(0);
	});
});

// ── Suite C: Cached OAuth tokens revoked ───────────────────────────────────

describe("C. Cached OAuth tokens revoked", () => {
	test("no google-antigravity provider in composer welcome.json cache files", () => {
		const composerCache = path.join(OMP_AGENT_DIR, "cache", "composer");
		const welcomeFiles = readJsonFiles(composerCache);
		let violations = 0;
		for (const { file, content } of welcomeFiles) {
			if (content && typeof content === "object" && "providerName" in content) {
				if ((content as { providerName?: string }).providerName === GOOGLE_ANTIGRAVITY) {
					console.log(`VIOLATION in ${file}: providerName=google-antigravity`);
					violations++;
				}
			}
		}
		expect(violations).toBe(0);
	});

	test("no google-antigravity modelName in composer welcome.json cache files", () => {
		const composerCache = path.join(OMP_AGENT_DIR, "cache", "composer");
		const welcomeFiles = readJsonFiles(composerCache);
		let violations = 0;
		for (const { file, content } of welcomeFiles) {
			if (content && typeof content === "object" && "modelName" in content) {
				const modelName = (content as { modelName?: string }).modelName ?? "";
				if (/gemini-3\.8|gemini-3\.9|gemini-3\.5-flash/.test(modelName)) {
					console.log(`WARNING in ${file}: modelName=${modelName} (google-antigravity family)`);
					violations++;
				}
			}
		}
		// These are warnings, not hard failures — but should be reviewed
		expect(violations).toBe(0);
	});
});

// ── Suite D: Zero active bindings before appeal ────────────────────────────

describe("D. Zero active google-antigravity bindings before appeal form", () => {
	test("rg-style scan: zero google-antigravity/* in any active yml config", () => {
		const allConfigs = [...readYamlFiles(OMP_AGENT_DIR), ...readYamlFiles(TAU_SSOT_DIR), ...readYamlFiles(MIMETITE_DIR)];
		let totalViolations = 0;
		for (const { file, content } of allConfigs) {
			// Skip backup/pre-cutover files
			if (file.includes(".bak-") || file.includes(".pre-ssot")) continue;
			const roles = findGoogleAntigravityRoles(content);
			totalViolations += roles.length;
			if (roles.length > 0) {
				console.log(`ACTIVE BINDING in ${file}: ${roles.join(", ")}`);
			}
		}
		expect(totalViolations).toBe(0);
	});

	test("zero cloudcode-pa.googleapis.com in any active config across both hosts", () => {
		const allConfigs = [...readYamlFiles(OMP_AGENT_DIR), ...readYamlFiles(TAU_SSOT_DIR), ...readYamlFiles(MIMETITE_DIR)];
		let totalRefs = 0;
		for (const { file, content } of allConfigs) {
			if (file.includes(".bak-") || file.includes(".pre-ssot")) continue;
			const refs = findCloudcodePaRefs(content);
			totalRefs += refs.length;
			if (refs.length > 0) {
				console.log(`ACTIVE REF in ${file}: ${refs.join(" | ")}`);
			}
		}
		expect(totalRefs).toBe(0);
	});

	test("summary: cleanup ready for Google appeal form submission", () => {
		// This is the gate test — all previous suites must pass
		const ompConfigs = readYamlFiles(OMP_AGENT_DIR).filter(
			(f) => !f.file.includes(".bak-") && !f.file.includes(".pre-ssot"),
		);
		const tauConfigs = readYamlFiles(TAU_SSOT_DIR);
		const allConfigs = [...ompConfigs, ...tauConfigs];

		let antigravityBindings = 0;
		let cloudcodeRefs = 0;
		for (const { content } of allConfigs) {
			antigravityBindings += findGoogleAntigravityRoles(content).length;
			cloudcodeRefs += findCloudcodePaRefs(content).length;
		}

		expect(antigravityBindings).toBe(0);
		expect(cloudcodeRefs).toBe(0);
		console.log("✓ CLEANUP COMPLETE: No google-antigravity bindings, no cloudcode-pa refs. Safe to submit appeal form.");
	});
});
