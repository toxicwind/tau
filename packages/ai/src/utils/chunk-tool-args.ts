/**
 * General large-payload chunking for tool-call arguments.
 *
 * Dots 3 recon (2026-10-13): when a tool call's arguments carry a large
 * array payload (~200 items / ~2.9k tokens), reasoning models collapse the
 * whole argument object to `{}` with finish=error — the model knows what it
 * should send but emits nothing. Keeping each call under the item ceiling
 * avoids the collapse: the recon ceiling is <100 items per call; 80 leaves
 * headroom.
 *
 * This module is the general mechanism, deliberately not tied to any one
 * tool or call site: a pure planner that splits an argument object into a
 * sequence of per-chunk argument objects (one oversized array field chunked,
 * every other field carried verbatim), plus a sequential executor that runs
 * the chunks in order and stops at the first error or abort.
 */

/** Max items of a chunked array argument per call before splitting kicks in. */
export const DEFAULT_MAX_ITEMS_PER_CALL = 80;

/** Split `items` into consecutive chunks of at most `size`, order preserved. */
export function chunkArray<T>(items: readonly T[], size: number = DEFAULT_MAX_ITEMS_PER_CALL): T[][] {
	if (!Number.isInteger(size) || size < 1) {
		throw new RangeError(`chunk size must be a positive integer, got ${size}`);
	}
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}

/** A planned sequence of chunked calls for one oversized array argument. */
export interface ArgumentChunkPlan {
	/** The argument field that was chunked. */
	readonly field: string;
	/** Item count of the original array. */
	readonly totalItems: number;
	/** Number of chunked calls in the plan. */
	readonly chunkCount: number;
	/** One complete argument object per chunk, in execution order. */
	readonly calls: Record<string, unknown>[];
}

/**
 * Plan chunked calls for `args[field]` when it is an array longer than
 * `maxItems`. Returns `null` when no chunking is needed (field missing, not
 * an array, or within the ceiling) so callers can fall through to a single
 * ordinary call.
 */
export function planArgumentChunks(
	args: Record<string, unknown>,
	field: string,
	maxItems: number = DEFAULT_MAX_ITEMS_PER_CALL,
): ArgumentChunkPlan | null {
	const value = args[field];
	if (!Array.isArray(value) || value.length <= maxItems) return null;
	const chunks = chunkArray(value, maxItems);
	return {
		field,
		totalItems: value.length,
		chunkCount: chunks.length,
		calls: chunks.map(chunk => ({ ...args, [field]: chunk })),
	};
}

/**
 * Run `calls` sequentially through `executor`, in order, collecting one
 * result per call. Stops at the first executor error (the error propagates;
 * later chunks never run — sequential semantics, no partial fan-out) and
 * honors `signal` between chunks.
 */
export async function executeArgumentChunks<TArgs, TResult>(
	calls: readonly TArgs[],
	executor: (args: TArgs, index: number) => Promise<TResult>,
	signal?: AbortSignal,
): Promise<TResult[]> {
	const results: TResult[] = [];
	for (let i = 0; i < calls.length; i++) {
		if (signal?.aborted) {
			throw signal.reason instanceof Error ? signal.reason : new Error("chunked execution aborted");
		}
		results.push(await executor(calls[i], i));
	}
	return results;
}
