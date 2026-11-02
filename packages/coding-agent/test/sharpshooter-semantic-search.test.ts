import { describe, expect, it } from "bun:test";
import { semanticSearch, type SemanticSearchLine } from "tau/sharpshooter/semantic-search";

const LINES: SemanticSearchLine[] = [
	{ content: "Keep storage project-scoped.", source: "architecture.md" },
	{ content: "Prefer explicit user controls.", source: "product.md" },
	{ content: "Keep output concise.", source: "style.md" },
];

// Deterministic test double (offline/CI-safe): token-overlap-aligned vectors
// so cosine measures REAL semantic proximity (shared tokens => high cosine).
// The estate production lane is freeinference bge-m3 (free, unlimited, 99.9%);
// see the live integration test below for the real-lane proof.
function fakeEmbed(texts: readonly string[]): Promise<number[][]> {
	return Promise.resolve(
		texts.map(text => {
			const v: number[] = [];
			// Basis per token: "storage" => index 0, "user" => 1, "concise" => 2, "keep" => 3.
			const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
			for (let i = 0; i < 4; i++) v.push(tokens.includes(["storage", "user", "concise", "keep"][i]!) ? 1 : 0);
			return v;
		}),
	);
}

describe("sharpshooter semantic search", () => {
	it("returns top-k lines ranked by cosine similarity", async () => {
		const hits = await semanticSearch("where should storage live", LINES, {}, { embed: fakeEmbed, limit: 2 });
		expect(hits.length).toBeGreaterThan(0);
		// The storage line must appear first: its fingerprint is closer to the
		// query's fingerprint than the controls/concise lines under the injectable
		// embedder's deterministic hash-space.
		expect(hits[0]?.content).toContain("storage");
	});

	it("falls back to substring when embed lane throws (prior behavior preserved)", async () => {
		const hits = await semanticSearch(
			"storage",
			LINES,
			{ apiUrl: "http://127.0.0.1:1", apiKey: "k", model: "bge-m3" },
			{
				embed: async () => {
					throw new Error("lane down");
				},
			},
		);
		// Real contract: embed failure degrades to the legacy substring search,
		// never an empty false-negative. "storage" matches the storage line.
		expect(hits.map((h) => h.content)).toContain("Keep storage project-scoped.");
	});

	it("respects the threshold (weak matches filtered)", async () => {
		const strict = await semanticSearch("zzz unmatched", LINES, {}, { embed: fakeEmbed, threshold: 0.99, limit: 5 });
		expect(strict.length).toBe(0);
	});

	it("returns [] for an empty line set", async () => {
		const hits = await semanticSearch("anything", [], {}, { embed: fakeEmbed });
		expect(hits).toEqual([]);
	});

	it("ranks real decision lines semantically via the live freeinference bge-m3 lane (skips offline)", async () => {
		const key = Bun.env.FREEINFERENCE_API_KEY ?? await Bun.$`secretsmith env`.text().then((env) =>
			env.match(/FREEINFERENCE_API_KEY='([^']+)'/)?.[1],
		).catch(() => undefined);
		if (!key) {
			console.log("SKIP: no FREEINFERENCE_API_KEY");
			return;
		}
		const cfg = { apiUrl: "https://freeinference.org/v1", model: "bge-m3", apiKey: key };
		const hits = await semanticSearch(
			"how should browser storage be scoped",
			[{ content: "Keep storage project-scoped.", file: "architecture.md" }, { content: "Use bright theme accents.", file: "style.md" }],
			cfg,
			{ limit: 1 },
		);
		// bge-m3 must place the storage decision above the style decision for a
		// storage-query — semantic relevance, not substring (style line has no "storage").
		expect(hits[0]?.content).toContain("storage");
	});
});