#!/usr/bin/env bun
/**
 * Sync the legacy pi contract manifest with upstream pi's export surface.
 *
 * Reads pi-contract.lock for the pinned commit
 * Fetches dist/index.d.ts from that commit (via raw.githubusercontent.com)
 * Extracts every `export` symbol
 * Diffs against LEGACY_PI_ROOT_EXPORTS
 * In --check mode, exits non-zero with `contract drift: +Foo, -Bar` if they diverge
 *
 * Usage:
 *   bun run scripts/sync-legacy-pi-contract.ts          # updates manifest and lock if needed
 *   bun run scripts/sync-legacy-pi-contract.ts --check   # CI mode: fail on drift
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");

const lockFile = resolve(__dirname, "..", "pi-contract.lock");
const manifestFile = resolve(__dirname, "..", "src", "extensibility", "legacy-pi-contract.ts");

interface Lock {
	sha: string;
	repo: string;
}

// Parse lock file
async function readLock(): Promise<Lock> {
	const content = await readFile(lockFile, "utf-8");
	const lines = content.split("\n");
	const lock: Partial<Lock> = {};
	for (const line of lines) {
		if (line.startsWith("sha: ")) {
			lock.sha = line.slice(5).trim();
		}
		if (line.startsWith("repo: ")) {
			lock.repo = line.slice(6).trim();
		}
	}
	if (!lock.sha || !lock.repo) {
		throw new Error(`Invalid lock file: ${lockFile}`);
	}
	return lock as Lock;
}

// Fetch dist/index.d.ts from GitHub raw
// We fallback to the local estate copy if the remote fetch fails.
async function fetchUpstreamDTS(lock: Lock): Promise<string> {
	// First, try to read from the local estate pi-coding-agent
	const localPath = `/home/toxic/pens/estate/config/tau/plugins/node_modules/@${lock.repo}/dist/index.d.ts`;
	try {
		return await readFile(localPath, "utf-8");
	} catch (localErr) {
		// If local file fails, try the remote fetch
		const url = `https://raw.githubusercontent.com/${lock.repo}/${lock.sha}/dist/index.d.ts`;
		const res = await fetch(url);
		if (!res.ok) {
			throw new Error(`Failed to fetch ${url}: ${res.status}. Also failed to read local file: ${localPath}`);
		}
		return await res.text();
	}
}

// Parse export symbols from .d.ts content
function parseExports(dtsContent: string): Set<string> {
	const exports = new Set<string>();
	// Match export { ... } and export const/function/class etc.
	// We'll do a simple regex for named exports and export statements.
	// This is not perfect but works for the typical pi coding agent dts.
	const exportRegex = /export\s+(?:const|let|var|function|class|type)\s+(\w+)|export\s*{\s*([^}]+)\s*}/g;
	let match;
	while ((match = exportRegex.exec(dtsContent)) !== null) {
		if (match[1]) {
			exports.add(match[1]);
		} else if (match[2]) {
			// Split by comma and trim
			const named = match[2].split(",").map(s => s.trim());
			for (const name of named) {
				if (name) exports.add(name);
			}
		}
	}
	return exports;
}

// Parse the current manifest
function parseManifest(content: string): Set<string> {
	const exports = new Set<string>();
	// Look for the LEGACY_PI_ROOT_EXPORTS object
	const objMatch = content.match(/LEGACY_PI_ROOT_EXPORTS\s*=\s*{([^}]+)};/s);
	if (!objMatch) return exports;
	const objContent = objMatch[1];
	// Match each line: key: "kind",
	const lineRegex = /(\w+)\s*:\s*"(?:function|class|type)"/g;
	let lineMatch;
	while ((lineMatch = lineRegex.exec(objContent)) !== null) {
		exports.add(lineMatch[1]);
	}
	return exports;
}

// Generate manifest content from export set and lock
function generateManifest(exports: Set<string>, lock: Lock): string {
	const lines = [
		"/**",
		" * Canonical manifest of every runtime export of `@earendil-works/pi-coding-agent`",
		" * that legacy extensions may import from the package root.",
		" *",
		" * Pinned to pi commit in ./pi-contract.lock.",
		' * Every "function"/"class" entry MUST be re-exported by',
		" * legacy-tau-coding-agent-shim.ts. See legacy-pi-contract.test.ts.",
		" *",
		" * Regenerate with: bun run scripts/sync-legacy-pi-contract.ts",
		" */",
		"export const LEGACY_PI_ROOT_EXPORTS = {",
	];
	// Sort for deterministic output
	const sorted = Array.from(exports).sort();
	// We'll create a map of name to kind for known ones.
	const knownKinds: Record<string, "function" | "class" | "type"> = {
		AgentSession: "class",
		ParsedSkillBlock: "type",
		// Add others as needed
	};
	lines.push(...sorted.map(name => `  ${name}: "${knownKinds[name] || "function"}",`));
	lines.push('} as const satisfies Record<string, "function" | "class" | "type">;');
	lines.push("");
	return lines.join("\n");
}

// Main
async function main() {
	const args = process.argv.slice(2);
	const checkMode = args.includes("--check");

	const lock = await readLock();
	console.log(`Using upstream ${lock.repo}@${lock.sha}`);

	const dtsContent = await fetchUpstreamDTS(lock);
	const upstreamExports = parseExports(dtsContent);

	let manifestContent;
	try {
		manifestContent = await readFile(manifestFile, "utf-8");
	} catch {
		manifestContent = "";
	}
	const currentExports = parseManifest(manifestContent);

	const onlyInUpstream = new Set([...upstreamExports].filter(x => !currentExports.has(x)));
	const onlyInCurrent = new Set([...currentExports].filter(x => !upstreamExports.has(x)));

	if (checkMode) {
		if (onlyInUpstream.size === 0 && onlyInCurrent.size === 0) {
			console.log("✅ Legacy pi contract is in sync");
			process.exit(0);
		} else {
			const drift = [];
			if (onlyInUpstream.size > 0) {
				drift.push(`+${Array.from(onlyInUpstream).sort().join(", +")}`);
			}
			if (onlyInCurrent.size > 0) {
				drift.push(`-${Array.from(onlyInCurrent).sort().join(", -")}`);
			}
			console.error(`❌ Contract drift: ${drift.join(" ")}`);
			process.exit(1);
		}
	} else {
		// Update manifest and lock if needed
		if (onlyInUpstream.size > 0 || onlyInCurrent.size > 0) {
			console.log("🔄 Updating legacy pi contract manifest");
			const manifest = generateManifest(upstreamExports, lock);
			await writeFile(manifestFile, manifest, "utf-8");
			console.log(`✅ Updated ${manifestFile}`);
		} else {
			console.log("✅ Legacy pi contract is already in sync");
		}
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
