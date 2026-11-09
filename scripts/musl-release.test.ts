import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");

async function run(command: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(command, {
		cwd: repoRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

describe("musl release artifacts", () => {
	test("builds the requested x64 and arm64 musl asset names with Bun's musl targets", async () => {
		const result = await run([
			"bun",
			"scripts/ci-release-build-binaries.ts",
			"--dry-run",
			"--targets",
			"linux-musl-x64,linux-musl-arm64",
		]);

		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stdout).toContain(
			"Bun.build target=bun-linux-x64-musl-baseline outfile=packages/coding-agent/binaries/tau-linux-musl-x64",
		);
		expect(result.stdout).toContain(
			"Bun.build target=bun-linux-arm64-musl outfile=packages/coding-agent/binaries/tau-linux-musl-arm64",
		);
	});

<<<<<<< ours — scope `test("selects the musl asset when the Linux h...` in test_suite `musl release artifacts`, deleted in theirs (S+F, confidence: low)
// refused_by: statement_fold · collision: none (no common ancestor text)
	test("selects the musl asset when the Linux host reports musl", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tau-musl-install-"));
		tempDirs.push(dir);
		const binDir = path.join(dir, "bin");
		const installDir = path.join(dir, "install");
		await fs.mkdir(binDir);
		await writeExecutable(binDir, "uname", '#!/bin/sh\n[ "$1" = "-s" ] && echo Linux || echo x86_64\n');
		await writeExecutable(binDir, "ldd", "#!/bin/sh\necho 'musl libc (x86_64)'\n");
		await writeExecutable(
			binDir,
			"curl",
			`#!/bin/sh
case "$*" in
  *api.github.com*) echo '{"tag_name":"v1.0.0","mentions_count":0}' ;;
  *) while [ "$#" -gt 0 ]; do
       [ "$1" = "-o" ] && { printf '%s\n' '#!/bin/sh' 'echo "tau v1.0.0"' > "$2"; exit 0; }
       shift
     done ;;
esac
`,
		);

		const result = await run(["sh", "scripts/install.sh", "--binary"], {
			...process.env,
			PATH: `${binDir}:${process.env.PATH ?? ""}`,
			HOME: dir,
			PI_INSTALL_DIR: installDir,
		});

		expect(result.exitCode, result.stderr).toBe(0);
		expect(result.stdout).toContain("Using version: v1.0.0");
		expect(result.stdout).toContain("Downloading tau-linux-musl-x64...");
		expect(await Bun.file(path.join(installDir, "tau")).text()).toBe('#!/bin/sh\necho "tau v1.0.0"\n');
	});
=======
>>>>>>> theirs — scope `test("selects the musl asset when the Linux h...` deleted in theirs · weave: run 'weave explain scripts/musl-release.test.ts' for per-hunk detail, 'weave check' to verify your resolution
});
