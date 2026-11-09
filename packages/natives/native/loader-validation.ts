import * as fs from "node:fs";
import { createRequire } from "node:module";
import type { NativeAddonStatus, ValidateLoadedBindingsContext } from "./loader-state.d.ts";
import {
	bindingsHaveReleaseIdentity,
	bindingsReleaseVersion,
	containsVersionStamp,
	isVersionSentinelName,
	versionSentinelVersion,
} from "./version-sentinel.js";

export function sentinelMatchesExpected(sentinel: string, expected: string): boolean {
	if (sentinel === expected) return true;
	const version = versionSentinelVersion(sentinel);
	return version !== null && version === versionSentinelVersion(expected);
}

export function isCompatiblePreSentinelNativeAddon(
	bindings: Record<string, unknown>,
	diskHasExpectedStamp: boolean,
): boolean {
	if (diskHasExpectedStamp) return false;
	if (bindingsHaveReleaseIdentity(bindings)) return false;
	if (Object.keys(bindings).some(key => isVersionSentinelName(key))) return false;
	const ds = bindings.DesktopSession as { prototype?: Record<string, unknown> } | undefined;
	return (
		typeof bindings.countTokens === "function" &&
		typeof bindings.executeShell === "function" &&
		typeof bindings.visibleWidth === "function" &&
		typeof bindings.DesktopSession === "function" &&
		typeof ds?.prototype?.capture === "function" &&
		typeof ds?.prototype?.execute === "function" &&
		typeof ds?.prototype?.close === "function"
	);
}

export function validateLoadedBindings(
	ctx: ValidateLoadedBindingsContext & { versionSentinelExport?: string },
	bindings: Record<string, unknown>,
	candidate: string,
): void {
	if (ctx.isWorkspaceLoad) return;
	const residentVersion = bindingsReleaseVersion(bindings);
	if (residentVersion === ctx.packageVersion) return;
	const expected = ctx.versionSentinelExport ?? `__tauNativesV${ctx.packageVersion.replace(/[^A-Za-z0-9]/g, "_")}`;
	if (Object.keys(bindings).some(key => sentinelMatchesExpected(key, expected))) return;

	const residentSentinel = Object.keys(bindings).find(
		key => key !== expected && isVersionSentinelName(key),
	);
	let diskHasExpectedStamp = false;
	try {
		diskHasExpectedStamp = containsVersionStamp(fs.readFileSync(candidate), ctx.packageVersion);
	} catch {
		// file missing or unreadable
	}
	if (isCompatiblePreSentinelNativeAddon(bindings, diskHasExpectedStamp)) return;
	if (residentVersion && diskHasExpectedStamp) {
		throw new Error(
			`Loaded ${candidate}, which exposes the @tau/tau-natives@${residentVersion} version ` +
				`sentinel \`${residentSentinel}\` but not the @${ctx.packageVersion} sentinel ` +
				`\`${expected}\` this loader expects. tau was upgraded to ` +
				`${ctx.packageVersion} while this session was running; the ${residentVersion} addon is ` +
				"still resident in this process. Disk is already consistent — restart tau to pick up " +
				`${ctx.packageVersion} (reinstalling changes nothing).`,
		);
	}
	throw new Error(
		`Loaded ${candidate} but it does not expose the @tau/tau-natives@${ctx.packageVersion} ` +
			`version sentinel \`${expected}\`. The .node file on disk is from a different ` +
			"release than this loader — reinstall to re-sync.",
	);
}

export let loadedAddon: NativeAddonStatus | null = null;

export function setLoadedAddon(addon: NativeAddonStatus | null): void {
	loadedAddon = addon;
}

export function describeLoadedAddon(
	bindings: Record<string, unknown>,
	candidate: string,
	ctx: { packageVersion: string; versionSentinelExport?: string },
): NativeAddonStatus {
	const sentinel = Object.keys(bindings).find(key => isVersionSentinelName(key)) ?? null;
	const version = sentinel ? versionSentinelVersion(sentinel) : null;
	const expected = ctx.versionSentinelExport ?? `__tauNativesV${ctx.packageVersion.replace(/[^A-Za-z0-9]/g, "_")}`;
	return {
		path: candidate,
		version,
		sentinel,
		expectedSentinel: expected,
		packageVersion: ctx.packageVersion,
		stale: sentinel === null || !sentinelMatchesExpected(sentinel, expected),
	};
}

export function nativeAddonStatus(): NativeAddonStatus | null {
	return loadedAddon;
}

const CLASS_STUB_PLAIN_STATICS = new Set([
	"prototype",
	"name",
	"length",
	"constructor",
	"then",
]);

export function missingNativeClass(
	symbolName: string,
	addon: NativeAddonStatus | null = loadedAddon,
): (new (...args: unknown[]) => never) | undefined {
	if (!addon?.stale) return undefined;
	const stub = class MissingNativeClass {
		constructor() {
			throw new Error(missingNativeExportMessage(symbolName, addon));
		}
	};
	return new Proxy(stub, {
		get(target, key, receiver) {
			if (typeof key === "symbol" || CLASS_STUB_PLAIN_STATICS.has(key)) {
				return Reflect.get(target, key, receiver);
			}
			throw new Error(missingNativeExportMessage(`${symbolName}.${String(key)}`, addon));
		},
	}) as unknown as new (...args: unknown[]) => never;
}

export function missingNativeExport(
	symbolName: string,
	addon: NativeAddonStatus | null = loadedAddon,
): ((...args: unknown[]) => never) | undefined {
	if (!addon?.stale) return undefined;
	return () => {
		throw new Error(missingNativeExportMessage(symbolName, addon));
	};
}

export function missingNativeExportMessage(
	symbolName: string,
	addon: NativeAddonStatus | null = loadedAddon,
): string {
	const rebuild = "rebuild it with `bun run build:native`";
	if (!addon) return `@tau/tau-natives export \`${symbolName}\` is missing (${rebuild}).`;
	if (!addon.stale) return `@tau/tau-natives export \`${symbolName}\` is missing from ${addon.path}; ${rebuild}.`;
	const version = addon.version !== undefined ? addon.version : (addon.sentinel ? versionSentinelVersion(addon.sentinel) : null);
	const loaded = version
		? `the @tau/tau-natives@${version} addon`
		: "an addon built before version sentinels existed";
	const expected = `__tauNativesV${addon.packageVersion.replace(/[^A-Za-z0-9]/g, "_")}`;
	return (
		`@tau/tau-natives export \`${symbolName}\` is missing: ${addon.path} is ${loaded}, ` +
		`not @${addon.packageVersion} (\`${expected}\`) — ${rebuild}.`
	);
}

export function staleWorkspaceAddonNotice(addon: NativeAddonStatus): string {
	const loaded = addon.version ? `@oh-my-pi/pi-natives@${addon.version}` : "an addon without a release stamp";
	return (
		`[pi-natives] ${addon.path} is ${loaded}, but this checkout is @${addon.packageVersion}. ` +
		"Symbols this checkout expects may be missing and shared ones may behave differently; " +
		"run `bun run build:native` before trusting results from this tree.\n"
	);
}

export const staleNoticeState = { reported: false };
let mainThreadAnswer: boolean | undefined;

function onMainThread(): boolean {
	if (mainThreadAnswer === undefined) {
		try {
			mainThreadAnswer = createRequire(import.meta.url)("node:worker_threads").isMainThread !== false;
		} catch {
			mainThreadAnswer = true;
		}
	}
	return mainThreadAnswer;
}

export function reportStaleWorkspaceAddon(
	ctx: { isWorkspaceLoad: boolean },
	addon: NativeAddonStatus,
	deps: { write?: (text: string) => void; state?: { reported: boolean } } = {},
): boolean {
	const state = deps.state ?? staleNoticeState;
	if (!ctx.isWorkspaceLoad || !addon.stale || state.reported || !onMainThread()) return false;
	state.reported = true;
	try {
		(deps.write ?? ((text: string) => fs.writeSync(2, text)))(staleWorkspaceAddonNotice(addon));
	} catch {
		// stderr unavailable
	}
	return true;
}
