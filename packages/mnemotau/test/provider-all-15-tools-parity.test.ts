import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleToolCall, TOOLS } from "@tau/tau-mnemotau/mcp-tools";

let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "mnemotau-ts-provider-parity-"));
	process.env.MNEMOTAU_DATA_DIR = dataDir;
	process.env.MNEMOTAU_NO_EMBEDDINGS = "1";
	delete process.env.MNEMOTAU_MCP_BANK;
	delete process.env.MNEMOTAU_SHARED_SURFACE_DB;
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	delete process.env.MNEMOTAU_DATA_DIR;
	delete process.env.MNEMOTAU_NO_EMBEDDINGS;
	delete process.env.MNEMOTAU_MCP_BANK;
	delete process.env.MNEMOTAU_SHARED_SURFACE_DB;
});

describe("provider all-tools parity", () => {
	it("registers the Python provider-compatible tool surface with valid JSON schemas", () => {
		const names = TOOLS.map(tool => tool.name);
		expect(names).toHaveLength(23);
		for (const name of [
			"mnemotau_remember",
			"mnemotau_recall",
			"mnemotau_sleep",
			"mnemotau_stats",
			"mnemotau_invalidate",
			"mnemotau_validate",
			"mnemotau_get",
			"mnemotau_triple_add",
			"mnemotau_triple_query",
			"mnemotau_scratchpad_write",
			"mnemotau_scratchpad_read",
			"mnemotau_scratchpad_clear",
			"mnemotau_export",
			"mnemotau_update",
			"mnemotau_forget",
			"mnemotau_import",
			"mnemotau_diagnose",
			"mnemotau_shared_remember",
			"mnemotau_shared_recall",
			"mnemotau_shared_forget",
			"mnemotau_shared_stats",
			"mnemotau_graph_query",
			"mnemotau_graph_link",
		]) {
			expect(names).toContain(name);
		}
		for (const tool of TOOLS) {
			const roundTripped = JSON.parse(JSON.stringify(tool.inputSchema)) as { type: string };
			expect(roundTripped.type).toBe("object");
		}
	});

	it("returns user-facing argument errors instead of mutating on missing arguments", async () => {
		for (const [name, args, expected] of [
			["mnemotau_remember", {}, "content is required"],
			["mnemotau_recall", {}, "query is required"],
			["mnemotau_scratchpad_write", { content: "" }, "content is required"],
			["mnemotau_update", { memory_id: "missing-id" }, "content or importance is required"],
			["mnemotau_forget", {}, "memory_id is required"],
			["mnemotau_export", {}, "output_path is required"],
			["mnemotau_import", {}, "Either input_path (for file import) is required"],
		] as const) {
			const result = await handleToolCall(name, args);
			expect(result.error).toBe(expected);
		}
	});

	it("exports provider data to a file and imports it into a fresh isolated bank", async () => {
		const remembered = await handleToolCall("mnemotau_remember", {
			content: "source provider memory for import parity",
			importance: 0.7,
			bank: "source",
		});
		expect(remembered.status).toBe("stored");
		await handleToolCall("mnemotau_scratchpad_write", {
			content: "portable provider scratch",
			bank: "source",
		});

		const exportPath = join(dataDir, "provider-export.json");
		const exported = await handleToolCall("mnemotau_export", {
			output_path: exportPath,
			bank: "source",
		});
		expect(exported.status).toBe("exported");
		expect(existsSync(exportPath)).toBe(true);
		const payload = JSON.parse(readFileSync(exportPath, "utf8")) as { working_memory?: unknown[] };
		expect(payload.working_memory?.length).toBe(1);

		const imported = await handleToolCall("mnemotau_import", { input_path: exportPath, bank: "dest" });
		expect(imported.status).toBe("imported");
		expect(JSON.stringify(imported.stats)).toContain("inserted");
		const recalled = await handleToolCall("mnemotau_recall", {
			query: "import parity",
			bank: "dest",
			limit: 5,
		});
		expect(recalled.count as number).toBeGreaterThanOrEqual(1);
	});

	it("diagnose, validate, graph, and shared handlers return structured provider results", async () => {
		const remembered = await handleToolCall("mnemotau_remember", {
			content: "validate me through provider parity",
			bank: "ops",
		});
		const memoryId = remembered.memory_id as string;
		const validate = await handleToolCall("mnemotau_validate", {
			memory_id: memoryId,
			action: "attest",
			validator: "test",
			bank: "ops",
		});
		expect(validate.status).toBe("validation_attest");
		const diagnose = await handleToolCall("mnemotau_diagnose", { bank: "ops" });
		expect(diagnose.status).toBe("ok");
		expect(diagnose.db_path).toContain("banks/ops/mnemotau.db");
		const graphQuery = await handleToolCall("mnemotau_graph_query", { seed_memory_id: memoryId, bank: "ops" });
		expect(graphQuery).toMatchObject({
			status: "ok",
			seed_memory_id: memoryId,
			count: 0,
			results_count: 0,
			results: [],
			related_memories: [],
			bank: "ops",
		});
		expect(
			await handleToolCall("mnemotau_graph_link", {
				source_id: memoryId,
				target_id: "other",
				relationship: "related",
				bank: "ops",
			}),
		).toMatchObject({
			status: "linked",
			source_id: memoryId,
			target_id: "other",
			relationship: "related",
			edge_type: "related",
			weight: 0.5,
			bank: "ops",
		});

		const shared = await handleToolCall("mnemotau_shared_remember", {
			content: "Prefer concise parity notes",
			kind: "preference",
		});
		expect(shared.status).toBe("stored_shared");
		expect((await handleToolCall("mnemotau_shared_forget", { memory_id: shared.memory_id })).status).toBe("deleted");
	}, 30_000);
});
