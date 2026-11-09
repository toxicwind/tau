import { logger, postmortem, withFileLock } from "@tau/tau-utils";
import { type JsonLineReply, JsonLineServer } from "../subprocess/jsonl-server";
import type { TinyWorkerRequest, TinyWorkerResponse } from "./title-protocol";

export interface TinyWorkerServerOptions {
	/** Launch identity echoed in `pong`; clients replace a worker whose tag differs. */
	tag: string;
	/** Idle window (nothing in flight, no request received) after which the process exits. */
	idleMs: number;
	/** Serve one `load`/`chat`; `reply.send` reaches only the requesting client. Errors become `error` replies. */
	handle(
		request: Extract<TinyWorkerRequest, { type: "load" | "chat" }>,
		reply: JsonLineReply<TinyWorkerResponse>,
	): Promise<void>;
}

/** The ONNX worker's endpoint: answers `ping`/`shutdown` inline and serializes `load`/`chat` through one queue. */
export class TinyWorkerServer {
	#options: TinyWorkerServerOptions;
	#queue = Promise.resolve();
	#server: JsonLineServer<TinyWorkerRequest, TinyWorkerResponse>;

	constructor(options: TinyWorkerServerOptions) {
		this.#options = options;
		this.#server = new JsonLineServer({
			name: "tiny-worker",
			cleanupLabel: "tiny-worker",
			idleMs: options.idleMs,
			banner: endpoint => `omp tiny worker listening on ${endpoint}`,
			onRequest: (request, reply) => this.#dispatch(request, reply),
		});
	}

	/** Bind `endpoint` and serve until idle exit or `shutdown`; resolves once the socket is released. */
<<<<<<< ours — scope `serve` in class `TinyWorkerServer` (S+F, confidence: low)
// refused_by: container_member · collision: `process.stdout.write(`omp tiny worker listening on ${endpoint}\…`
	async serve(endpoint: string): Promise<void> {
		this.#endpoint = endpoint;
		if (process.platform !== "win32") {
			await withFileLock(`${endpoint}.bind`, async () => {
				await this.#clearStaleSocket(endpoint);
				await this.#listen(endpoint);
			});
		} else {
			await this.#listen(endpoint);
		}
		const cancelCleanup = postmortem.register("tiny-worker", () => this.#shutdown());
		this.#armIdle();
		process.stdout.write(`tau tiny worker listening on ${endpoint}\n`);
		try {
			await this.#stopped.promise;
		} finally {
			cancelCleanup();
		}
=======
	serve(endpoint: string): Promise<void> {
		return this.#server.serve(endpoint);
>>>>>>> theirs — scope `serve` · weave: run 'weave explain packages/coding-agent/src/tiny/worker-server.ts' for per-hunk detail, 'weave check' to verify your resolution
	}

	#dispatch(request: TinyWorkerRequest, reply: JsonLineReply<TinyWorkerResponse>): void {
		if (request.type === "ping") {
			reply.send({ type: "pong", id: request.id, tag: this.#options.tag });
			return;
		}
		if (request.type === "shutdown") {
			this.#server.exit("shutdown requested");
			return;
		}
		const run = async (): Promise<void> => {
			try {
				await this.#options.handle(request, reply);
			} catch (error) {
				reply.send({
					type: "error",
					id: request.id,
					error: error instanceof Error ? (error.stack ?? error.message) : String(error),
				});
			}
		};
		this.#queue = this.#server.busy(() => this.#queue.then(run, run));
	}
}
