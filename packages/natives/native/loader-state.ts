import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { embeddedAddon } from "./embedded-addon.js";
import {
	cleanupStaleNativeVersions,
	prepareNativeVersionDir,
} from "./loader-cache.ts";
import {
	detectCompiledBinary,
	getAddonFilenames,
	getNativesDir,
	resolveLeafPackageDir,
	resolveLoaderCandidates,
	shouldStageNodeModulesAddon,
} from "./loader-candidates.ts";
import type {
	EmbeddedAddonFile,
	ExtractEmbeddedAddonsInput,
	InitLoaderContextOverrides,
	NativeLoaderContext,
} from "./loader-state.d.ts";
import {
	describeLoadedAddon,
	reportStaleWorkspaceAddon,
	setLoadedAddon,
	validateLoadedBindings,
} from "./loader-validation.ts";
import {
	getVariantOverride,
	resolveCpuVariant,
} from "./loader-variant.ts";
import { versionSentinelFor } from "./version-sentinel.js";

// Re-export pure helpers from modular subcomponents
export * from "./loader-cache.ts";
export * from "./loader-candidates.ts";
export * from "./loader-variant.ts";
export * from "./loader-validation.ts";

export const SUPPORTED_PLATFORMS = [
	"linux-x64",
	"linux-arm64",
	"darwin-x64",
	"darwin-arm64",
	"win32-x64",
	"win32-arm64",
];

export function startupMarker(text: string): void {
	if (!process.env.PI_DEBUG_STARTUP) return;
	try {
		fs.writeSync(2, `[startup] ${text}\n`);
	} catch {
		// stderr unavailable
	}
}

function selectEmbeddedAddonFile(selectedVariant: "modern" | "baseline" | null): EmbeddedAddonFile | null {
	if (!embeddedAddon) return null;
	const defaultFile = (embeddedAddon.files as EmbeddedAddonFile[]).find(file => file.variant === "default") || null;
	if (process.arch !== "x64") return defaultFile || (embeddedAddon.files[0] as EmbeddedAddonFile) || null;
	if (selectedVariant === "modern") {
		return (
			(embeddedAddon.files as EmbeddedAddonFile[]).find(file => file.variant === "modern") ||
			(embeddedAddon.files as EmbeddedAddonFile[]).find(file => file.variant === "baseline") ||
			null
		);
	}
	return (embeddedAddon.files as EmbeddedAddonFile[]).find(file => file.variant === "baseline") || defaultFile || null;
}

export function extractEmbeddedAddons({ files, targetDir }: ExtractEmbeddedAddonsInput): string[] {
	const writtenPaths: string[] = [];
	for (const file of files) {
		const targetPath = path.join(targetDir, file.filename);
		try {
			const buf = fs.readFileSync(file.zstdPath);
			fs.writeFileSync(targetPath, buf);
			writtenPaths.push(targetPath);
		} catch {
			// best effort
		}
	}
	return writtenPaths;
}

function maybeExtractEmbeddedAddon(
	ctx: NativeLoaderContext,
	errors: string[],
	file: EmbeddedAddonFile | null = selectEmbeddedAddonFile(ctx.selectedVariant),
): string | null {
	if (!ctx.isCompiledBinary || !embeddedAddon) return null;
	if (embeddedAddon.platformTag !== ctx.platformTag || embeddedAddon.version !== ctx.packageVersion) return null;
	if (!file) return null;
	const targetPath = path.join(ctx.versionedDir, file.filename);

	startupMarker("native:extractEmbeddedAddon:start");
	try {
		prepareNativeVersionDir(ctx.versionedDir);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		errors.push(`embedded addon dir: ${message}`);
		return null;
	}

	if (fs.existsSync(targetPath)) return targetPath;
	try {
		const buf = fs.readFileSync((file as unknown as { filePath?: string }).filePath ?? file.zstdPath);
		fs.writeFileSync(targetPath, buf);
		return targetPath;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		errors.push(`embedded addon write (${file.filename}): ${message}`);
		return null;
	}
}

function maybeStageNodeModulesAddon(ctx: NativeLoaderContext, errors: string[]): string | null {
	if (!ctx.stageFromNodeModules) return null;

	let stagedPath: string | null = null;
	for (const filename of ctx.addonFilenames) {
		const sourcePath = path.join(ctx.leafPackageDir ?? ctx.nativeDir, filename);
		const targetPath = path.join(ctx.versionedDir, filename);

		if (fs.existsSync(targetPath)) {
			stagedPath = stagedPath || targetPath;
			continue;
		}
		if (!fs.existsSync(sourcePath)) continue;

		try {
			prepareNativeVersionDir(ctx.versionedDir);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`staged addon dir: ${message}`);
			continue;
		}

		try {
			fs.copyFileSync(sourcePath, targetPath);
			stagedPath = stagedPath || targetPath;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`staged addon copy (${filename}): ${message}`);
		}
	}
	return stagedPath;
}

function installNativeTokioRuntime(bindings: Record<string, unknown>): void {
	const install = bindings.__tauInstallTokioRuntime;
	if (typeof install !== "function") return;
	try {
		(install as () => void)();
		startupMarker("native:tokioRuntime:installed");
	} catch (err) {
		startupMarker(`native:tokioRuntime:failed:${err instanceof Error ? err.message : String(err)}`);
	}
}

function configureGrammarDir(bindings: Record<string, unknown>, nativesDir: string): void {
	const setGrammarDir = bindings.__ompSetGrammarDir;
	if (typeof setGrammarDir === "function") (setGrammarDir as (dir: string) => void)(path.join(nativesDir, "grammars"));
}

function buildHelpMessage(ctx: NativeLoaderContext): string {
	if (ctx.isCompiledBinary) {
		const expectedPaths = ctx.addonFilenames.map(filename => `  ${path.join(ctx.versionedDir, filename)}`).join("\n");
		const downloadHints = ctx.addonFilenames
			.map(filename => {
				const downloadUrl = `https://github.com/toxicwind/tau/releases/latest/download/${filename}`;
				const targetPath = path.join(ctx.versionedDir, filename);
				return `  curl -fsSL "${downloadUrl}" -o "${targetPath}"`;
			})
			.join("\n");
		return (
			`The compiled binary should extract one of:\n${expectedPaths}\n\n` +
			`If missing, delete ${ctx.versionedDir} and re-run, or download manually:\n${downloadHints}`
		);
	}
	return (
		"If installed via npm/bun, try reinstalling: bun install @tau/tau-natives\n" +
		"If developing locally, build with: bun --cwd=packages/natives run build\n" +
		"Explicit targets: bun scripts/bazel-natives.ts <target> --dest packages/natives/native"
	);
}

export function initLoaderContext(overrides: InitLoaderContextOverrides = {}): NativeLoaderContext {
	const platform = overrides.platform ?? process.platform;
	const platformTag = `${platform}-${process.arch}`;
	const packageVersion = packageJson.version;
	const nativeDir = overrides.nativeDir ?? path.join(import.meta.dir, "..", "native");
	const execDir = path.dirname(process.execPath);
	const nativesDir = getNativesDir();
	const versionedDir = path.join(nativesDir, packageVersion);
	const userDataDir =
		platform === "win32"
			? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "tau")
			: path.join(os.homedir(), ".local", "bin");

	const isCompiledBinary =
		overrides.isCompiledBinary ??
		detectCompiledBinary({
			embeddedAddon,
			env: process.env,
			importMetaUrl: import.meta.url,
		});
	const normalizedNativeDir = platform === "win32" ? nativeDir.toLowerCase() : nativeDir;
	const isWorkspaceLoad =
		!isCompiledBinary &&
		!normalizedNativeDir.includes("\\node_modules\\") &&
		!normalizedNativeDir.includes("/node_modules/");
	const leafPackageDir =
		isCompiledBinary || isWorkspaceLoad
			? null
			: overrides.leafPackageDir === undefined
				? resolveLeafPackageDir(platformTag)
				: overrides.leafPackageDir;
	const stageFromNodeModules = shouldStageNodeModulesAddon({
		platform,
		isCompiledBinary,
		nativeDir: normalizedNativeDir,
	});

	const selectedVariant = resolveCpuVariant(getVariantOverride());
	const addonFilenames = getAddonFilenames({ tag: platformTag, arch: process.arch, variant: selectedVariant });
	const addonLabel = selectedVariant ? `${platformTag} (${selectedVariant})` : platformTag;

	const candidates = resolveLoaderCandidates({
		addonFilenames,
		isCompiledBinary,
		stageFromNodeModules,
		nativeDir,
		leafPackageDir,
		execDir,
		versionedDir,
		userDataDir,
	});

	return {
		platformTag,
		packageVersion,
		nativeDir,
		leafPackageDir,
		versionedDir,
		isCompiledBinary,
		stageFromNodeModules,
		selectedVariant,
		addonFilenames,
		addonLabel,
		candidates,
		isWorkspaceLoad,
		nativesDir,
	};
}

export function loadNative(): Record<string, unknown> {
	startupMarker("native:loadNative:start");
	const ctx = initLoaderContext();
	const require_ = createRequire(import.meta.url);

	const errors: string[] = [];
	const embeddedCandidate = maybeExtractEmbeddedAddon(ctx, errors);
	const stagedCandidate = embeddedCandidate ? null : maybeStageNodeModulesAddon(ctx, errors);
	const prepended = [embeddedCandidate, stagedCandidate].filter((c): c is string => typeof c === "string");
	const runtimeCandidates = prepended.length > 0 ? [...prepended, ...ctx.candidates] : ctx.candidates;
	const fallbackEmbeddedFile =
		ctx.selectedVariant === "modern" && embeddedAddon
			? (embeddedAddon.files as EmbeddedAddonFile[]).find(file => file.variant === "baseline")
			: null;
	const fallbackEmbeddedPath = fallbackEmbeddedFile && path.join(ctx.versionedDir, fallbackEmbeddedFile.filename);

	for (const candidate of runtimeCandidates) {
		if (fallbackEmbeddedFile && candidate === fallbackEmbeddedPath) {
			maybeExtractEmbeddedAddon(ctx, errors, fallbackEmbeddedFile);
		}
		try {
			startupMarker(`native:require:${path.basename(candidate)}`);
			const bindings = require_(candidate) as Record<string, unknown>;
			validateLoadedBindings(ctx, bindings, candidate);
			installNativeTokioRuntime(bindings);
			configureGrammarDir(bindings, ctx.nativesDir);
			const addon = describeLoadedAddon(bindings, candidate, ctx);
			setLoadedAddon(addon);
			reportStaleWorkspaceAddon(ctx, addon);
			cleanupStaleNativeVersions({ nativesDir: ctx.nativesDir, currentVersion: ctx.packageVersion });
			startupMarker("native:loadNative:done");
			return bindings;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			errors.push(`${candidate}: ${message}`);
		}
	}

	if (!SUPPORTED_PLATFORMS.includes(ctx.platformTag)) {
		throw new Error(
			`Unsupported platform: ${ctx.platformTag}\n` +
				`Supported platforms: ${SUPPORTED_PLATFORMS.join(", ")}\n` +
				"If you need support for this platform, please open an issue.",
		);
	}
	const details = errors.map(error => `- ${error}`).join("\n");
	throw new Error(
		`Failed to load tau_natives native addon for ${ctx.addonLabel}.\n\nTried:\n${details}\n\n${buildHelpMessage(ctx)}`,
	);
}
