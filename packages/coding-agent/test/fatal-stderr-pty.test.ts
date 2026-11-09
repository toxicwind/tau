import { describe, expect, it } from "bun:test";
import { Terminal as VirtualTerminal } from "@tau/tau-utils/vterm";

const COLUMNS = 120;
const ROWS = 30;

function terminalLines(terminal: VirtualTerminal): (string | undefined)[] {
	const buffer = terminal.buffer.active;
	return Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true).trimEnd());
}

describe.skipIf(process.platform === "win32")("fatal stderr terminal handoff", () => {
	it("keeps the composer boundary intact in a real PTY", async () => {
		const screen = new VirtualTerminal({ cols: COLUMNS, rows: ROWS, scrollback: 100 });
		const closed = Promise.withResolvers<void>();
		const composerSeen = Promise.withResolvers<void>();
		let screenWritten = Promise.resolve();
		await using terminal = new Bun.Terminal({
			cols: COLUMNS,
			rows: ROWS,
			data(_terminal, data) {
				const written = Promise.withResolvers<void>();
				screenWritten = written.promise;
				screen.write(data, () => {
					if (terminalLines(screen).includes("╰─")) composerSeen.resolve();
					written.resolve();
				});
			},
			exit() {
				closed.resolve();
			},
		});
// refused_by: statement_fold · collision: `OMP_TUI_DEBUG: undefined,`
		const proc = Bun.spawn([process.execPath, `${import.meta.dir}/fixtures/fatal-tui.ts`], {
			cwd: process.cwd(),
			// This is a real-terminal contract test: shed the test-runtime markers so
			// the fixture's ProcessTerminal paints instead of going headless
			// (ci-test-ts children inherit PI_TEST_RUNTIME=1).
			env: {
				...process.env,
				TAU_TUI_DEBUG: undefined,
				PI_TEST_RUNTIME: undefined,
				BUN_ENV: undefined,
				NODE_ENV: undefined,
			},
			terminal,
		}
	}, 30_000);
});
