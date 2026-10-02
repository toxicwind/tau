import { logger } from "@tau/tau-utils";
import {
	createUnavailableWorker,
	createWorkerHandle,
	createWorkerSubprocess,
	inferenceWorkerEnv,
	logWorkerMessage,
	resolveWorkerSpawnCmd,
	SMOKE_TEST_TIMEOUT_MS,
	type SpawnedSubprocess,
	smokeTestWorker,
	spawnWorkerOrUnavailable,
	type RefCountedWorkerHandle,
} from "../subprocess/worker-client";
import type { MnemotauEmbedModelId, MnemotauEmbedWorkerInbound, MnemotauEmbedWorkerOutbound } from "./embed-protocol";

/**
 * Parent-side handle for the mnemotau embeddings subprocess. The runtime
 * implementation is a Bun child process so `onnxruntime-node`'s NAPI
 * constructor + finalizer never run inside the main agent address space —
 * those destructors segfault Bun on Windows when mnemotau's local embedding
 * provider loads fastembed in the main process (issue #3031; the mnemotau
 * sibling of the tiny-model fix from #1606 / #1607).
 */
export type MnemotauEmbedWorkerHandle = RefCountedWorkerHandle<MnemotauEmbedWorkerInbound, MnemotauEmbedWorkerOutbound>;

type PendingRequest =
	| { kind: "init"; model: MnemotauEmbedModelId; resolve: (ok: boolean) => void }
	| { kind: "embed"; model: MnemotauEmbedModelId; resolve: (vectors: number[][] | Error) => void };

/**
 * Hidden subcommand on the main CLI that boots the mnemotau embeddings worker
 * in the spawned subprocess. Kept in sync with the dispatch in `cli.ts`.
 */
export const MNEMOTAU_EMBED_WORKER_ARG = "__omp_worker_mnemotau_embed";

/**
 * Spawn the mnemotau embeddings worker as a subprocess. Exported for tests and
 * the smoke probe; production callers go through {@link spawnMnemotauEmbedWorker}.
 * The child inherits the parent env — fastembed honours `HF_HUB_*`,
 * `HTTPS_PROXY`, etc., and our `loadFastembed()` reads the same `TAU_*`
 * runtime-install knobs the parent uses.
 */
export function createMnemotauEmbedSubprocess(): SpawnedSubprocess<MnemotauEmbedWorkerOutbound> {
	return createWorkerSubprocess<MnemotauEmbedWorkerOutbound>({
		spawnCommand: resolveWorkerSpawnCmd(MNEMOTAU_EMBED_WORKER_ARG),
		env: inferenceWorkerEnv(),
		exitLabel: "mnemotau embed subprocess",
	});
}

function wrapSubprocess(spawned: SpawnedSubprocess<MnemotauEmbedWorkerOutbound>): MnemotauEmbedWorkerHandle {
	const { proc } = spawned;
	// Embed keeps its own guarded `proc.send` (neutralizes only the synchronous
	// throw, not the async EPIPE rejection) rather than the shared `safeSend`
	// the other workers use — behaviour preserved verbatim.
	return {
		...createWorkerHandle<MnemotauEmbedWorkerInbound, MnemotauEmbedWorkerOutbound>(spawned, message => {
			try {
				proc.send(message);
			} catch (error) {
				logger.debug("mnemotau-embed: send to subprocess failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}),
		ref() {
			try {
				proc.ref();
			} catch {
				// Already gone.
			}
		},
		unref() {
			try {
				proc.unref();
			} catch {
				// Already gone.
			}
		},
	};
}

function createUnavailableMnemotauEmbedWorker(error: unknown): MnemotauEmbedWorkerHandle {
	return {
		...createUnavailableWorker<MnemotauEmbedWorkerInbound, MnemotauEmbedWorkerOutbound>(error),
		ref() {},
		unref() {},
	};
}

function spawnMnemotauEmbedWorker(): MnemotauEmbedWorkerHandle {
	return spawnWorkerOrUnavailable(
		() => wrapSubprocess(createMnemotauEmbedSubprocess()),
		createUnavailableMnemotauEmbedWorker,
		"mnemotau embed worker spawn failed; local embeddings disabled",
	);
}

/**
 * Per-model wrapper produced by {@link MnemotauEmbedClient.initialize}.
 * `embed()` round-trips one batch of texts through the worker subprocess and
 * yields the resulting vectors in a single asynchronous batch — fastembed's
 * own iterator was emitting batches that we collect on the child side anyway,
 * and serializing per-batch over IPC would not improve throughput.
 */
export interface MnemotauSubprocessEmbeddingModel {
	embed(texts: string[], batchSize?: number): AsyncIterable<number[][]>;
}

/**
 * Upper bound on a steady-state embed IPC round-trip. Initialization is
 * intentionally exempt: bundled installs may spend several minutes installing
 * fastembed and bootstrapping the model, and killing that worker can strand the
 * runtime install lock. Once initialization succeeds, a longer embed stall
 * means a hung native runtime (issue #4792) that would otherwise pin whatever
 * awaits the embed — a turn's memory recall or the headless shutdown
 * consolidation — indefinitely, leaving the process alive with an unreaped
 * `__omp_worker_mnemotau_embed` child (issue #7352). On expiry the embed fails
 * and the worker is SIGKILL-reaped so the next request respawns a fresh one.
 */
const EMBED_REQUEST_TIMEOUT_MS = 120_000;

/** Race marker for {@link MnemotauEmbedClient.#awaitRequest}. */
const REQUEST_TIMED_OUT = Symbol("mnemotau.embed.timedOut");

export class MnemotauEmbedClient {
	#worker: MnemotauEmbedWorkerHandle | null = null;
	#unsubscribeMessage: (() => void) | null = null;
	#unsubscribeError: (() => void) | null = null;
	#pending = new Map<string, PendingRequest>();
	#nextRequestId = 0;
	#refed = false;
	#spawnWorker: () => MnemotauEmbedWorkerHandle;
	#requestTimeoutMs: number;

	constructor(
		spawnWorker: () => MnemotauEmbedWorkerHandle = spawnMnemotauEmbedWorker,
		requestTimeoutMs: number = EMBED_REQUEST_TIMEOUT_MS,
	) {
		this.#spawnWorker = spawnWorker;
		this.#requestTimeoutMs = requestTimeoutMs;
	}

	/**
	 * Load the named fastembed model inside the subprocess. Resolves to a
	 * thin wrapper whose `embed()` round-trips through the same worker, or
	 * `null` when the worker cannot init the model (missing peer, native
	 * load failure, etc.). Multiple calls with the same model reuse the
	 * single in-flight worker; calling with a different model loads it on
	 * the child without restarting the process.
	 */
	async initialize(
		model: MnemotauEmbedModelId,
		cacheDir: string | undefined,
	): Promise<MnemotauSubprocessEmbeddingModel | null> {
		try {
			const worker = this.#ensureWorker();
			const id = String(++this.#nextRequestId);
			const { promise, resolve } = Promise.withResolvers<boolean>();
			this.#addPending(id, { kind: "init", model, resolve });
			try {
				worker.send({ type: "init", id, model, cacheDir });
				const ok = await promise;
				if (!ok) return null;
			} finally {
				this.#deletePending(id);
			}
		} catch (error) {
			logger.debug("mnemotau-embed: init failed", {
				model,
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
		return { embed: (texts, batchSize) => this.#streamEmbed(model, cacheDir, texts, batchSize) };
	}

	async terminate(): Promise<void> {
		const worker = this.#worker;
		this.#worker = null;
		this.#unsubscribeMessage?.();
		this.#unsubscribeMessage = null;
		this.#unsubscribeError?.();
		this.#unsubscribeError = null;
		for (const pending of this.#pending.values()) {
			if (pending.kind === "init") pending.resolve(false);
			else pending.resolve(new Error("mnemotau embed worker terminated"));
		}
		this.#pending.clear();
		this.#refed = false;
		try {
			await worker?.terminate();
		} catch {
			// Already gone.
		}
	}

	async #embed(
		model: MnemotauEmbedModelId,
		cacheDir: string | undefined,
		texts: string[],
		batchSize: number | undefined,
	): Promise<number[][]> {
		const worker = this.#ensureWorker();
		const id = String(++this.#nextRequestId);
		const { promise, resolve } = Promise.withResolvers<number[][] | Error>();
		this.#addPending(id, { kind: "embed", model, resolve });
		try {
			// Carry the (model, cacheDir) the wrapper was bound to in every
			// embed message: dispose + respawn between two embeds on the same
			// `LocalEmbeddingModel` handle would otherwise hit a fresh
			// worker's "embed before init" guard. Worker `ensureLoaded` is
			// idempotent so steady-state embeds pay no extra cost.
			worker.send({ type: "embed", id, model, cacheDir, texts, batchSize });
			const result = await this.#awaitRequest(promise);
			if (result instanceof Error) throw result;
			return result;
		} finally {
			this.#deletePending(id);
		}
	}

	/**
	 * Await one steady-state embed reply, bounded by
	 * {@link EMBED_REQUEST_TIMEOUT_MS}. The timeout timer is `unref`'d so a
	 * pending request has only the worker reference keeping the parent event
	 * loop alive. On expiry the wedged worker is SIGKILL-reaped via
	 * {@link terminate} — faulting any other in-flight request and letting the
	 * next call respawn a fresh child — before the request rejects, so a hung
	 * native runtime cannot pin a turn's recall or shutdown consolidation
	 * forever (issue #7352).
	 */
	async #awaitRequest<T>(promise: Promise<T>): Promise<T> {
		const { promise: timedOut, resolve: fire } = Promise.withResolvers<typeof REQUEST_TIMED_OUT>();
		const timer = setTimeout(() => fire(REQUEST_TIMED_OUT), this.#requestTimeoutMs);
		timer.unref();
		try {
			const winner = await Promise.race([promise, timedOut]);
			if (winner === REQUEST_TIMED_OUT) {
				void this.terminate();
				throw new Error("mnemotau embed worker request timed out");
			}
			return winner;
		} finally {
			clearTimeout(timer);
		}
	}

	async *#streamEmbed(
		model: MnemotauEmbedModelId,
		cacheDir: string | undefined,
		texts: string[],
		batchSize: number | undefined,
	): AsyncIterable<number[][]> {
		const vectors = await this.#embed(model, cacheDir, texts, batchSize);
		// Mnemotau's `collectMatrix` re-batches via async iteration anyway; yield
		// a single batch carrying the full result so the caller's drain loop
		// behaves identically to the in-process fastembed iterator (one yield
		// per `embed()` call) without paying extra IPC round-trips.
		yield vectors;
	}

	#ensureWorker(): MnemotauEmbedWorkerHandle {
		if (this.#worker) return this.#worker;
		const worker = this.#spawnWorker();
		this.#worker = worker;
		this.#unsubscribeMessage = worker.onMessage(message => this.#handleMessage(message));
		this.#unsubscribeError = worker.onError(error => this.#handleWorkerError(error));
		return worker;
	}

	/** Register a pending request and keep the worker referenced while work is in flight. */
	#addPending(id: string, request: PendingRequest): void {
		this.#pending.set(id, request);
		this.#syncWorkerRef();
	}

	/** Drop a pending request and unref the worker once nothing is in flight. */
	#deletePending(id: string): void {
		if (this.#pending.delete(id)) this.#syncWorkerRef();
	}

	/**
	 * The embeddings subprocess is spawned unref'd so an idle interactive or
	 * daemon session never blocks exit. Keep it referenced only while a request
	 * is pending so short-lived print-mode commands cannot exit before recall
	 * receives the worker response (issue #12067).
	 */
	#syncWorkerRef(): void {
		const worker = this.#worker;
		if (!worker) return;
		const shouldRef = this.#pending.size > 0;
		if (shouldRef === this.#refed) return;
		this.#refed = shouldRef;
		if (shouldRef) worker.ref();
		else worker.unref();
	}

	#handleMessage(message: MnemotauEmbedWorkerOutbound): void {
		if (message.type === "log") {
			logWorkerMessage(message);
			return;
		}
		if (message.type === "pong") return;

		const pending = this.#pending.get(message.id);
		if (!pending) return;
		this.#deletePending(message.id);
		if (message.type === "ready") {
			if (pending.kind === "init") pending.resolve(true);
			return;
		}
		if (message.type === "vectors") {
			if (pending.kind === "embed") pending.resolve(message.vectors);
			return;
		}
		logger.debug("mnemotau-embed: worker returned error", { error: message.error });
		if (pending.kind === "init") pending.resolve(false);
		else pending.resolve(new Error(message.error));
	}

	#handleWorkerError(error: Error): void {
		logger.warn("mnemotau-embed: worker error", { error: error.message });
		for (const pending of this.#pending.values()) {
			if (pending.kind === "init") pending.resolve(false);
			else pending.resolve(error);
		}
		this.#pending.clear();
		void this.terminate();
	}
}

export const mnemotauEmbedClient = new MnemotauEmbedClient();

export async function shutdownMnemotauEmbedClient(): Promise<void> {
	await mnemotauEmbedClient.terminate();
}

export async function smokeTestMnemotauEmbedWorker({
	timeoutMs = SMOKE_TEST_TIMEOUT_MS,
}: {
	timeoutMs?: number;
} = {}): Promise<void> {
	await smokeTestWorker(wrapSubprocess(createMnemotauEmbedSubprocess()), "mnemotau embed worker", timeoutMs);
}
