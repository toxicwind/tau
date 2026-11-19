import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getDaemonRuntimeDir } from "@tau/tau-utils";
import { canonicalProjectDir, writeDaemonScopeMeta } from "../launch/paths";

/**
 * Serve-scope paths: per-project runtime files for the session-host daemon
 * (`tau serve`). Shares the daemon broker's canonical-cwd hashing so every tau
 * process in the same directory agrees on the endpoint.
 */

const SERVE_SOCKET = "serve.sock";
const SERVE_TOKEN = "serve.token";
const SERVE_PID = "serve.pid";

export interface ServePaths {
	endpoint: string;
	tokenPath: string;
	pidPath: string;
}

/** Resolve (and with `create`, provision) the serve runtime paths for one project directory. */
export async function servePaths(projectDir: string, options?: { create?: boolean }): Promise<ServePaths> {
	const canonical = await canonicalProjectDir(projectDir);
	if (process.platform === "win32") {
		const key = Bun.hash.wyhash(canonical).toString(16).padStart(16, "0");
		return {
			endpoint: `\\\\.\\pipe\\tau-serve-${key}`,
			tokenPath: path.join(getDaemonRuntimeDir(canonical), SERVE_TOKEN),
			pidPath: path.join(getDaemonRuntimeDir(canonical), SERVE_PID),
		};
	}
	const runtimeDir = getDaemonRuntimeDir(canonical);
	if (options?.create) {
		await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
		await writeDaemonScopeMeta(runtimeDir, canonical);
	}
	return {
		endpoint: path.join(runtimeDir, SERVE_SOCKET),
		tokenPath: path.join(runtimeDir, SERVE_TOKEN),
		pidPath: path.join(runtimeDir, SERVE_PID),
	};
}
