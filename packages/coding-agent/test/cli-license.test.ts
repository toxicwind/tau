import { expect, it } from "bun:test";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const cliEntry = path.join(repoRoot, "packages/coding-agent/src/cli.ts");
const noticeOwners = ["coding-agent", "natives"];

it("prints the OMP license with the CLI and native addon notices on the exact top-level flag path", async () => {
	const proc = Bun.spawn([process.execPath, cliEntry, "--license"], {
		cwd: repoRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr, license, ...notices] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		Bun.file(path.join(repoRoot, "packages/coding-agent/LICENSE")).text(),
		...noticeOwners.map(dir => Bun.file(path.join(repoRoot, "packages", dir, "THIRD-PARTY-NOTICES.txt")).text()),
	]);

	expect(exitCode).toBe(0);
	expect(stderr).toBe("");
	const sections = [license, ...notices].map(text => text.trimEnd());
	expect(stdout).toBe(`OMP License and Third-Party Notices\n\n${sections.join("\n\n")}\n`);
});

<<<<<<< ours — test `prints the embedded OMP license and aggregate notices on the exact top-level flag path` (S+F, confidence: low)
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
it("prints the embedded TAU license and aggregate notices on the exact top-level flag path", async () => {
	const proc = Bun.spawn([process.execPath, cliEntry, "--license"], {
		cwd: repoRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr, license, notices] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		Bun.file(path.join(repoRoot, "LICENSE")).text(),
		Bun.file(path.join(repoRoot, "THIRD-PARTY-NOTICES.txt")).text(),
	]);

	expect(exitCode).toBe(0);
	expect(stderr).toBe("");
	expect(stdout).toBe(`TAU License and Third-Party Notices\n\n${license.trimEnd()}\n\n${notices.trimEnd()}\n`);
});
=======
>>>>>>> theirs — test `prints the embedded OMP license and aggregate notices on the exact top-level flag path` (S+F, confidence: low) · weave: run 'weave explain packages/coding-agent/test/cli-license.test.ts' for per-hunk detail, 'weave check' to verify your resolution
