/**
 * packages/ai/test/weave.live.ts — FreeInference Concurrency Weave Investigation
 *
 * GOAL: Test if and how we can achieve 2+ concurrent requests on freeinference.
 *
 * Hypotheses tested:
 *   1. Cross-model concurrency: deepseek-v4-flash + qwen3.6-35b running simultaneously.
 *   2. Context-size gated admission: small context (< qwen max context) admitted while another runs.
 *   3. Session / Radix header weaving: X-Session-ID, X-Reasoning-Passthrough.
 *   4. Decode-phase interleaving (weave): fire request 2 while request 1 is actively streaming tokens.
 *   5. Transport multiplexing: HTTP/2 single connection vs multi-connection.
 *   6. Stream vs non-stream combinations.
 *
 * Run: bun packages/ai/test/weave.live.ts [--matrix]
 */

const KEY_PATH = "/home/toxic/.tau/freeinference.key";
const BASE_URL = "https://freeinference.org/v1/chat/completions";

async function loadKey(): Promise<string> {
  const f = Bun.file(KEY_PATH);
  if (!(await f.exists())) throw new Error(`Missing key at ${KEY_PATH}`);
  return (await f.text()).trim();
}

interface ProbeResult {
  tag: string;
  model: string;
  status: number;
  startMs: number;
  firstTokenMs?: number;
  totalMs: number;
  tokensReceived: number;
  error?: string;
  headers?: Record<string, string>;
}

/**
 * Fires a chat completion request with streaming or non-streaming,
 * measuring exact TTFT (first token) and total duration while reporting
 * live stream progress.
 */
async function streamProbe(opts: {
  tag: string;
  model: string;
  prompt: string;
  maxTokens: number;
  stream: boolean;
  extraHeaders?: Record<string, string>;
  key: string;
  onFirstToken?: () => void;
}): Promise<ProbeResult> {
  const t0 = performance.now();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${opts.key}`,
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    ...opts.extraHeaders,
  };

  const body = JSON.stringify({
    model: opts.model,
    messages: [{ role: "user", content: opts.prompt }],
    max_tokens: opts.maxTokens,
    stream: opts.stream,
  });

  try {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(30000),
    });

    const elapsed = Math.round(performance.now() - t0);
    const respHeaders: Record<string, string> = {};
    for (const [k, v] of res.headers.entries()) {
      if (k.startsWith("cf-") || k.startsWith("x-") || k === "retry-after" || k === "server-timing") {
        respHeaders[k] = v;
      }
    }

    if (!res.ok) {
      const errText = await res.text();
      return {
        tag: opts.tag,
        model: opts.model,
        status: res.status,
        startMs: 0,
        totalMs: elapsed,
        tokensReceived: 0,
        error: errText.slice(0, 160),
        headers: respHeaders,
      };
    }

    if (!opts.stream) {
      const json = await res.json();
      return {
        tag: opts.tag,
        model: opts.model,
        status: 200,
        startMs: 0,
        totalMs: elapsed,
        tokensReceived: 1,
        headers: respHeaders,
      };
    }

    // Stream reader
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No body reader");

    const decoder = new TextDecoder();
    let firstTokenMs: number | undefined;
    let tokens = 0;
    let notified = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text.includes("data:")) {
        tokens++;
        if (!firstTokenMs) {
          firstTokenMs = Math.round(performance.now() - t0);
          if (!notified && opts.onFirstToken) {
            notified = true;
            opts.onFirstToken();
          }
        }
      }
    }

    return {
      tag: opts.tag,
      model: opts.model,
      status: 200,
      startMs: 0,
      firstTokenMs,
      totalMs: Math.round(performance.now() - t0),
      tokensReceived: tokens,
      headers: respHeaders,
    };
  } catch (err: unknown) {
    return {
      tag: opts.tag,
      model: opts.model,
      status: -1,
      startMs: 0,
      totalMs: Math.round(performance.now() - t0),
      tokensReceived: 0,
      error: String(err),
    };
  }
}

/**
 * Runs a 2-request concurrency test:
 * Request 1 (anchor) starts and streams tokens.
 * Once Request 1 is actively streaming (decode phase) or after offsetMs, Request 2 fires.
 * If BOTH return 200, we have verified 2 concurrent requests!
 */
async function testConcurrencyPair(name: string, plan: {
  r1: { model: string; prompt: string; maxTokens: number; stream?: boolean; headers?: Record<string, string> };
  r2: { model: string; prompt: string; maxTokens: number; stream?: boolean; headers?: Record<string, string> };
  delayMs?: number; // Delay before firing r2, or fire on r1 first token
  fireOnFirstToken?: boolean;
  key: string;
}): Promise<{ name: string; success: boolean; r1: ProbeResult; r2: ProbeResult }> {
  console.log(`\n--- [TEST] ${name} ---`);
  let triggerR2: () => void = () => {};
  const r2Signal = new Promise<void>((resolve) => { triggerR2 = resolve; });

  const r1Promise = streamProbe({
    tag: "R1-anchor",
    model: plan.r1.model,
    prompt: plan.r1.prompt,
    maxTokens: plan.r1.maxTokens,
    stream: plan.r1.stream ?? true,
    extraHeaders: plan.r1.headers,
    key: plan.key,
    onFirstToken: plan.fireOnFirstToken ? () => triggerR2() : undefined,
  });

  if (plan.delayMs && !plan.fireOnFirstToken) {
    setTimeout(triggerR2, plan.delayMs);
  } else if (!plan.fireOnFirstToken) {
    triggerR2(); // Fire simultaneously
  }

  await r2Signal;
  console.log(`  -> Firing R2 (${plan.r2.model}) while R1 is in-flight...`);

  const r2Promise = streamProbe({
    tag: "R2-woven",
    model: plan.r2.model,
    prompt: plan.r2.prompt,
    maxTokens: plan.r2.maxTokens,
    stream: plan.r2.stream ?? true,
    extraHeaders: plan.r2.headers,
    key: plan.key,
  });

  const [r1, r2] = await Promise.all([r1Promise, r2Promise]);

  const bothOk = r1.status === 200 && r2.status === 200;
  console.log(`  Result: ${bothOk ? "✅ 2 CONCURRENT ACHIEVED!" : "❌ Rejected / 429"}`);
  console.log(`    R1 (${r1.model}): status=${r1.status} TTFT=${r1.firstTokenMs ?? "-"}ms total=${r1.totalMs}ms tokens=${r1.tokensReceived} ${r1.error ? `err=${r1.error}` : ""}`);
  console.log(`    R2 (${r2.model}): status=${r2.status} TTFT=${r2.firstTokenMs ?? "-"}ms total=${r2.totalMs}ms tokens=${r2.tokensReceived} ${r2.error ? `err=${r2.error}` : ""}`);

  return { name, success: bothOk, r1, r2 };
}

async function main() {
  console.log("=================================================================");
  console.log("  FREEINFERENCE CONCURRENCY WEAVE PROBE");
  console.log("  Hypothesis: Under specific context / model / session conditions,");
  console.log("  two concurrent requests CAN be admitted.");
  console.log("=================================================================\n");

  const key = await loadKey();

  // Ensure slot is clear first
  console.log("Baseline check: single ping...");
  const base = await streamProbe({
    tag: "baseline",
    model: "deepseek-v4-flash",
    prompt: "say ok",
    maxTokens: 5,
    stream: false,
    key,
  });
  console.log(`Baseline status: ${base.status} (${base.totalMs}ms) ${base.error ?? "OK"}\n`);

  if (base.status !== 200) {
    console.error("Baseline failed — freeinference slot is currently saturated. Waiting 3s...");
    await Bun.sleep(3000);
  }

  const results: Array<{ name: string; success: boolean; r1: ProbeResult; r2: ProbeResult }> = [];

  // TEST 1: Identical model concurrent (Baseline negative control)
  results.push(await testConcurrencyPair("Control: deepseek + deepseek simultaneous", {
    key,
    r1: { model: "deepseek-v4-flash", prompt: "Count 1 to 30 with words: one, two, three...", maxTokens: 80 },
    r2: { model: "deepseek-v4-flash", prompt: "say hello", maxTokens: 10 },
    fireOnFirstToken: true,
  }));
  await Bun.sleep(1500);

  // TEST 2: Cross-Model: DeepSeek anchor + Qwen tiny context (< Qwen max context)
  results.push(await testConcurrencyPair("Cross-Model: DeepSeek anchor (generating) + Qwen tiny context", {
    key,
    r1: { model: "deepseek-v4-flash", prompt: "Write a 50-word poem about mathematics.", maxTokens: 80 },
    r2: { model: "qwen3.6-35b", prompt: "ping", maxTokens: 5 },
    fireOnFirstToken: true,
  }));
  await Bun.sleep(1500);

  // TEST 3: Reverse Cross-Model: Qwen anchor (generating) + DeepSeek tiny context
  results.push(await testConcurrencyPair("Cross-Model: Qwen anchor (generating) + DeepSeek tiny context", {
    key,
    r1: { model: "qwen3.6-35b", prompt: "Write a 50-word poem about the ocean.", maxTokens: 80 },
    r2: { model: "deepseek-v4-flash", prompt: "ping", maxTokens: 5 },
    fireOnFirstToken: true,
  }));
  await Bun.sleep(1500);

  // TEST 4: Qwen with medium context (500 tokens) while DeepSeek is streaming
  const mediumPrompt = "Here is some background context: " + "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega. ".repeat(15) + "\nWhat is the 3rd Greek letter?";
  results.push(await testConcurrencyPair("Cross-Model: DeepSeek anchor + Qwen medium context (500t)", {
    key,
    r1: { model: "deepseek-v4-flash", prompt: "Count 1 to 40 in French.", maxTokens: 80 },
    r2: { model: "qwen3.6-35b", prompt: mediumPrompt, maxTokens: 10 },
    fireOnFirstToken: true,
  }));
  await Bun.sleep(1500);

  // TEST 5: Session Weave — Same X-Session-ID (Radix cache prefix sharing)
  const sharedSession = `session-weave-${Date.now()}`;
  results.push(await testConcurrencyPair("Session Weave: Same X-Session-ID on both requests", {
    key,
    r1: {
      model: "deepseek-v4-flash",
      prompt: "Count from 1 to 30.",
      maxTokens: 80,
      headers: { "X-Session-ID": sharedSession },
    },
    r2: {
      model: "qwen3.6-35b",
      prompt: "say ready",
      maxTokens: 5,
      headers: { "X-Session-ID": sharedSession },
    },
    fireOnFirstToken: true,
  }));
  await Bun.sleep(1500);

  // TEST 6: Session Weave — Different X-Session-ID
  results.push(await testConcurrencyPair("Session Weave: Distinct X-Session-IDs", {
    key,
    r1: {
      model: "deepseek-v4-flash",
      prompt: "Count from 1 to 30.",
      maxTokens: 80,
      headers: { "X-Session-ID": `sess-a-${Date.now()}` },
    },
    r2: {
      model: "qwen3.6-35b",
      prompt: "say ready",
      maxTokens: 5,
      headers: { "X-Session-ID": `sess-b-${Date.now()}` },
    },
    fireOnFirstToken: true,
  }));
  await Bun.sleep(1500);

  // TEST 7: Reasoning Passthrough Weave (x-reasoning-passthrough)
  results.push(await testConcurrencyPair("Header Weave: X-Reasoning-Passthrough: 1", {
    key,
    r1: {
      model: "deepseek-v4-flash",
      prompt: "Solve 17 * 23 step by step.",
      maxTokens: 80,
      headers: { "x-reasoning-passthrough": "1" },
    },
    r2: {
      model: "qwen3.6-35b",
      prompt: "2+2=",
      maxTokens: 5,
      headers: { "x-reasoning-passthrough": "1" },
    },
    fireOnFirstToken: true,
  }));
  await Bun.sleep(1500);

  // TEST 8: Stream Anchor + Non-Stream Follower
  results.push(await testConcurrencyPair("Mode Weave: Stream Anchor + Non-Stream Follower", {
    key,
    r1: { model: "deepseek-v4-flash", prompt: "Count 1 to 30.", maxTokens: 80, stream: true },
    r2: { model: "qwen3.6-35b", prompt: "ping", maxTokens: 5, stream: false },
    fireOnFirstToken: true,
  }));

  console.log("\n=================================================================");
  console.log("  SUMMARY OF WEAVE ATTEMPTS");
  console.log("=================================================================");
  let anySuccess = false;
  for (const r of results) {
    const mark = r.success ? "✅ 2 CONCURRENT SUCCESS" : "❌ Rejected (429)";
    console.log(`  ${mark.padEnd(25)} ${r.name}`);
    if (r.success) anySuccess = true;
  }
  console.log(`\nConclusion: ${anySuccess ? "WEAVE IDENTIFIED! Multiple requests can be admitted." : "Strict wall: all variations returned 429 on concurrent."}`);

  // Persist structured results
  const reportPath = "/home/toxic/pens/olympus/products/tau/packages/ai/test/weave-results.json";
  await Bun.write(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), anySuccess, results }, null, 2));
  console.log(`Detailed results saved to ${reportPath}`);
}

if (import.meta.main) {
  await main();
}
