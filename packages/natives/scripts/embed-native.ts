import * as fs from "node:fs/promises";
import * as path from "node:path";
import packageJson from "../package.json" with { type: "json" };
import {
	containsLegacyVersionSentinel,
	containsVersionStamp,
	VERSION_STAMP_MAGIC,
} from "../native/version-sentinel.js";

const defaultNativeDir = path.join(import.meta.dir, "../native");

/**
 * zstd level for embedded addons. Each addon is its own frame with no
 * container header or timestamp, so identical addon bytes always embed
 * identically and consecutive binaries differ only where the addon did.
 */
export const EMBEDDED_ADDON_ZSTD_LEVEL = 19;

/** Platform/architecture pair whose addons a standalone binary embeds. */
export interface NativeEmbedTarget {
	readonly platform: string;
	readonly arch: string;
}

/** Inputs for {@link embeddedAddonFiles}. */
export interface EmbedOptions extends NativeEmbedTarget {
	/** Directory holding the built `pi_natives.*.node` addons; defaults to this package's `native/`. */
	readonly nativeDir?: string;
	/** Release every embedded addon must be stamped with; defaults to this package's version. */
	readonly version?: string;
}

/**
 * Build the in-memory `Bun.build({ files })` overrides that embed one target's
 * addons into a standalone binary: one `<addon>.node.zst` zstd frame per addon
 * variant and a replacement for the checked-in null `native/embedded-addon.js`
 * manifest that points at them. Output is a pure function of the addon bytes
 * (no timestamps, no container), which keeps release-to-release binary patches
 * small.
 *
 * Nothing is written to disk. Bun.build shares the runtime's directory cache
 * and never re-reads it on a miss, so a process that imported pi-natives before
 * writing the frames cannot resolve them; in-memory files bypass that lookup.
 *
 * @throws when no addon exists for the target, or when an addon lacks the
 * `@oh-my-pi/pi-natives@<version>` version stamp and legacy sentinel.
 */
export async function embeddedAddonFiles({
	platform,
	arch,
	nativeDir = defaultNativeDir,
	version = packageJson.version,
}: EmbedOptions): Promise<Record<string, string | Uint8Array>> {
	const platformTag = `${platform}-${arch}`;
	const candidates =
		arch === "x64"
			? [
					{ variant: "modern", filename: `pi_natives.${platformTag}-modern.node` },
					{ variant: "baseline", filename: `pi_natives.${platformTag}-baseline.node` },
				]
			: [{ variant: "default", filename: `pi_natives.${platformTag}.node` }];

	// Override keys must equal the bundler's symlink-resolved module paths.
	const dir = await fs.realpath(nativeDir);
	const present = new Set(await fs.readdir(dir));
	const available = await Promise.all(
		candidates
			.filter(candidate => present.has(candidate.filename))
			.map(async candidate => ({ ...candidate, bytes: await fs.readFile(path.join(dir, candidate.filename)) })),
	);
	if (available.length === 0) {
		const expected = candidates.map(candidate => `  - ${candidate.filename}`).join("\n");
		throw new Error(`No native addons found for ${platformTag}. Expected one of:\n${expected}`);
	}
	for (const { filename, bytes } of available) {
		// Pre-stamp addons (npm releases and main builds before the stamp slot)
		// identify their release by the legacy export, which the loader accepts.
		if (!containsVersionStamp(bytes, version) && !containsLegacyVersionSentinel(bytes, version)) {
			const addonPath = path.join(dir, filename);
			throw new Error(
				`Native addon ${addonPath} does not carry the @oh-my-pi/pi-natives@${version} version stamp ` +
					`\`${VERSION_STAMP_MAGIC}${version}\`. Rebuild it (installs stamp automatically), run ` +
					`\`bun scripts/stamp-native-version.ts ${addonPath}\`, or fetch @oh-my-pi/pi-natives-${platformTag}@${version} before embedding.`,
			);
		}
	}

	// Variants compress concurrently on Bun's thread pool.
	const frames = await Promise.all(
		available.map(({ bytes }) => Bun.zstdCompress(bytes, { level: EMBEDDED_ADDON_ZSTD_LEVEL })),
	);
	const imports = available.map(
		({ filename }, index) =>
			`import zstdPath${index} from ${JSON.stringify(`./${filename}.zst`)} with { type: "file" };`,
	);
	const files = available.map(
		({ variant, filename, bytes }, index) =>
			`{ variant: ${JSON.stringify(variant)}, filename: ${JSON.stringify(filename)}, size: ${bytes.length}, zstdPath: zstdPath${index} }`,
	);
	const manifest = `${imports.join("\n")}

export const embeddedAddon = {
	platformTag: ${JSON.stringify(platformTag)},
	version: ${JSON.stringify(version)},
	files: [
		${files.join(",\n\t\t")},
	],
};
`;

	const overrides: Record<string, string | Uint8Array> = {};
	available.forEach(({ filename }, index) => {
		overrides[path.join(dir, `${filename}.zst`)] = frames[index];
	});
	overrides[path.join(dir, "embedded-addon.js")] = manifest;
	return overrides;
}
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
/**
 * Validate and embed native addons for one standalone-binary target.
 */
export async function embedNativeAddon({
	targetPlatform,
	targetArch,
	nativeDir,
	outputPath,
	version,
}: {
	targetPlatform: string;
	targetArch: string;
	nativeDir: string;
	outputPath: string;
	version: string;
}): Promise<void> {
	const platformTag = `${targetPlatform}-${targetArch}`;
	const candidates: CandidateAddon[] =
		targetArch === "x64"
			? [
					{ variant: "modern", filename: `tau_natives.${platformTag}-modern.node` },
					{ variant: "baseline", filename: `tau_natives.${platformTag}-baseline.node` },
				]
			: [{ variant: "default", filename: `tau_natives.${platformTag}.node` }];

	const available: AvailableAddon[] = [];
	for (const candidate of candidates) {
		const candidatePath = path.join(nativeDir, candidate.filename);
		try {
			const stat = await fs.stat(candidatePath);
			available.push({ ...candidate, path: candidatePath, size: stat.size });
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
		}
	}

	if (available.length === 0) {
		const expected = candidates.map(candidate => `  - ${candidate.filename}`).join("\n");
		throw new Error(`No native addons found for ${platformTag}. Expected one of:\n${expected}`);
	}

	const archiveFilename = `${archivePrefix}${platformTag}${archiveSuffix}`;
	const archivePath = path.join(nativeDir, archiveFilename);
	const archiveEntries: Record<string, Uint8Array> = {};
	const versionSentinel = versionSentinelFor(version);
	for (const addon of available) {
		const bytes = await fs.readFile(addon.path);
		if (!containsVersionSentinel(bytes, versionSentinel)) {
			throw new Error(
				`Native addon ${addon.path} does not contain the @tau/tau-natives@${version} version sentinel ` +
					`\`${versionSentinel}\`. Rebuild it or fetch @tau/tau-natives-${platformTag}@${version} before embedding.`,
			);
		}
		archiveEntries[addon.filename] = bytes;
	}
	await Bun.write(archivePath, await new Bun.Archive(archiveEntries, { compress: "gzip", level: 9 }).bytes());

	const files = available
		.map(
			addon =>
				`\t\t{ variant: ${JSON.stringify(addon.variant)}, filename: ${JSON.stringify(addon.filename)}, size: ${addon.size} },`,
		)
		.join("\n");

	const content = `
// AUTOGENERATED FILE -- DO NOT EDIT DIRECTLY
// See scripts/embed-native.ts

${embeddedAddonTypedefs}

import archivePath from ${JSON.stringify(`../native/${archiveFilename}`)} with { type: "file" };

export const embeddedAddon = {
\tplatformTag: ${JSON.stringify(platformTag)},
\tversion: ${JSON.stringify(version)},
\tarchive: {
\t\tformat: "tar.gz",
\t\tfilename: ${JSON.stringify(archiveFilename)},
\t\tfilePath: archivePath,
\t},
\tfiles: [
${files}
\t],
};
`;

	await Bun.write(outputPath, content);
}
