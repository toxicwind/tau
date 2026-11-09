/**
 * Stats CLI command handlers.
 *
 * Handles `tau stats` subcommand for viewing AI usage statistics.
 */

<<<<<<< ours — interstitial `file_header` (S+F, confidence: low)
// refused_by: merge_ladder_exhausted · collision: `import { formatDuration, formatNumber, formatPercent } from "@o…` +1 more
import { truncateToWidth } from "@tau/tau-tui/utils";
import { formatDuration, formatNumber, formatPercent } from "@tau/tau-utils";
import chalk from "@tau/tau-utils/chalk";
import { formatCost } from "@tau/tau-tui/overlays/agent-hub-renderer";
=======
import { formatKeyHint } from "@oh-my-pi/pi-tui/key-hint-format";
import { truncateToWidth } from "@oh-my-pi/pi-tui/utils";
import { postmortem } from "@oh-my-pi/pi-utils";
import chalk from "@oh-my-pi/pi-utils/chalk";
import { openStandaloneJudge } from "../judgment/standalone";
import { openTernPage } from "../tools/browser/tern/user-page";
>>>>>>> theirs — interstitial `file_header` (S+F, confidence: low) · weave: run 'weave explain packages/coding-agent/src/cli/stats-cli.ts' for per-hunk detail, 'weave check' to verify your resolution
import { openPath } from "../utils/open";

/**
 * Single-line TTY progress bar. On a non-TTY stream we just stay quiet -
 * the final "Synced ..." summary still prints either way.
 */
function createSyncProgressReporter(): {
	onProgress: (event: { current: number; total: number; sessionFile: string }) => void;
	finish: () => void;
} {
	const stream = process.stderr;
	const isTty = stream.isTTY === true;
	let lastWidth = 0;
	let lastRender = 0;
	return {
		onProgress(event) {
			if (!isTty) return;
			const now = Date.now();
			// Throttle to ~30 fps and always force a render for the last file.
			if (event.current < event.total && now - lastRender < 33) return;
			lastRender = now;
			const label = chalk.dim(shortenSessionFile(event.sessionFile));
			const pct = ((event.current / event.total) * 100).toFixed(0).padStart(3, " ");
			const counter = chalk.cyan(`[${event.current}/${event.total}]`);
			const line = `${counter} ${pct}%  ${label}`;
			const columns = stream.columns ?? 120;
			const trimmed = truncateToWidth(line, columns - 1);
			stream.write(`\r${trimmed.padEnd(lastWidth)}`);
			lastWidth = trimmed.length;
		},
		finish() {
			if (!isTty || lastWidth === 0) return;
			stream.write(`\r${" ".repeat(lastWidth)}\r`);
			lastWidth = 0;
		},
	};
}

function shortenSessionFile(p: string): string {
	const marker = "/sessions/";
	const idx = p.indexOf(marker);
	return idx >= 0 ? p.slice(idx + marker.length) : p;
}

// =============================================================================
// Types
// =============================================================================

export interface StatsCommandArgs {
	port: number;
	host: string;
	json: boolean;
	summary: boolean;
}

// =============================================================================
// Command Handler
// =============================================================================

export async function runStatsCommand(cmd: StatsCommandArgs): Promise<void> {
	// Lazy import to avoid loading stats module when not needed
<<<<<<< ours — scope `// Lazy import to avoid loading stats module ...` in function `runStatsCommand` (S+F, confidence: low)
// refused_by: statement_fold · collision: `await import("@oh-my-pi/omp-stats");`
	const { closeDb, formatStatsDashboardUrl, getDashboardStats, getTotalMessageCount, startServer, syncAllSessions } =
		await import("@tau/tau-stats");
=======
	const {
		closeDb,
		formatStatsDashboardUrl,
		getDashboardStats,
		getTotalMessageCount,
		printStatsSummary,
		refreshRollups,
		setStatsCloseHandler,
		startServer,
		syncAllSessions,
	} = await import("@oh-my-pi/omp-stats");
>>>>>>> theirs — scope `// Lazy import to avoid loading stats module ...`

	// One-shot reports need fully ingested, fully rolled-up data before printing.
	if (cmd.json || cmd.summary) {
		const progress = createSyncProgressReporter();
		process.stderr.write("Syncing session files...\n");
		const { processed, files } = await syncAllSessions({ onProgress: progress.onProgress });
		progress.finish();
		await refreshRollups();
		const total = await getTotalMessageCount();
		process.stderr.write(`Synced ${processed} new entries from ${files} files (${total} total)\n\n`);
		if (cmd.json) {
			console.log(JSON.stringify(await getDashboardStats(), null, 2));
		} else {
			await printStatsSummary();
		}
		return;
	}

	// The dashboard starts immediately and ingests sessions in the background,
	// streaming progress to the page. The judge (settings, auth, registry)
	// resolves on the first Frustration estimate/run and lives until exit.
	// In a Tern pane the page takes this block's place until the user closes
	// it (its Close, Esc, Ctrl+C, or Tern's Close block), which stops the
	// dashboard; elsewhere the system browser shows it.
	const cwd = process.cwd();
	const { hostname, port, reused } = await startServer(cmd.port, cmd.host, {
		judge: async () => (await openStandaloneJudge(cwd, "stats_frustration")).judge,
	});
	const url = formatStatsDashboardUrl(hostname, port);
	console.log(chalk.green(`Dashboard available at: ${url}`));

	// Another process owns a reused dashboard: show it, never stop it.
	if (reused) {
		const page = await openTernPage(url, "over");
		if (!page) {
			openPath(url);
			return;
		}
		console.log("Showing it in place of this block: close it to return\n");
		await page.closed();
		return;
	}

	// Close is on before the page first loads, and off again for the system
	// browser, where closing would leave a dead tab.
	setStatsCloseHandler(() => void postmortem.quit(0));
	const page = await openTernPage(url, "over");
	if (page) {
		console.log("Showing it in place of this block: close it to stop\n");
	} else {
		setStatsCloseHandler(undefined);
		openPath(url);
		console.log(`Press ${formatKeyHint("ctrl+c")} to stop\n`);
	}

	// Ctrl+C and the other signals exit through omp's cleanup, which takes the
	// page away with the dashboard.
	postmortem.register("stats-dashboard", async () => {
		await page?.close();
		closeDb();
	});
	if (page) {
		await page.closed();
		await postmortem.quit(0);
	}

	// Keep the process alive
	await new Promise(() => {});
}
<<<<<<< ours — function `printStatsSummary` (S+F, confidence: low)
// refused_by: modify_delete_guard · collision: none (no common ancestor text)
async function printStatsSummary(): Promise<void> {
	const { getDashboardStats } = await import("@tau/tau-stats");
	const stats = await getDashboardStats();
	const { overall, byModel, byFolder } = stats;

	console.log(chalk.bold("\n=== AI Usage Statistics ===\n"));

	console.log(chalk.bold("Overall:"));
	console.log(`  Requests: ${formatNumber(overall.totalRequests)} (${formatNumber(overall.failedRequests)} errors)`);
	console.log(`  Error Rate: ${formatPercent(overall.errorRate)}`);
	console.log(`  Total Tokens: ${formatNumber(overall.totalInputTokens + overall.totalOutputTokens)}`);
	console.log(`  Input Tokens: ${formatNumber(overall.totalInputTokens)}`);
	console.log(`  Output Tokens: ${formatNumber(overall.totalOutputTokens)}`);
	console.log(`  Cache Rate: ${formatPercent(overall.cacheRate)}`);
	console.log(`  Cache Savings: ${formatPercent(overall.cacheSavings)}`);
	console.log(`  Total Cost: ${formatCost(overall.totalCost)}`);
	console.log(`  Premium Requests: ${formatNumber(normalizePremiumRequests(overall.totalPremiumRequests ?? 0))}`);
	console.log(`  Avg Duration: ${overall.avgDuration !== null ? formatDuration(overall.avgDuration) : "-"}`);
	console.log(`  Avg TTFT: ${overall.avgTtft !== null ? formatDuration(overall.avgTtft) : "-"}`);
	if (overall.avgTokensPerSecond !== null) {
		console.log(`  Avg Tokens/s: ${overall.avgTokensPerSecond.toFixed(1)}`);
	}

	if (byModel.length > 0) {
		console.log(chalk.bold("\nBy Model:"));
		for (const m of byModel.slice(0, 10)) {
			console.log(
				`  ${m.model}: ${formatNumber(m.totalRequests)} reqs, ${formatCost(m.totalCost)}, ${formatPercent(m.cacheRate)} cache rate, ${formatPercent(m.cacheSavings)} cache savings`,
			);
		}
	}

	if (byFolder.length > 0) {
		console.log(chalk.bold("\nBy Folder:"));
		for (const f of byFolder.slice(0, 10)) {
			console.log(`  ${f.folder}: ${formatNumber(f.totalRequests)} reqs, ${formatCost(f.totalCost)}`);
		}
	}

	console.log("");
}
=======
>>>>>>> theirs — function `printStatsSummary` (S+F, confidence: low)
