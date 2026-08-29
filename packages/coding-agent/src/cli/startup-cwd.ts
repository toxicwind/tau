import { getProjectDir, setProjectDir } from "@oh-my-pi/pi-utils";
import type { Args } from "./args";

export async function applyStartupCwd(parsed: Args): Promise<void> {
	if (parsed.cwd) {
		try {
			setProjectDir(parsed.cwd);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			// Permission denials are the macOS TCC case; a plain ENOENT typo
			// should not be told to grant Full Disk Access.
			const code = (error as NodeJS.ErrnoException | null)?.code;
			const hint =
				code === "EACCES" || code === "EPERM"
					? " On macOS, grant omp Files & Folders or Full Disk Access permission for the target directory."
					: "";
			throw new Error(`Cannot change working directory to ${parsed.cwd}: ${reason}.${hint}`);
		}
		// setProjectDir resolves the (possibly relative) target against the launch
		// cwd and chdirs into it. Re-sync parsed.cwd to the resolved absolute path
		// so downstream consumers (buildSessionOptions, settings/discovery, session
		// persistence) don't re-resolve a relative string against the new cwd.
		parsed.cwd = getProjectDir();
		return;
	}
}
