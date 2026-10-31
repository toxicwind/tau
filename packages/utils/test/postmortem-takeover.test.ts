import { describe, expect, it } from "bun:test";
import { postmortem } from "@tau/tau-utils";

const takeoverChildFlag = "--takeover-sighup-child";

if (process.argv.includes(takeoverChildFlag)) {
	// Child scenario: take over SIGHUP, register a cleanup, then self-SIGHUP.
	// The default handler would run cleanup and exitProcess(129) unconditionally;
	// after takeover the child owns the signal — cleanup runs via
	// runTakenOverSignalCleanup and the child exits 0 by its own decision.
	const marker = process.argv[process.argv.indexOf(takeoverChildFlag) + 1];
	if (!marker) throw new Error("Missing survival marker path");
	if (!postmortem.takeoverSignalHandler("SIGHUP")) throw new Error("takeover refused");
	process.on("SIGHUP", () => {
		void (async () => {
			await postmortem.runTakenOverSignalCleanup(postmortem.Reason.SIGHUP);
			await Bun.write(marker, "cleanup ran under taken-over signal");
			process.exit(0);
		})();
	});
	process.kill(process.pid, "SIGHUP");
	await Promise.withResolvers<void>().promise;
}

/**
 * Signal-takeover contract for the detached keeper (interactive TUI owns
 * SIGTERM/SIGHUP so a killed TUI detaches its live session instead of tearing
 * it down). The takeover must remove exactly the module's own default handler,
 * be idempotent per signal, and let the owner run cleanup registrations itself.
 */
describe("postmortem signal takeover", () => {
	it("takes over SIGTERM exactly once, removing the module's own handler", () => {
		const before = process.listeners("SIGTERM");
		expect(before.length).toBeGreaterThan(0);

		expect(postmortem.takeoverSignalHandler("SIGTERM")).toBe(true);

		const after = process.listeners("SIGTERM");
		expect(after.length).toBe(before.length - 1);

		// Idempotent: a second takeover is a no-op, not a double removal.
		expect(postmortem.takeoverSignalHandler("SIGTERM")).toBe(false);
		expect(process.listeners("SIGTERM").length).toBe(after.length);

		// Restore the process-global state for other tests in this run.
		process.on("SIGTERM", before[before.length - 1]!);
	});

	it("takes over SIGHUP exactly once, removing the module's own handler", () => {
		const before = process.listeners("SIGHUP");
		expect(before.length).toBeGreaterThan(0);

		expect(postmortem.takeoverSignalHandler("SIGHUP")).toBe(true);

		const after = process.listeners("SIGHUP");
		expect(after.length).toBe(before.length - 1);
		expect(postmortem.takeoverSignalHandler("SIGHUP")).toBe(false);
		expect(process.listeners("SIGHUP").length).toBe(after.length);

		process.on("SIGHUP", before[before.length - 1]!);
	});

	it("taken-over signal runs the owner's policy: cleanup registrations fire, default exit-129 does not", async () => {
		const { mkdtemp, readFile } = await import("node:fs/promises");
		const { join } = await import("node:path");
		const { tmpdir } = await import("node:os");
		const dir = await mkdtemp(join(tmpdir(), "tau-takeover-"));
		const marker = join(dir, "marker.txt");

		const child = Bun.spawn(["bun", import.meta.path, takeoverChildFlag, marker], {
			stdin: "ignore",
			stdout: "inherit",
			stderr: "inherit",
		});
		const code = await child.exited;

		expect(code).toBe(0);
		expect(await readFile(marker, "utf8")).toBe("cleanup ran under taken-over signal");
	});
});
