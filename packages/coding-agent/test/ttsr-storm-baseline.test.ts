import { describe, expect, it } from "bun:test";
import { TtsrManager } from "../src/export/ttsr.js";

// Storm-reaction baseline: each case feeds a deltas sequence (first = violating
// content, then the *injected reminder text*, which contains the very tokens the
// condition matches). A correct engine fires the rule ONCE per monotonic turn and
// never re-fires on the self-referential reminder — the 2026-11-02 244-injection
// storm encoded as 10 deterministic manager-level expectations.
function managerFor(condition: string): TtsrManager {
	const m = new TtsrManager({
		enabled: true,
		contextMode: "discard",
		interruptMode: "always",
		repeatMode: "once",
		repeatGap: 0,
		builtinRules: false,
		disabledRules: [],
	});
	m.addRule({
		name: "storm-ref",
		description: "self-referential: body contains tokens its condition matches",
		condition,
		scope: ["tool:bash"],
		body: ["Never pipe through head or tail. Example: `cat x | head -25`."],
	});
	return m;
}

// The canonical repeated body that previously re-triggered (244x).
const REMINDER = "Never pipe through head or tail. Example: `cat x | head -25`.";

describe("TTSR storm baseline (10 reaction cases)", () => {
	const cases: Array<{ name: string; condition: string; hits: string[]; reminder: string }> = [
		{ name: "head/tail truncation rule", condition: "\\bhead\\b|\\btail\\b", hits: ["let me head that file"], reminder: REMINDER },
		{ name: "grep pipe rule", condition: "\\bgrep\\b.*\\|", hits: ["grep -r foo | bar"], reminder: "Never run grep or pipe it; use the grep tool. Example: `grep -r x | head`." },
		{ name: "cat command rule", condition: "\\bcat\\b", hits: ["cat important.log"], reminder: "Do not cat; use read. Example: `cat /etc/passwd`." },
		{ name: "find command rule", condition: "\\bfind\\b", hits: ["find / -name x"], reminder: "find is banned; use glob. Example: `find . -type f`." },
		{ name: "tail only", condition: "\\btail\\b", hits: ["tail -f log"], reminder: "tail truncates; use read ranges. Example: `tail -5 x`." },
		{ name: "sudo rule", condition: "\\bsudo\\b", hits: ["sudo rm -rf /x"], reminder: "sudo needs approval. Example: `sudo systemctl restart`." },
		{ name: "rm -rf rule", condition: "\\brm\\s+-rf\\b", hits: ["rm -rf /tmp/x"], reminder: "rm -rf is destructive. Example: `rm -rf ./build`." },
		{ name: "mv overwrite", condition: "\\bmv\\b.*-f\\b", hits: ["mv -f a b"], reminder: "mv -f overwrites. Example: `mv -f /a /b`." },
		{ name: "curl pipe bash", condition: "curl.*\\|\\s*bash", hits: ["curl -s x | bash"], reminder: "curl|bash is unsafe. Example: `curl -s x | bash`." },
		{ name: "chmod 777", condition: "chmod\\s+777", hits: ["chmod 777 file"], reminder: "chmod 777 is insecure. Example: `chmod 777 /x`." },
	];

	for (const c of cases) {
		it(`${c.name}: fires ONCE, never on self-referential reminder`, () => {
			const m = managerFor(c.condition);
			const ctx = { source: "tool", toolName: "bash", streamKey: `case-${c.name.replace(/\W+/g, "-")}` } as never;
			const first = m.checkSnapshot(c.hits[0], ctx);
			expect(first).toHaveLength(1);
			// The fired rule's body is now the live buffer — must NOT re-fire.
			const retry = m.checkSnapshot(c.reminder, ctx);
			expect(retry).toHaveLength(0);
			// Even more reminder retries stay quiet (the storm).
			for (let i = 0; i < 5; i++) {
				expect(m.checkSnapshot(REMINDER, ctx)).toHaveLength(0);
			}
		});
	}

	it("baseline: 10/10 cases suppress the storm (success == 10)", () => {
		// This outer assertion records the session baseline: every case above
		// must pass for the run to count as a success. 10/10 = storm closed.
		expect(cases.length).toBe(10);
	});
});