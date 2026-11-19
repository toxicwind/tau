import * as vcs from "@tau/tau-natives/vcs";

/**
 * Compact git-state digest for the advisor prompt: HEAD short id, working-copy
 * label (branch or detached marker), and the count of dirty paths
 * (staged + unstaged + untracked). "(not a git repo)" when cwd sits outside
 * any repository; "(git state unavailable)" when discovery works but a read
 * fails mid-flight.
 *
 * Purpose (2026-10-30 architect directive): the advisor must be main-aware —
 * it should know whether the tree it reviews is committed/clean or has
 * drifted, so it never claims "pushed to main" for uncommitted work and can
 * flag a dirty working tree as evidence against a done claim.
 */
export async function formatAdvisorGitState(cwd: string): Promise<string> {
	let repo: ReturnType<typeof vcs.repo>;
	try {
		repo = vcs.repo(cwd);
	} catch {
		return "(not a git repo)";
	}
	if (!repo?.root()) return "(not a git repo)";

	try {
		const [head, label, summary] = await Promise.all([
			repo.headId(),
			repo.label(),
			repo.statusSummary(),
		]);
		const short = head?.slice(0, 12);
		const name = typeof label === "string" && label.trim() ? label.trim() : "(detached)";
		const dirty = (summary?.staged ?? 0) + (summary?.unstaged ?? 0) + (summary?.untracked ?? 0);
		return name === "(detached)"
			? `HEAD=${short} ${name} dirty=${dirty}`
			: `HEAD=${short} branch=${name} dirty=${dirty}`;
	} catch {
		return "(git state unavailable)";
	}
}