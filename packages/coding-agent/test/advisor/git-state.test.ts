import { describe, expect, it } from "bun:test";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vcs from "@tau/tau-natives/vcs";
import { formatAdvisorGitState } from "../../src/advisor/git-state";

describe("formatAdvisorGitState", () => {
	it("reports a non-git directory as unavailable", async () => {
		// The default tmpdir may itself sit inside an outer git checkout
		// (e.g. /tmp wrapped by estate tooling), so walk up for a directory
		// whose nearest repo root is a strict ancestor — i.e. no repo at all.
		// A path under an unwrapped dir like /var/tmp is genuinely non-repo
		// on this estate; fall back to a deep path under /proc's /sys-like
		// non-git space if /var/tmp is also wrapped.
		const candidates = ["/var/tmp/tau-gitstate-none", "/sys/tau-gitstate-none"];
		let target: string | undefined;
		for (const dir of candidates) {
			try {
				await fsp.mkdir(dir, { recursive: true });
				if (vcs.repo(dir) === null) {
					target = dir;
					break;
				}
				await fsp.rm(dir, { recursive: true, force: true });
			} catch {
				// not writable / not usable — try next
			}
		}
		expect(target).toBeDefined();
		expect(await formatAdvisorGitState(target!)).toBe("(not a git repo)");
		if (target?.startsWith("/var/tmp/")) await fsp.rm(target, { recursive: true, force: true });
	});

	it("reports HEAD short sha, branch, and a clean tree", async () => {
		const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "tau-gitstate-clean-"));
		try {
			const git = (cmd: string) => Bun.$(cmd).cwd(dir).quiet().text();
			await git`git init -q -b main`;
			await fsp.writeFile(path.join(dir, "a.txt"), "x");
			await git`git add .`;
			await git`git -c user.email=t@t -c user.name=t commit -qm init`;
			const sha = (await git`git rev-parse --short HEAD`).trim();
			const state = await formatAdvisorGitState(dir);
			expect(state).toContain(`HEAD=${sha}`);
			expect(state).toContain("branch=main");
			expect(state).toContain("dirty=0");
		} finally {
			await fsp.rm(dir, { recursive: true, force: true });
		}
	});

	it("reports a dirty tree with the modified-path count", async () => {
		const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "tau-gitstate-dirty-"));
		try {
			const git = (cmd: string) => Bun.$(cmd).cwd(dir).quiet().text();
			await git`git init -q -b main`;
			await fsp.writeFile(path.join(dir, "a.txt"), "x");
			await fsp.writeFile(path.join(dir, "b.txt"), "y");
			await git`git add .`;
			await git`git -c user.email=t@t -c user.name=t commit -qm init`;
			await fsp.writeFile(path.join(dir, "a.txt"), "changed");
			await fsp.writeFile(path.join(dir, "untracked.ts"), "u");
			const state = await formatAdvisorGitState(dir);
			expect(state).toContain("dirty=2");
		} finally {
			await fsp.rm(dir, { recursive: true, force: true });
		}
	});

	it("reports detached HEAD as (detached) without a branch", async () => {
		const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "tau-gitstate-detached-"));
		try {
			const git = (cmd: string) => Bun.$(cmd).cwd(dir).quiet().text();
			await git`git init -q -b main`;
			await fsp.writeFile(path.join(dir, "a.txt"), "x");
			await git`git add .`;
			await git`git -c user.email=t@t -c user.name=t commit -qm init`;
			await git`git checkout -q --detach`;
			const state = await formatAdvisorGitState(dir);
			expect(state).toContain("(detached)");
			expect(state).not.toContain("branch=");
		} finally {
			await fsp.rm(dir, { recursive: true, force: true });
		}
	});
});