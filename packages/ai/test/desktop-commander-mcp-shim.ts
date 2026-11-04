/**
 * desktop-commander-mcp-shim.ts — desktop commander MCP shim for live tests.
 *
 * The live coercion probe (coercion-freeinference-deepseek.live.ts) needs to
 * prove the recovered tasks LAND somewhere visible on the desktop — not just
 * that the coercion layer returns clean strings. Desktop commander (the
 * terminal/file MCP) is that witness: write the recovered tasks to a file and
 * read them back.
 *
 * Shim contract: when the desktop-commander MCP server is NOT running (no
 * upstream in the gateway), this module provides the SAME two operations
 * (write_file / read_file) backed by Bun fs, so live probes never skip the
 * witness step. When it IS reachable, it calls through.
 */

export interface DesktopCommanderOps {
	writeFile(path: string, content: string): Promise<{ ok: true; bytes: number } | { ok: false; error: string }>;
	readFile(path: string): Promise<string | null>;
	/** True when backed by the real MCP server (vs local shim). */
	via: "mcp" | "shim";
}

const DC_MCP_URL = Bun.env.DESKTOP_COMMANDER_URL ?? "http://127.0.0.1:25286/mcp";

async function probeMcp(): Promise<boolean> {
	try {
		const res = await fetch(DC_MCP_URL.replace(/\/mcp$/, "/health"), {
			signal: AbortSignal.timeout(1500),
		});
		return res.ok;
	} catch {
		return false;
	}
}

/** Create the ops object: real MCP when reachable, local-fs shim otherwise. */
export async function getDesktopCommander(): Promise<DesktopCommanderOps> {
	if (await probeMcp()) {
		return {
			via: "mcp",
			async writeFile(path, content) {
				const res = await fetch(DC_MCP_URL, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						jsonrpc: "2.0", id: Date.now(), method: "tools/call",
						params: { name: "write_file", arguments: { file_path: path, content } },
					}),
					signal: AbortSignal.timeout(10_000),
				});
				if (!res.ok) return { ok: false, error: `mcp http ${res.status}` };
				return { ok: true, bytes: content.length };
			},
			async readFile(path) {
				const res = await fetch(DC_MCP_URL, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						jsonrpc: "2.0", id: Date.now(), method: "tools/call",
						params: { name: "read_file", arguments: { file_path: path } },
					}),
					signal: AbortSignal.timeout(10_000),
				});
				if (!res.ok) return null;
				const j: any = await res.json();
				return j?.result?.content?.[0]?.text ?? null;
			},
		};
	}
	// Shim: identical operations, Bun fs backed.
	return {
		via: "shim",
		async writeFile(path, content) {
			try {
				await Bun.write(path, content);
				return { ok: true, bytes: content.length };
			} catch (e) {
				return { ok: false, error: String(e) };
			}
		},
		async readFile(path) {
			try {
				const f = Bun.file(path);
				return await f.exists() ? await f.text() : null;
			} catch {
				return null;
			}
		},
	};
}
