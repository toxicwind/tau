import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import { scanSkillsFromDir } from "tau/discovery/helpers";

/**
 * Real-world estate wiring test: the built-in skill systems of BOTH tau and
 * kappa must discover the live azurite skill roots — the categorized
 * `skills/` dir, the auto-learn `managed-skills/` dir, and the private
 * `private-skills/` dir. This pins the symlink/config chain that actually
 * runs in wezterm sessions, not a fixture.
 *
 * Wires under test:
 *   ~/.tau/skills        -> azurite/skills          (symlink)
 *   ~/.kappa/skills      -> azurite/skills          (symlink)
 *   ~/.tau/agent/managed-skills -> azurite/managed-skills (symlink)
 *   kappa.jsonc skills.customDirectories -> the three dirs above
 */
const AZURITE = "/home/toxic/pens/geode/products/azurite";
const ROOTS = {
	categorized: path.join(AZURITE, "skills"),
	managed: path.join(AZURITE, "managed-skills"),
	private: path.join(AZURITE, "private-skills"),
} as const;

async function names(dir: string): Promise<string[]> {
	const { items } = await scanSkillsFromDir(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		{} as any,
		{ dir, providerId: "test", level: "user", requireDescription: true, recursive: true },
	);
	return items.map((s: { name: string }) => s.name).sort();
}

describe("estate azurite skill wiring (tau + kappa built-in discovery)", () => {
	it("resolves ~/.tau/skills and ~/.kappa/skills to the same azurite root", () => {
		const tauResolved = fs.realpathSync("/home/toxic/.tau/skills");
		const kappaResolved = fs.realpathSync("/home/toxic/.kappa/skills");
		expect(tauResolved).toBe(AZURITE + "/skills");
		expect(kappaResolved).toBe(tauResolved);
	});

	it("discovers categorized skills (184 SKILL.md) with no warnings", async () => {
		const { items, warnings } = await scanSkillsFromDir(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			{} as any,
			{ dir: ROOTS.categorized, providerId: "test", level: "user", requireDescription: true, recursive: true },
		);
		expect(items.length).toBeGreaterThan(100);
		expect(warnings).toEqual([]);
	});

	it("discovers managed skills (incl. taas re-auth helper)", async () => {
		const n = await names(ROOTS.managed);
		// The managed skill minted this session must be discoverable.
		expect(n).toContain("taas-telegram-reauth-nagram");
		// And the auto-learn catalog broadly.
		expect(n.length).toBeGreaterThan(30);
	});

	it("discovers private skills with their internal names only", async () => {
		const n = await names(ROOTS.private);
		expect(n).toContain("repo-public-private");
		expect(n).toContain("github-repo-polish");
		// The surfaced (managed) list must NOT expose the private-jargon names.
		const managed = await names(ROOTS.managed);
		expect(managed.some(x => x.includes("star-whore"))).toBe(false);
	});

	it("kappa customDirectories config references all three live roots", async () => {
		const raw = await Bun.file("/home/toxic/.kappa/kappa.jsonc").text();
		for (const root of Object.values(ROOTS)) {
			expect(raw).toContain(root);
		}
	});

	it("every root is a real directory on disk (wezterm runtime can read it)", () => {
		for (const [k, dir] of Object.entries(ROOTS)) {
			expect(fs.existsSync(dir), k).toBe(true);
		}
	});
});