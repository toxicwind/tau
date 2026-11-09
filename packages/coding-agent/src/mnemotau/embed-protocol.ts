/**
<<<<<<< ours — interstitial `file_header` (T+F, confidence: medium)
// refused_by: merge_ladder_exhausted · collision: `* Wire types between the parent (`MnemopiEmbedClient`) and the …` +1 more
 * Wire types between the parent (`MnemotauEmbedClient`) and the local
 * embeddings subprocess. The parent owns the subprocess lifecycle (graceful
 * work, hard `SIGKILL` on shutdown); the protocol carries no explicit close
 * handshake — once the parent decides to terminate, it signals the OS to reap
 * the child so `onnxruntime-node`'s NAPI finalizer never runs in the main
 * agent address space (it crashes Bun on Windows shutdown — issue #3031, the
 * mnemotau sibling of the tiny-model fix from #1606/#1607). See
 * `embed-client.ts` for the spawn/kill glue.
=======
 * Wire types for local mnemopi embeddings, on two legs:
 *
 * - omp process ⇄ shared embedding server (`embed-server.ts`): newline JSON
 *   over a native IPC endpoint, one server per (model, cache dir) per machine.
 * - shared server ⇄ its onnxruntime child (`embed-worker.ts`): Bun IPC. The
 *   server owns the child (hard `SIGKILL` on wedge, idle exit, or shutdown);
 *   that leg carries no close handshake so `onnxruntime-node`'s NAPI finalizer
 *   never runs (it crashes Bun on Windows shutdown — issue #3031, the mnemopi
 *   sibling of the tiny-model fix from #1606/#1607).
>>>>>>> theirs — interstitial `file_header` (T+F, confidence: medium) · weave: run 'weave explain packages/coding-agent/src/mnemotau/embed-protocol.ts' for per-hunk detail, 'weave check' to verify your resolution
 */
import type { SharedWorkerControl, SharedWorkerPong } from "../subprocess/shared-worker";

/** Env var carrying the endpoint the shared server must own. */
export const MNEMOPI_EMBED_SOCKET_ENV = "OMP_MNEMOPI_EMBED_SOCKET";
/** Env var naming the model the shared server serves (process title and logs). */
export const MNEMOPI_EMBED_MODEL_ENV = "OMP_MNEMOPI_EMBED_MODEL";
/** Env var carrying the launch tag the server echoes in `pong`, so a server from another omp version is replaced. */
export const MNEMOPI_EMBED_TAG_ENV = "OMP_MNEMOPI_EMBED_TAG";
/** Env var overriding the idle exit window (milliseconds); for tests. */
export const MNEMOPI_EMBED_IDLE_MS_ENV = "OMP_MNEMOPI_EMBED_IDLE_MS";
/** Idle window (nothing in flight, no request received) after which the server exits and the model's memory is freed. */
export const MNEMOPI_EMBED_IDLE_MS = 15 * 60 * 1_000;

/** Identifier of the fastembed model the worker should load (e.g. `fast-bge-base-en-v1.5`). */
export type MnemotauEmbedModelId = string;

export type MnemotauEmbedWorkerInbound =
	| { type: "ping"; id: string }
	| { type: "init"; id: string; model: MnemotauEmbedModelId; cacheDir?: string }
	// `embed` always carries the same `model` / `cacheDir` the wrapper was
	// initialized with so a fresh subprocess (after the parent SIGKILLed the
	// previous one but mnemotau still holds the cached `LocalEmbeddingModel`)
	// can lazily reload the model on demand instead of returning
	// "embed before init".
	| { type: "embed"; id: string; model: MnemotauEmbedModelId; cacheDir?: string; texts: string[]; batchSize?: number };

export type MnemotauEmbedWorkerOutbound =
	| { type: "pong"; id: string }
	| { type: "ready"; id: string }
	| { type: "vectors"; id: string; vectors: number[][] }
	| { type: "error"; id: string; error: string }
	| { type: "log"; level: "debug" | "warn" | "error"; msg: string; meta?: Record<string, unknown> };

export interface MnemotauEmbedTransport {
	send(message: MnemotauEmbedWorkerOutbound): void;
	onMessage(handler: (message: MnemotauEmbedWorkerInbound) => void): () => void;
}

/** Model work both legs carry. */
export type MnemopiEmbedCall = Extract<MnemopiEmbedWorkerInbound, { type: "init" | "embed" }>;

/** Requests an omp process sends the shared server. */
export type MnemopiEmbedServerRequest = SharedWorkerControl | MnemopiEmbedCall;

/** Replies the shared server sends an omp process. */
export type MnemopiEmbedServerResponse =
	| SharedWorkerPong
	| Extract<MnemopiEmbedWorkerOutbound, { type: "ready" | "vectors" | "error" }>;
