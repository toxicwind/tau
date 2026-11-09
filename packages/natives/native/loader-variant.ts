import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import type { SelectCpuVariantInput, SelectCpuVariantResult } from "./loader-state.d.ts";

export const VARIANT_CACHE_ENV_KEY = "__PI_NATIVE_VARIANT_CACHE";

export function runCommand(command: string, args: string[]): string | null {
	if (typeof Bun !== "undefined" && typeof Bun.spawnSync === "function") {
		try {
			const result = Bun.spawnSync([command, ...args], { stdout: "pipe", stderr: "pipe" });
			if (result.exitCode === 0) {
				return result.stdout.toString("utf-8").trim();
			}
		} catch {
			// fall through to childProcess
		}
	}
	try {
		const result = childProcess.spawnSync(command, args, { encoding: "utf-8" });
		if (result.error) return null;
		if (result.status !== 0) return null;
		return (result.stdout || "").trim();
	} catch {
		return null;
	}
}

export function getVariantOverride(): "modern" | "baseline" | null {
	const value = process.env.PI_NATIVE_VARIANT;
	if (!value) return null;
	if (value === "modern" || value === "baseline") return value;
	return null;
}

export function detectAvx2Support(): boolean {
	if (process.arch !== "x64") {
		return false;
	}

	if (process.platform === "linux") {
		try {
			const cpuInfo = fs.readFileSync("/proc/cpuinfo", "utf8");
			return /\bavx2\b/i.test(cpuInfo);
		} catch {
			return false;
		}
	}

	if (process.platform === "darwin") {
		for (const sysctlBin of ["/usr/sbin/sysctl", "sysctl"]) {
			const leaf7 = runCommand(sysctlBin, ["-n", "machdep.cpu.leaf7_features"]);
			if (leaf7 && /\bAVX2\b/i.test(leaf7)) return true;
			const features = runCommand(sysctlBin, ["-n", "machdep.cpu.features"]);
			if (features && /\bAVX2\b/i.test(features)) return true;
		}
		return false;
	}

	if (process.platform === "win32") {
		if (typeof Bun !== "undefined") {
			try {
				const { dlopen, FFIType } = createRequire(import.meta.url)("bun:ffi");
				const kernel32 = dlopen("kernel32.dll", {
					IsProcessorFeaturePresent: { args: [FFIType.u32], returns: FFIType.i32 },
				});
				try {
					return kernel32.symbols.IsProcessorFeaturePresent(40) !== 0;
				} finally {
					kernel32.close();
				}
			} catch {
				// No FFI; fall through to PowerShell
			}
		}
		for (const shell of ["pwsh.exe", "powershell.exe"]) {
			const output = runCommand(shell, [
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"[System.Runtime.Intrinsics.X86.Avx2]::IsSupported",
			]);
			if (output && output.toLowerCase() === "true") return true;
			if (output && output.toLowerCase() === "false") return false;
		}
		return false;
	}

	return false;
}

export function selectCpuVariant({
	arch,
	override,
	env,
	detectAvx2,
}: SelectCpuVariantInput): SelectCpuVariantResult {
	if (arch !== "x64") return { variant: null, source: "non-x64" };
	if (override === "modern" || override === "baseline") {
		return { variant: override, source: "override" };
	}
	const cached = env[VARIANT_CACHE_ENV_KEY];
	if (cached === "modern" || cached === "baseline") {
		return { variant: cached, source: "cache" };
	}
	const variant = detectAvx2() ? "modern" : "baseline";
	return {
		variant,
		source: "detect",
		cacheEnvKey: VARIANT_CACHE_ENV_KEY,
		cacheEnvValue: variant,
	};
}

export function resolveCpuVariant(override?: "modern" | "baseline" | null): "modern" | "baseline" | null {
	const result = selectCpuVariant({
		arch: process.arch,
		override,
		env: process.env,
		detectAvx2: detectAvx2Support,
	});
	if (result.cacheEnvKey && result.cacheEnvValue) {
		process.env[result.cacheEnvKey] = result.cacheEnvValue;
	}
	return result.variant;
}
