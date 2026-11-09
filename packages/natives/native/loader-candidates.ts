import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import type {
	DetectCompiledBinaryInput,
	GetAddonFilenamesInput,
	ResolveLoaderCandidatesInput,
	ShouldStageNodeModulesAddonInput,
} from "./loader-state.d.ts";

export function getNativesDir(): string {
	const override = process.env.PI_NATIVES_DIR?.trim();
	if (override) {
		let dir = override;
		if (dir === "~") dir = os.homedir();
		else if (dir.startsWith("~/") || dir.startsWith("~\\")) dir = os.homedir() + dir.slice(1);
		if (path.isAbsolute(dir)) return path.normalize(dir);
	}
	const xdgDataHome = process.env.XDG_DATA_HOME;
	if (xdgDataHome && fs.existsSync(path.join(xdgDataHome, "tau"))) {
		return path.join(xdgDataHome, "tau", "natives");
	}
	return path.join(os.homedir(), ".tau", "natives");
}

export function resolveLeafPackageDir(platformTag: string): string | null {
	try {
		const require_ = createRequire(import.meta.url);
		return path.dirname(require_.resolve(`@tau/tau-natives-${platformTag}/package.json`));
	} catch {
		return null;
	}
}

export function detectCompiledBinary({
	embeddedAddon,
	env,
	importMetaUrl,
}: DetectCompiledBinaryInput): boolean {
	if (embeddedAddon) return true;
	if (env && env.PI_COMPILED) return true;
	if (typeof importMetaUrl === "string") {
		if (importMetaUrl.includes("$bunfs")) return true;
		if (importMetaUrl.includes("~BUN")) return true;
		if (importMetaUrl.includes("%7EBUN")) return true;
	}
	return false;
}

export function getAddonFilenames({ tag, arch, variant }: GetAddonFilenamesInput): string[] {
	const defaultFilename = `tau_natives.${tag}.node`;
	if (arch !== "x64" || !variant) return [defaultFilename];
	const baselineFilename = `tau_natives.${tag}-baseline.node`;
	const modernFilename = `tau_natives.${tag}-modern.node`;
	if (variant === "modern") {
		return [modernFilename, baselineFilename, defaultFilename];
	}
	return [baselineFilename, defaultFilename];
}

export function shouldStageNodeModulesAddon({
	platform,
	isCompiledBinary,
	nativeDir,
}: ShouldStageNodeModulesAddonInput): boolean {
	if (platform !== "win32") return false;
	if (isCompiledBinary) return false;
	const normalizedNativeDir = nativeDir.toLowerCase();
	return normalizedNativeDir.includes("\\node_modules\\") || normalizedNativeDir.includes("/node_modules/");
}

export function resolveLoaderCandidates({
	addonFilenames,
	isCompiledBinary,
	stageFromNodeModules = false,
	nativeDir,
	leafPackageDir = null,
	execDir,
	versionedDir,
	userDataDir,
}: ResolveLoaderCandidatesInput): string[] {
	const baseReleaseCandidates = addonFilenames.flatMap(filename => [
		path.join(nativeDir, filename),
		path.join(execDir, filename),
	]);
	const leafCandidates = leafPackageDir ? addonFilenames.map(filename => path.join(leafPackageDir, filename)) : [];
	const compiledCandidates = addonFilenames.flatMap(filename => [
		path.join(versionedDir, filename),
		path.join(userDataDir, filename),
	]);
	const stagedCandidates = stageFromNodeModules
		? addonFilenames.map(filename => path.join(versionedDir, filename))
		: [];
	let releaseCandidates: string[];
	if (isCompiledBinary) {
		releaseCandidates = [...compiledCandidates, ...baseReleaseCandidates];
	} else if (stageFromNodeModules) {
		releaseCandidates = [...stagedCandidates, ...leafCandidates, ...baseReleaseCandidates];
	} else {
		releaseCandidates = [...leafCandidates, ...baseReleaseCandidates];
	}
	return [...new Set(releaseCandidates)];
}
