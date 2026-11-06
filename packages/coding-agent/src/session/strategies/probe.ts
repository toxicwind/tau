import type { Model } from "@tau/tau-ai";
import { ProviderHttpError } from "@tau/tau-ai/error";
import { logger } from "@tau/tau-utils";

/**
 * Reachability probe for a fallback candidate model.
 *
 * The retry/fallback strategy must never commit to a dead model: "falling back
 * to a dead model should not cause an error; it should cause a check of the
 * fallback model to make certain it works." This module verifies a candidate
 * actually serves before the strategy routes onto it, so a wedged provider lane
 * (e.g. a router whose upstream is stalled) is skipped instead of burning the
 * retry budget on a request that can never succeed.
 *
 * The probe is a minimal `chat/completions` (or `messages`) request with
 * `max_tokens: 1`, mirroring the API-key validation probe in
 * `@tau/tau-ai/registry/api-key-validation`. Borrowing that request shape keeps
 * the probe cheap and provider-agnostic: any model that answers a 1-token ping
 * is reachable.
 */

/** Verdict of a reachability probe. */
export type ProbeVerdict =
	| { ok: true; latencyMs: number }
	| { ok: false; reason: ProbeFailureReason; status?: number };

/** Why a candidate failed the probe, for logging and Lua strategy input. */
export type ProbeFailureReason = "timeout" | "http" | "network" | "auth" | "unknown";

export interface ProbeOptions {
	/** Hard wall-clock cap for the probe. Defaults to 4s so a dead lane fails fast. */
	timeoutMs?: number;
	/** Override fetch (tests, Lua sandbox). */
	fetch?: typeof fetch;
	/** Abort the probe early (session teardown). */
	signal?: AbortSignal;
}

const DEFAULT_PROBE_TIMEOUT_MS = 4_000;

/** The wire id a model is served under (mirrors `requestModelId ?? id`). */
function wireModelId(model: Model): string {
	return model.requestModelId ?? model.id;
}

/** Normalize an Anthropic base URL to its `/v1` root. */
function normalizeAnthropicBaseUrl(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, "");
	return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

/**
 * Probe a model's reachability with a 1-token ping. Returns a verdict instead
 * of throwing, so the strategy can skip a dead candidate without an error
 * surfacing to the user.
 */
export async function probeModelReachability(
	model: Model,
	apiKey: string,
	options: ProbeOptions = {},
): Promise<ProbeVerdict> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
	const startedAt = Date.now();
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
	const fetchImpl = options.fetch ?? fetch;

	try {
		if (model.api === "anthropic-messages") {
			const baseUrl = normalizeAnthropicBaseUrl(model.baseUrl);
			const response = await fetchImpl(`${baseUrl}/messages`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"anthropic-version": "2023-06-01",
					"x-api-key": apiKey,
				},
				body: JSON.stringify({
					model: wireModelId(model),
					messages: [{ role: "user", content: "ping" }],
					max_tokens: 1,
				}),
				signal,
			});
			return verdictFromResponse(response, startedAt);
		}

		const trimmedBaseUrl = model.baseUrl.trim().replace(/\/+$/, "");
		const response = await fetchImpl(`${trimmedBaseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: wireModelId(model),
				messages: [{ role: "user", content: "ping" }],
				max_tokens: 1,
				temperature: 0,
			}),
			signal,
		});
		return verdictFromResponse(response, startedAt);
	} catch (error) {
		return verdictFromError(error, startedAt);
	}
}

function verdictFromResponse(response: Response, startedAt: number): ProbeVerdict {
	const latencyMs = Date.now() - startedAt;
	if (response.ok) {
		return { ok: true, latencyMs };
	}
	const reason: ProbeFailureReason =
		response.status === 401 || response.status === 403 ? "auth" : "http";
	return { ok: false, reason, status: response.status };
}

function verdictFromError(error: unknown, _startedAt: number): ProbeVerdict {
	if (error instanceof Error && error.name === "TimeoutError") {
		return { ok: false, reason: "timeout" };
	}
	if (error instanceof ProviderHttpError) {
		return { ok: false, reason: "http", status: error.status };
	}
	const reason: ProbeFailureReason = "network";
	logger.debug("fallback probe network error", { error: String(error) });
	return { ok: false, reason };
}

/** Convenience: whether a probe verdict means "serving and usable". */
export function probeServed(verdict: ProbeVerdict): boolean {
	return verdict.ok === true;
}