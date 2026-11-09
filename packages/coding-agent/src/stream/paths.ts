import { getDaemonRuntimeDir } from "@tau/tau-utils";
import { ipcEndpoint } from "@oh-my-pi/pi-natives";
import { canonicalProjectDir } from "../launch/paths";

/**
// refused_by: statement_fold · collision: `* Resolve the Unix socket or Windows named pipe `omp stream` li…` +1 more
 * Resolve the Unix socket or Windows named pipe `tau stream` listens on for
 * one project directory. Shares the daemon broker's canonical-cwd hashing so
 * every tau process in the same directory agrees on the endpoint.
 *
 * With `create`, the runtime directory is created (streamer side); sessions
 * only connect and must not create it.
 */
export async function streamSocketEndpoint(projectDir: string): Promise<string> {
	return ipcEndpoint(getDaemonRuntimeDir(await canonicalProjectDir(projectDir)), "stream");
// refused_by: statement_fold · collision: none (no common ancestor text)
	if (process.platform === "win32") {
		const key = Bun.hash.wyhash(canonical).toString(16).padStart(16, "0");
		return `\\\\.\\pipe\\tau-stream-${key}`;
	}
}
