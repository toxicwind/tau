/**
 * Serve protocol: newline-delimited JSON control frames between `tau attach`
 * clients and the session-host daemon (`tau serve`).
 *
 * Terminal bytes ride inside `out`/`input` frames base64-encoded; everything
 * else is plain control state. One connected client owns input at a time
 * (last attach steals ownership); every other client is a read-only viewer.
 * The hosted TUI itself keeps running no matter what clients do — a client
 * dying is the entire point of the daemon.
 */

/** Maximum decoded payload per frame (PTY chunks are small; this bounds abuse). */
export const SERVE_MAX_FRAME_BYTES = 512 * 1024;
/** Maximum encoded line length accepted from a client socket. */
export const SERVE_MAX_LINE_LENGTH = SERVE_MAX_FRAME_BYTES + 128;

export type ServeClientFrame =
	| { t: "hello"; token: string; cols: number; rows: number }
	| { t: "input"; b64: string }
	| { t: "resize"; cols: number; rows: number }
	| { t: "stop" }
	| { t: "ping" };

export type ServeServerFrame =
	| { t: "welcome"; pid: number | undefined; owner: boolean }
	| { t: "out"; b64: string }
	| { t: "owner"; owner: boolean; reason?: string }
	| { t: "notice"; text: string }
	| { t: "bye"; reason: string }
	| { t: "pong" };

export function encodeServeFrame(frame: ServeClientFrame | ServeServerFrame): string {
	return `${JSON.stringify(frame)}\n`;
}

/** Non-negative integer terminal dimension. */
function isDimension(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4096;
}

/** Structural validation of an untrusted client frame (socket peer). */
export function isServeClientFrame(value: unknown): value is ServeClientFrame {
	if (!value || typeof value !== "object" || !("t" in value) || typeof value.t !== "string") return false;
	const frame = value as Record<string, unknown>;
	switch (frame.t) {
		case "hello":
			return typeof frame.token === "string" && isDimension(frame.cols) && isDimension(frame.rows);
		case "input":
			return typeof frame.b64 === "string" && frame.b64.length * 0.75 <= SERVE_MAX_FRAME_BYTES;
		case "resize":
			return isDimension(frame.cols) && isDimension(frame.rows);
		case "stop":
		case "ping":
			return true;
		default:
			return false;
	}
}

/** Structural validation of an untrusted server frame (socket peer). */
export function isServeServerFrame(value: unknown): value is ServeServerFrame {
	if (!value || typeof value !== "object" || !("t" in value) || typeof value.t !== "string") return false;
	const frame = value as Record<string, unknown>;
	switch (frame.t) {
		case "welcome":
			return (frame.pid === undefined || typeof frame.pid === "number") && typeof frame.owner === "boolean";
		case "out":
			return typeof frame.b64 === "string" && frame.b64.length * 0.75 <= SERVE_MAX_FRAME_BYTES;
		case "owner":
			return typeof frame.owner === "boolean" && (frame.reason === undefined || typeof frame.reason === "string");
		case "notice":
			return typeof frame.text === "string";
		case "bye":
			return typeof frame.reason === "string";
		case "pong":
			return true;
		default:
			return false;
	}
}

/** Decode a base64 terminal-bytes payload. */
export function decodeServeBytes(b64: string): Uint8Array {
	return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

/** Encode terminal bytes for a frame payload. */
export function encodeServeBytes(bytes: Uint8Array | string): string {
	return btoa(typeof bytes === "string" ? bytes : String.fromCharCode(...bytes));
}
