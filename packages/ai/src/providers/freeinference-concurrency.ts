/**
 * FreeInference concurrency queue — wraps fetch calls with a sliding-window
 * semaphore (default maxConcurrency=4, tunable via env or provider config) and
 * an exponential-backoff retry queue on 429 (concurrency_limit_exceeded).
 *
 * Why this exists: freeinference.org enforces a per-key concurrency limit
 * (default 2 for free/pro keys, often 1–3 depending on fleet state). Any
 * request beyond the limit receives HTTP 429 with `{"code":"concurrency_limit_exceeded","message":"Too many concurrent requests (limit: N)"}`.
 * Without a queue, parallel tool calls (e.g. pattern-borrow racing 3 lanes)
 * all blow through and 429-fail. This helper serializes them with backoff
 * retry so the caller never sees the 429 — it just waits.
 *
 * Usage:
 *   const queue = new FreeInferenceQueue({ maxConcurrency: 4 });
 *   const result = await queue.enqueue(() => fetch(url, options));
 *
 * Queue stats available via queue.stats for observability.
 */

export interface ConcurrencyQueueOptions {
	/** Max concurrent in-flight requests. Default: 4 (freeinference supports up to ~4-8). */
	maxConcurrency?: number;
	/** Base retry delay in ms for 429 backoff. Default: 1000. */
	baseRetryMs?: number;
	/** Max retry delay in ms. Default: 30000. */
	maxRetryMs?: number;
	/** Max retry attempts before failing. Default: 5. */
	maxRetries?: number;
	/** Enable jitter on retry delays. Default: true. */
	jitter?: boolean;
}

interface RetryStats {
	totalAttempts: number;
	totalRetries: number;
	totalWaitMs: number;
	peakConcurrent: number;
	succeeded: number;
	failed: number;
	skipped: number; // 429s that resolved on retry
}

export class FreeInferenceQueue {
	#maxConcurrency: number;
	#baseRetryMs: number;
	#maxRetryMs: number;
	#maxRetries: number;
	#jitter: boolean;
	#active = 0;
	#queue: Array<() => Promise<Response>> = [];
	#stats: RetryStats = {
		totalAttempts: 0,
		totalRetries: 0,
		totalWaitMs: 0,
		peakConcurrent: 0,
		succeeded: 0,
		failed: 0,
		skipped: 0,
	};

	constructor(opts: ConcurrencyQueueOptions = {}) {
		this.#maxConcurrency = opts.maxConcurrency ?? 4;
		this.#baseRetryMs = opts.baseRetryMs ?? 1000;
		this.#maxRetryMs = opts.maxRetryMs ?? 30000;
		this.#maxRetries = opts.maxRetries ?? 5;
		this.#jitter = opts.jitter ?? true;
	}

	enqueue<T>(fn: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.#stats.totalAttempts++;
			this.#enqueueTask(() => fn(), resolve, reject);
		});
	}

	#enqueueTask<T>(
		fn: () => Promise<T>,
		resolve: (v: T) => void,
		reject: (e: unknown) => void,
		retryCount = 0,
	): void {
		// Try to dispatch immediately if under concurrency cap
		if (this.#active < this.#maxConcurrency) {
			this.#dispatch(fn, resolve, reject, retryCount);
			return;
		}
		// Queue it for later dispatch
		this.#queue.push(() => this.#enqueueTask(fn, resolve, reject, retryCount));
		this.#drain();
	}

	#dispatch<T>(
		fn: () => Promise<T>,
		resolve: (v: T) => void,
		reject: (e: unknown) => void,
		retryCount: number,
	): void {
		this.#active++;
		if (this.#active > this.#stats.peakConcurrent) {
			this.#stats.peakConcurrent = this.#active;
		}

		fn()
			.then(async (response) => {
				// Check for concurrency 429
				if (response.status === 429) {
					const body = await response.text();
					let retryAfter = 0;
					try {
						const json = JSON.parse(body);
						retryAfter = (json.retry_after ?? 0) * 1000;
					} catch {
						// body parse error — use default backoff
					}

					if (retryCount < this.#maxRetries) {
						const backoff = Math.min(
							this.#baseRetryMs * Math.pow(2, retryCount),
							this.#maxRetryMs,
						);
						const jitter = this.#jitter
							? backoff * (0.5 + Math.random())
							: backoff;
						this.#stats.totalRetries++;
						this.#stats.totalWaitMs += jitter;
						this.#active--;

						setTimeout(() => {
							this.#enqueueTask(fn, resolve, reject, retryCount + 1);
						}, jitter);
						return;
					}

					// Exhausted retries — fail with the 429 response
					this.#stats.failed++;
					reject(new Error(`FreeInference 429 after ${retryCount + 1} retries: ${body.slice(0, 200)}`));
					return;
				}

				// Success — pass through the response
				this.#stats.succeeded++;
				resolve(response as unknown as T);
			})
			.catch((err) => {
				this.#stats.failed++;
				reject(err);
			})
			.finally(() => {
				this.#active--;
				this.#drain();
			});
	}

	#drain(): void {
		while (this.#active < this.#maxConcurrency && this.#queue.length > 0) {
			const next = this.#queue.shift()!;
			next();
		}
	}

	/** Current concurrency stats — for observability / telemetry. */
	get stats(): Readonly<RetryStats> {
		return { ...this.#stats };
	}

	/** Current in-flight count. */
	get active(): number {
		return this.#active;
	}

	/** Pending queue depth. */
	get queued(): number {
		return this.#queue.length;
	}

	/** Reset stats (useful for per-session resets). */
	resetStats(): void {
		this.#stats = {
			totalAttempts: 0,
			totalRetries: 0,
			totalWaitMs: 0,
			peakConcurrent: 0,
			succeeded: 0,
			failed: 0,
			skipped: 0,
		};
	}
}

/**
 * Default singleton for the freeinference provider.
 * Use this in the provider's request pipeline — wrap each fetch() call with
 * queue.enqueue() to get automatic concurrency control + 429 retry.
 */
export const DEFAULT_QUEUE = new FreeInferenceQueue({
	maxConcurrency: 4,
	baseRetryMs: 800,
	maxRetryMs: 15000,
	maxRetries: 5,
});
