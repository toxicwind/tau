import { describe, expect, it } from "bun:test";
import type { ToolSession } from "tau/tools";
import { BashTool, type BashToolInput } from "tau/tools/bash";

function createBashTool(launchEnabled: boolean): BashTool {
	const session = {
		settings: {
			get(key: string) {
				if (key === "launch.enabled") return launchEnabled;
				if (key === "bashInterceptor.enabled") return false;
				if (key === "async.enabled") return false;
				return undefined;
			},
			getBashInterceptorRules() {
				return [];
			},
			getShellConfig: () => ({ shell: "/bin/bash", args: ["-l", "-c"] }),
		},
		getSessionFile: () => undefined,
		getCwd: () => process.cwd(),
		cwd: process.cwd(),
	} as unknown as ToolSession;

	return new BashTool(session);
}

describe("BashTool service-mode guard", () => {
	it("rejects async in service mode (services are backgrounded by name)", () => {
		const tool = createBashTool(true);
		const input: BashToolInput = { command: "sleep 60", name: "svc-a", async: true };
		expect(tool.execute("t", input)).rejects.toThrow(
			"Service mode does not accept async; services are backgrounded by name.",
		);
	});

	it("accepts a top-level timeout alongside a service name (ready.timeout owns readiness)", async () => {
		// The guard used to reject `timeout` outright, conflating "async would
		// double-register the service as a background job" with "timeout is
		// forbidden". A supervised service outlives the call, so the top-level
		// timeout is meaningless — harmless, not an error. Pin the new
		// contract: the call goes through the guard and resolves with a
		// service registration result (the service itself may or may not
		// reach ready inside the call).
		const tool = createBashTool(true);
		const input: BashToolInput = { command: "sleep 60", name: "svc-b", timeout: 5 };
		const result = await tool.execute("t", input);
		const text = result.content.find(block => block.type === "text");
		expect(text).toBeDefined();
		expect(String(text && "text" in text ? text.text : "")).toContain("svc-b");
	});
});
