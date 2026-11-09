import * as fs from "node:fs";
import * as path from "node:path";

export function parseReleaseVersion(version: string): [number, number, number] | null {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isOlderReleaseVersion(candidate: string, current: string): boolean {
	const candidateParts = parseReleaseVersion(candidate);
	const currentParts = parseReleaseVersion(current);
	if (!candidateParts || !currentParts) return false;
	for (let index = 0; index < candidateParts.length; index++) {
		if (candidateParts[index] !== currentParts[index]) {
			return candidateParts[index]! < currentParts[index]!;
		}
	}
	return false;
}

export const NATIVE_CACHE_CLEANUP_GRACE_MS = 10 * 60_000;

export function prepareNativeVersionDir(versionedDir: string): void {
	fs.mkdirSync(versionedDir, { recursive: true });
	const now = new Date();
	fs.utimesSync(versionedDir, now, now);
}

export interface CleanupStaleNativeVersionsInput {
	nativesDir: string;
	currentVersion: string;
}

export function cleanupStaleNativeVersions({
	nativesDir,
	currentVersion,
}: CleanupStaleNativeVersionsInput): string[] {
	const removed: string[] = [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(nativesDir, { withFileTypes: true });
	} catch {
		return removed;
	}

	for (const entry of entries) {
		if (!entry.isDirectory() || !isOlderReleaseVersion(entry.name, currentVersion)) continue;
		const targetPath = path.join(nativesDir, entry.name);
		try {
			const stat = fs.statSync(targetPath);
			if (Date.now() - stat.mtimeMs < NATIVE_CACHE_CLEANUP_GRACE_MS) continue;
			fs.rmSync(targetPath, { recursive: true, force: true });
			removed.push(targetPath);
		} catch {
			// Stale caches are opportunistic cleanup only.
		}
	}
	return removed;
}
