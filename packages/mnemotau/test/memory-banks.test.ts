import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
<<<<<<< ours — imports `file_header` (F, confidence: medium)
// refused_by: merge_ladder_exhausted · collision: `} from "@oh-my-pi/pi-mnemopi/core/banks";`
import {
	BankManager,
	bankDbPath,
	bankExists,
	createBank,
	deleteBank,
	getBank,
	listBanks,
	resetBankForTests,
	setBank,
	ValueError,
} from "@tau/tau-mnemotau/core/banks";
=======
import { BankManager, bankDbPath, ValueError } from "@oh-my-pi/pi-mnemopi/core/banks";
>>>>>>> theirs — imports `file_header` (F, confidence: medium) · weave: run 'weave explain packages/mnemotau/test/memory-banks.test.ts' for per-hunk detail, 'weave check' to verify your resolution

describe("BankManager", () => {
	it("creates, lists, renames, stats, and deletes isolated bank directories", () => {
		const root = mkdtempSync(join(tmpdir(), "mnemotau-banks-"));
		try {
			const manager = new BankManager(root);
			const dbPath = manager.createBank("work");
			expect(existsSync(dbPath)).toBe(true);
			expect(manager.listBanks()).toEqual(["default", "work"]);
			expect(manager.bankExists("work")).toBe(true);
			expect(manager.getBankDbPath("default")).toBe(join(root, "mnemotau.db"));
			expect(manager.getBankDbPath("work")).toBe(join(root, "banks", "work", "mnemotau.db"));
			expect(manager.getBankStats("work").db_size_bytes).toBeGreaterThanOrEqual(0);
			const renamed = manager.renameBank("work", "project_a");
			expect(renamed).toBe(join(root, "banks", "project_a", "mnemotau.db"));
			expect(manager.bankExists("work")).toBe(false);
			expect(manager.bankExists("project_a")).toBe(true);
			expect(manager.deleteBank("project_a")).toBe(true);
			expect(manager.deleteBank("missing")).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("validates names and protects default deletion", () => {
		const root = mkdtempSync(join(tmpdir(), "mnemotau-banks-"));
		try {
			const manager = new BankManager(root);
			expect(() => manager.createBank("bank with spaces")).toThrow();
			expect(() => manager.createBank("bank/with/slashes")).toThrow();
			expect(() => manager.createBank("bank.with.dots")).toThrow();
			expect(() => manager.getBankDbPath("../escape")).toThrow(ValueError);
			expect(() => manager.deleteBank("../escape", true)).toThrow(ValueError);
			expect(() => bankDbPath("../escape", root)).toThrow(ValueError);
			expect(manager.getBankDbPath("")).toBe(join(root, "mnemotau.db"));
			expect(() => manager.deleteBank("default")).toThrow();
			expect(manager.deleteBank("default", true)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

<<<<<<< ours — scope `it("module-level helpers operate on the reque...` in test_suite `BankManager`, deleted in theirs (S+F, confidence: low)
// refused_by: statement_fold · collision: none (no common ancestor text)
	it("module-level helpers operate on the requested data dir", () => {
		const root = mkdtempSync(join(tmpdir(), "mnemotau-banks-"));
		try {
			const dbPath = createBank("mod_test", root);
			expect(existsSync(dbPath)).toBe(true);
			expect(bankExists("mod_test", root)).toBe(true);
			expect(listBanks(root)).toContain("mod_test");
			expect(deleteBank("mod_test", root)).toBe(true);
			expect(bankExists("mod_test", root)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
=======
>>>>>>> theirs — scope `it("module-level helpers operate on the reque...` deleted in theirs
});
