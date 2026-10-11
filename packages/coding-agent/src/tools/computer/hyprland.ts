import { resolve } from "node:path";
import { spawn } from "node:child_process";
import * as net from "node:net";
import * as path from "node:path";
import type { DesktopDisplay, DesktopWindow } from "@tau/tau-natives";

interface HyprClientRaw {
	address: string;
	mapped?: boolean;
	hidden?: boolean;
	at: [number, number];
	size: [number, number];
	class: string;
	title: string;
	initialClass?: string;
	initialTitle?: string;
	pid: number;
	focusHistoryID: number;
}

interface HyprMonitorRaw {
	id: number;
	name: string;
	description?: string;
	width: number;
	height: number;
	x: number;
	y: number;
	scale: number;
	focused: boolean;
}

/** Returns true when running inside a Hyprland Wayland compositor session. */
export function isHyprlandActive(): boolean {
	return Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE && process.env.XDG_RUNTIME_DIR);
}

/** Resolves the canonical command socket path for the active Hyprland instance. */
export function getHyprSocketPath(): string | null {
	const runtimeDir = process.env.XDG_RUNTIME_DIR;
	const signature = process.env.HYPRLAND_INSTANCE_SIGNATURE;
	if (!runtimeDir || !signature) return null;
	return path.join(runtimeDir, "hypr", signature, ".socket.sock");
}

/** Sends a command to Hyprland's UNIX domain socket and reads the response. */
export function hyprRequest(command: string, timeoutMs = 2000): Promise<string> {
	const sockPath = getHyprSocketPath();
	if (!sockPath) return Promise.reject(new Error("Hyprland socket path not found"));

	return new Promise<string>((resolve, reject) => {
		const client = net.createConnection(sockPath, () => {
			client.write(command);
		});
		let data = "";
		client.on("data", chunk => {
			data += chunk.toString("utf8");
		});
		client.on("end", () => {
			resolve(data);
		});
		client.on("error", err => {
			reject(err);
		});
		client.setTimeout(timeoutMs, () => {
			client.destroy();
			reject(new Error(`Hyprland socket request timed out after ${timeoutMs}ms for "${command}"`));
		});
	});
}

/** Lists all mapped, visible client windows from Hyprland IPC. */
export async function hyprListWindows(): Promise<DesktopWindow[]> {
	try {
		const raw = await hyprRequest("j/clients");
		const clients = JSON.parse(raw) as HyprClientRaw[];
		return clients
			.filter(c => c.mapped !== false && !c.hidden)
			.map(c => ({
				id: c.address,
				app: c.class || c.initialClass || "unknown",
				title: c.title || c.initialTitle || "",
				pid: c.pid,
				x: c.at[0],
				y: c.at[1],
				width: c.size[0],
				height: c.size[1],
				focused: c.focusHistoryID === 0,
			}));
	} catch {
		return [];
	}
}

/** Lists all active monitors and their layout geometries from Hyprland IPC. */
export async function hyprListDisplays(): Promise<DesktopDisplay[]> {
	try {
		const raw = await hyprRequest("j/monitors");
		const monitors = JSON.parse(raw) as HyprMonitorRaw[];
		return monitors.map(m => ({
			id: String(m.id),
			name: m.name,
			x: m.x,
			y: m.y,
			width: m.width,
			height: m.height,
			scale: m.scale,
			pixelX: m.x,
			pixelY: m.y,
			pixelWidth: Math.round(m.width * m.scale),
			pixelHeight: Math.round(m.height * m.scale),
			isPrimary: Boolean(m.focused),
		}));
	} catch {
		return [];
	}
}

/** Focuses and raises a window by address using Hyprland's internal dispatcher. */
export async function hyprFocusWindow(address: string): Promise<void> {
	const sanitized = address.startsWith("0x") ? address : `0x${address}`;
	const cmd = `/repl hl.dsp.window.focusaddr({ address = "${sanitized}" })`;
	const reply = await hyprRequest(cmd);
	if (reply.includes("missing address") || reply.includes("error:")) {
		throw new Error(`Failed to focus Hyprland window ${address}: ${reply.trim()}`);
	}
}

/** Captures a screen region or window bounds using grim. */
export function hyprCaptureRegion(
	bounds: { x: number; y: number; width: number; height: number },
	destination: string,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const geometry = `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`;
		const proc = spawn("grim", ["-g", geometry, destination], { stdio: "ignore" });
		proc.on("close", code => {
			if (code === 0) resolve();
			else reject(new Error(`grim exited with code ${code}`));
		});
		proc.on("error", err => {
			reject(err);
		});
	});
}
