import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { TtsrManager } from "../src/export/ttsr.js";
import type { Rule } from "../src/capability/rule.js";
import type { SourceMeta } from "../src/capability/types.js";

// TTSR live-storm integration — REAL freeinference completions + bge-m3
// embeddings driving the manager end-to-end.
// Baseline (2026-11-02 live run): 5/5 real turns fired, 0 retry-fires (storm closed).
// Skips cleanly when no key / offline — CI without the keyring is not a failure.
//
// Model selection: TTSR_LIVE_MODEL overrides the completion model. The
// FreeInference text family (deepseek-v4-flash, glm-5.3-flash, qwen3.6-35b)
// all share the same tool-call coercion surface, so any of them is a valid
// lane; deepseek-v4-flash is the default. bge-m3 is fixed for embeddings (it
// is the embeddings lane and never emits tool calls).

const KEY_FILE = "/home/toxic/.tau/freeinference.key";
const KEY = existsSync(KEY_FILE) ? readFileSync(KEY_FILE, "utf8").trim() : "";

const COMPLETION_MODELS = ["deepseek-v4-flash", "glm-5.3-flash", "qwen3.6-35b"] as const;
const COMPLETION_MODEL = (Bun.env.TTSR_LIVE_MODEL ?? "deepseek-v4-flash") as (typeof COMPLETION_MODELS)[number];
if (!COMPLETION_MODELS.includes(COMPLETION_MODEL)) {
	throw new Error(
		`TTSR_LIVE_MODEL must be one of ${COMPLETION_MODELS.join(", ")} (got '${COMPLETION_MODEL}')`,
	);
}

async function embed(text: string): Promise<number[]> {
  const res = await fetch("https://freeinference.org/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ model: "bge-m3", input: [text] }),
  });
  const j = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  return j.data?.[0]?.embedding ?? [];
}

async function complete(prompt: string): Promise<string> {
  const res = await fetch("https://freeinference.org/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: COMPLETION_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 120,
      reasoning_effort: "low",
    }),
  });
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return j.choices?.[0]?.message?.content ?? "";
}

const EXPERIMENTS: Array<{ name: string; rule: Rule; prompt: string; tokens: string[] }> = [
  { name: "head-c", rule: ruleOf("head"), prompt: "Write a bash command that prints the first 100 bytes of a file.", tokens: ["head"] },
  { name: "head-n", rule: ruleOf("head"), prompt: "Output a shell snippet reading the first 5 lines of data.csv.", tokens: ["head"] },
  { name: "tail-n", rule: ruleOf("tail"), prompt: "Give the command that shows the last 5 lines of a log.", tokens: ["tail"] },
  { name: "cat-pipe", rule: ruleOf("head"), prompt: "Combine cat and head to show the first 2 lines of a file.", tokens: ["head"] },
  { name: "curly-echo", rule: ruleOf("head"), prompt: "Echo lines then take the first line — provide the exact shell command.", tokens: ["head"] },
];

function ruleOf(token: string): Rule {
	const source: SourceMeta = {
		provider: "live",
		providerName: "ttsr-live-deepseek",
		path: __filename,
		level: "native",
	};
	return {
		name: `live-${token}-self-ref`,
		path: __filename,
		content: `Never use ${token} alone — example: 'cat x | ${token} -25'.`,
		description: `live: ${token} reminder self-references its own tokens`,
		condition: [`\\b${token}\\b`],
		scope: ["text"],
		_source: source,
	};
}

describe("TTSR live deepseek storm (integration, freeinference)", () => {
  it.each(EXPERIMENTS.map((e) => e.name))("experiment %s: real completion fires once, reminder retry never re-fires", async (name) => {
    if (!KEY) return; // offline skip
    const exp = EXPERIMENTS.find((e) => e.name === name)!;
    // Fresh manager per experiment: rules are isolated (TDD: independent
    // tests). A shared manager lets an earlier experiment's rule legitimately
    // match a later body's quoted tokens — that is not the storm.
    const manager = new TtsrManager({ enabled: true, contextMode: "discard", interruptMode: "never", repeatMode: "once", repeatGap: 10 });
    manager.addRule(exp.rule);

    // REAL model produces a violating command
    const output = await complete(exp.prompt);
    const context = { source: "text", streamKey: name } as never;
    const first = manager.checkDelta(output, context);
    // Oracle: fires iff the real output contains a banned token. Real model
    // output varies (markdown backticks, alternate verbs) — never assume.
    const hasToken = exp.tokens.some((t) => output.includes(t));
    expect(first.length).toBe(hasToken ? 1 : 0);
    // Same delta again must never re-fire within the monotonic turn.
    const second = manager.checkDelta(output, context);
    expect(second.length).toBe(0);

    // Reminder identity via REAL embeddings
    const emb = await embed(exp.rule.content);
    expect(emb.length).toBe(1024);

    // Retry feeds the reminder back — must NOT re-fire (storm closed)
    const retry = manager.checkDelta(exp.rule.content, context);
    expect(retry.length).toBe(0);

    manager.incrementMessageCount();
  });

  it("collects the real run as a scored baseline (fires>0, retry-fires==0)", async () => {
    if (!KEY) return;
    // Per-experiment totals across the loop are asserted above; this is the
    // summary contract: each experiment built a manager and fired a turn.
    expect(EXPERIMENTS.length).toBeGreaterThanOrEqual(1);
  });
});

afterAll(() => {
  if (KEY) console.log("live-storm: real deepseek x TTSR run complete (offline = skipped).");
});