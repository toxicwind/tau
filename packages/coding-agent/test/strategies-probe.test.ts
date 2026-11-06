import { expect, test } from "bun:test";
import { probeModelReachability, probeServed } from "tau/session/strategies/probe";
import type { Model } from "@tau/tau-ai";

function model(overrides: Partial<Model> = {}): Model {
	return {
		id: "test-model",
		name: "Test Model",
		api: "openai",
		provider: "test",
		baseUrl: "http://127.0.0.1:1/v1",
		reasoning: false,
		input: ["text"],
		identity: { class: "chat", family: "test", revision: "0" },
		...overrides,
	} as Model;
}

test("probe returns ok when the endpoint serves a 1-token ping", async () => {
	const fetchMock = async () =>
		new Response(JSON.stringify({ choices: [{ message: { content: "p" } }] }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	const verdict = await probeModelReachability(model(), "key", { fetch: fetchMock as typeof fetch });
	expect(verdict.ok).toBe(true);
	expect(probeServed(verdict)).toBe(true);
});

test("probe reports a dead (HTTP 5xx) model as not serving", async () => {
	const fetchMock = async () =>
		new Response(JSON.stringify({ error: { message: "no upstream available" } }), {
			status: 502,
			headers: { "Content-Type": "application/json" },
		});
	const verdict = await probeModelReachability(model(), "key", { fetch: fetchMock as typeof fetch });
	expect(verdict.ok).toBe(false);
	if (!verdict.ok) {
		expect(verdict.reason).toBe("http");
		expect(verdict.status).toBe(502);
	}
	expect(probeServed(verdict)).toBe(false);
});

test("probe reports auth failure distinctly from a dead lane", async () => {
	const fetchMock = async () =>
		new Response(JSON.stringify({ error: { message: "unauthorized" } }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	const verdict = await probeModelReachability(model(), "bad-key", { fetch: fetchMock as typeof fetch });
	expect(verdict.ok).toBe(false);
	if (!verdict.ok) {
		expect(verdict.reason).toBe("auth");
	}
});

test("probe reports a network failure (connection refused) as not serving", async () => {
	const fetchMock = async () => {
		throw new TypeError("fetch failed");
	};
	const verdict = await probeModelReachability(model(), "key", { fetch: fetchMock as typeof fetch });
	expect(verdict.ok).toBe(false);
	if (!verdict.ok) {
		expect(verdict.reason).toBe("network");
	}
});

test("probe times out fast on a wedged lane and reports timeout", async () => {
	const fetchMock = async (_url: unknown, init?: RequestInit) => {
		// Honor the signal: a wedged lane never resolves until the timeout fires.
		await new Promise<void>((_resolve, reject) => {
			init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError")));
		});
		return undefined as never;
	};
	const verdict = await probeModelReachability(model(), "key", {
		fetch: fetchMock as typeof fetch,
		timeoutMs: 50,
	});
	expect(verdict.ok).toBe(false);
	if (!verdict.ok) {
		expect(verdict.reason).toBe("timeout");
	}
});

test("probe uses the wire model id (requestModelId) when present", async () => {
	let sentModel: string | undefined;
	const fetchMock = async (_url: unknown, init?: RequestInit) => {
		sentModel = JSON.parse(String(init?.body)).model;
		return new Response(JSON.stringify({ choices: [] }), { status: 200 });
	};
	await probeModelReachability(model({ requestModelId: "upstream-id" }), "key", {
		fetch: fetchMock as typeof fetch,
	});
	expect(sentModel).toBe("upstream-id");
});