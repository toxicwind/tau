// Complex TDD for tau todo tool — edge cases beyond the 73-test baseline.
// Targets: op inference ergonomics (the live "Missing phase name" confusion),
// markdown round-trip blockers, maxParallel demotion, worked-ahead pointer,
// phase-targeted ops, and fingerprint stability.
import { describe, expect, test } from "bun:test";
import {
	applyOpsToPhases,
	markdownToPhases,
	phasesToMarkdown,
	nextActionableTask,
} from "/home/toxic/pens/olympus/products/tau/packages/coding-agent/src/tools/todo.ts";

type Phase = { name: string; tasks: Array<{ content: string; status: string; blocker?: string }> };

function init(items: string[], phase = "Tasks"): Phase[] {
	return applyOpsToPhases([], [{ op: "init", list: [{ phase, items }] }]).phases;
}

describe("todo complex: op inference ergonomics", () => {
	test("bare items with existing phases errors with clear guidance", () => {
		const { phases, errors } = applyOpsToPhases(init(["a"]), [
			{ op: "append", items: ["b"] },
		] as never);
		expect(errors.some(e => e.includes("phase"))).toBe(true);
		expect(phases[0].tasks.map(t => t.content)).toEqual(["a"]);
	});
	test("items+phase on empty board lazily creates phase (append)", () => {
		const { phases, errors } = applyOpsToPhases([], [
			{ op: "append", phase: "New", items: ["x"] },
		] as never);
		expect(errors).toEqual([]);
		// normalizeInProgressTask auto-promotes the single pending task.
		expect(phases).toEqual([{ name: "New", tasks: [{ content: "x", status: "in_progress" }] }]);
	});
	test("append to nonexistent phase creates it", () => {
		const { phases, errors } = applyOpsToPhases(init(["a"]), [
			{ op: "append", phase: "Later", items: ["b"] },
		] as never);
		expect(errors).toEqual([]);
		expect(phases.map(p => p.name)).toEqual(["Tasks", "Later"]);
	});
});

describe("todo complex: phase-targeted ops", () => {
	test("done by phase completes all tasks in it", () => {
		const phases = applyOpsToPhases(init(["a", "b", "c"]), [{ op: "done", phase: "Tasks" }] as never);
		expect(phases.phases[0].tasks.every(t => t.status === "completed")).toBe(true);
	});
	test("rm by phase empties only that phase", () => {
		let r = applyOpsToPhases(init(["a"]), [{ op: "append", phase: "P2", items: ["b"] }] as never);
		r = applyOpsToPhases(r.phases, [{ op: "rm", phase: "Tasks" }] as never);
		expect(r.phases[0].tasks).toEqual([]);
		expect(r.phases[1].tasks.map(t => t.content)).toEqual(["b"]);
	});
	test("block by phase blocks only open tasks", () => {
		let r = applyOpsToPhases(init(["a", "b"]), [{ op: "done", task: "a" }] as never);
		r = applyOpsToPhases(r.phases, [{ op: "block", phase: "Tasks", reason: "wait" }] as never);
		expect(r.phases[0].tasks[0].status).toBe("completed");
		expect(r.phases[0].tasks[1].status).toBe("blocked");
	});
});

describe("todo complex: blocker semantics", () => {
	test("block task with reason then refine reason", () => {
		let r = applyOpsToPhases(init(["a"]), [{ op: "block", task: "a" }] as never);
		expect(r.phases[0].tasks[0].blocker).toBeUndefined();
		r = applyOpsToPhases(r.phases, [{ op: "block", task: "a", reason: "needs key" }] as never);
		expect(r.phases[0].tasks[0].blocker).toBe("needs key");
	});
	test("unblock clears blocker; normalize auto-promotes to in_progress", () => {
		let r = applyOpsToPhases(init(["a"]), [{ op: "block", task: "a", reason: "x" }] as never);
		r = applyOpsToPhases(r.phases, [{ op: "unblock", task: "a" }] as never);
		const t = r.phases[0].tasks[0];
		expect(t.content).toBe("a");
		expect(t.status).toBe("in_progress");
		expect(t.blocker).toBeUndefined();
	});
	test("blocker note with newline is collapsed one-line-safe", () => {
		const r = applyOpsToPhases(init(["a"]), [
			{ op: "block", task: "a", reason: "line1\nline2\ttab" },
		] as never);
		expect(r.phases[0].tasks[0].blocker).toBe("line1 line2 tab");
	});
});

describe("todo complex: maxParallel demotion", () => {
	test("start makes target the single in_progress; earlier demoted", () => {
		let r = applyOpsToPhases(init(["a", "b", "c"]), [{ op: "start", task: "a" }] as never);
		expect(r.phases[0].tasks.find(t => t.content === "a").status).toBe("in_progress");
		r = applyOpsToPhases(r.phases, [{ op: "start", task: "b" }] as never);
		expect(r.phases[0].tasks.find(t => t.content === "b").status).toBe("in_progress");
		expect(r.phases[0].tasks.find(t => t.content === "a").status).toBe("pending");
	});
	test("maxParallel ceiling demotes excess beyond N in_progress", () => {
		// Hand-build two in_progress then raise ceiling via applyOpsToPhases with maxParallel on an op
		const phases: Phase[] = [
			{ name: "T", tasks: [
				{ content: "a", status: "in_progress" },
				{ content: "b", status: "in_progress" },
				{ content: "c", status: "pending" },
			] },
		];
		// op with maxParallel=1 (default) demotes b (second in_progress)
		const r = applyOpsToPhases(phases, [{ op: "view" }] as never);
		expect(r.phases[0].tasks.find(t => t.content === "a").status).toBe("in_progress");
		expect(r.phases[0].tasks.find(t => t.content === "b").status).toBe("pending");
	});
	test("zero in_progress auto-promotes first pending", () => {
		const r = applyOpsToPhases(init(["a", "b"]), [{ op: "done", task: "a" }] as never);
		// after completing a, nothing was in_progress; normalize promotes b
		expect(r.phases[0].tasks.find(t => t.content === "b").status).toBe("in_progress");
	});
});

describe("todo complex: markdown round-trip", () => {
	test("all five statuses round-trip", () => {
		let r = applyOpsToPhases(init(["a", "b", "c", "d", "e"]), [{ op: "start", task: "b" }] as never);
		r = applyOpsToPhases(r.phases, [
			{ op: "done", task: "a" },
			{ op: "drop", task: "c" },
			{ op: "block", task: "d", reason: "why" },
		] as never);
		const md = phasesToMarkdown(r.phases);
		const back = markdownToPhases(md);
		expect(back.errors).toEqual([]);
		const byContent = Object.fromEntries(back.phases[0].tasks.map(t => [t.content, t]));
		expect(byContent.a.status).toBe("completed");
		expect(byContent.b.status).toBe("in_progress");
		expect(byContent.c.status).toBe("abandoned");
		expect(byContent.d.status).toBe("blocked");
		expect(byContent.d.blocker).toBe("why");
		expect(byContent.e.status).toBe("pending");
	});
	test("escaped brackets round-trip", () => {
		const back = markdownToPhases("# P\n- \\[x\\] escaped task");
		expect(back.errors).toEqual([]);
		expect(back.phases[0].tasks[0]).toEqual({ content: "escaped task", status: "completed" });
	});
	test("task containing 'blocker:' text is not confused with note", () => {
		const md = "# P\n- [!] real task <!-- blocker: the note -->";
		const back = markdownToPhases(md);
		expect(back.phases[0].tasks[0]).toEqual({ content: "real task", status: "blocked", blocker: "the note" });
	});
	test("empty markdown yields empty board not error", () => {
		const back = markdownToPhases("# P\n");
		expect(back.errors).toEqual([]);
		expect(back.phases[0].tasks).toEqual([]);
	});
});

describe("todo complex: worked-ahead pointer", () => {
	test("nextActionableTask prefers in_progress over first pending across phases", () => {
		let r = applyOpsToPhases([], [
			{ op: "init", list: [{ phase: "P1", items: ["a"] }, { phase: "P2", items: ["b"] }] },
		] as never);
		r = applyOpsToPhases(r.phases, [{ op: "start", task: "b" }] as never);
		// b in P2 is in_progress; a in P1 pending — pointer should return b
		expect(nextActionableTask(r.phases).content).toBe("b");
	});
	test("completing later phase keeps earliest open phase active", () => {
		let r = applyOpsToPhases([], [
			{ op: "init", list: [{ phase: "P1", items: ["a"] }, { phase: "P2", items: ["b", "c"] }] },
		] as never);
		r = applyOpsToPhases(r.phases, [
			{ op: "start", task: "b" },
			{ op: "done", task: "b" },
			{ op: "done", task: "c" },
		] as never);
		// P2 all done; P1 still has pending a — active phase should be P1
		expect(nextActionableTask(r.phases).content).toBe("a");
	});
});

describe("todo complex: dedupe and batch atomicity", () => {
	test("append duplicate across phases is fully rejected (atomic)", () => {
		let r = applyOpsToPhases(init(["a"]), [{ op: "append", phase: "Tasks", items: ["a", "b"] }] as never);
		expect(r.errors.some(e => e.includes("already exists"))).toBe(true);
		expect(r.phases[0].tasks.map(t => t.content)).toEqual(["a"]);
	});
	test("init duplicate phases rejected", () => {
		const r = applyOpsToPhases([], [
			{ op: "init", list: [{ phase: "P", items: ["a"] }, { phase: "P", items: ["b"] }] },
		] as never);
		expect(r.errors.some(e => e.includes("Duplicate phase"))).toBe(true);
	});
	test("init duplicate tasks rejected", () => {
		const r = applyOpsToPhases([], [
			{ op: "init", list: [{ phase: "P", items: ["a", "a"] }] },
		] as never);
		expect(r.errors.some(e => e.includes("Duplicate task"))).toBe(true);
	});
});
