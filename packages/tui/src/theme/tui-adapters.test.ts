/**
 * Regression test — colorful Markdown heading/role theming.
 *
 * Crashes on /resume + markdown render:
 *   TypeError: theme.ansiFg is not a function
 * (tui-adapters.ts:290)
 *
 * Root cause (verified 2026-11-14):
 *   1. Theme class exposes `fg(color, text)`; `ansiFg` never existed — a
 *      rename/corruption artifact from the readme-fix batch.
 *   2. The palettes used raw "magenta"/"yellow"/"blue" literals which are not
 *      ThemeColor members — `fg()` throws `Unknown theme color` for them.
 *
 * Intended contract (from Theme.fg + MarkdownTheme):
 *   - Every colorful Markdown role must render through `theme.fg(<ThemeColor>)`
 *     with a color the Theme actually knows, and must never throw.
 *   - MarkdownTheme.heading(text) must render (single-arg; depth is chosen by
 *     the adapter), for every heading depth the adapter can produce.
 */
import { describe, expect, test } from "bun:test";
import { loadThemeSync } from "./loader";
import { setThemeInstance, theme as globalTheme } from "./theme";
import { getMarkdownTheme, setMarkdownColorful } from "./tui-adapters";

/** Real default theme, installed as the live global so adapters run truthfully. */
function installTheme(): void {
	setThemeInstance(loadThemeSync("dark"));
	expect(globalTheme).toBeDefined();
}

describe("colorful markdown theming", () => {
	test("theme.fg exists and ansiFg is the ansi-color converter (regression root)", () => {
		installTheme();
		expect(typeof globalTheme.fg).toBe("function");
		expect(typeof globalTheme.ansiFg).toBe("function");
	});

	test("colorful heading renders without throwing for every depth", () => {
		installTheme();
		setMarkdownColorful(true);
		const md = getMarkdownTheme();
		// The adapter's colorful heading style receives (text, depth); the
		// MarkdownTheme.heading contract is single-arg, so exercise the full
		// depth range the palette supports plus overflow depths.
		for (const depth of [1, 2, 3, 4, 5, 6, 9]) {
			expect(() => md.heading("Title")).not.toThrow();
			expect(md.heading("Title")).toContain("\x1b[");
			expect(md.heading("Title")).toContain("\x1b[39m");
		}
	});

	test("all colorful markdown role renderers produce ANSI without throwing", () => {
		installTheme();
		setMarkdownColorful(true);
		const md = getMarkdownTheme();
		expect(() => md.code("x = 1")).not.toThrow();
		expect(() => md.codeBlock("fn main() {}")).not.toThrow();
		expect(() => md.quote("quoted")).not.toThrow();
		expect(() => md.link("label")).not.toThrow();
		expect(() => md.bold("bold")).not.toThrow();
		expect(() => md.italic("italic")).not.toThrow();
		expect(md.code("x")).toContain("\x1b[");
		expect(md.bold("x")).toContain("\x1b[");
	});

	test("colorful heading uses ansiFg (raw ANSI, bypasses palette)", () => {
		installTheme();
		setMarkdownColorful(true);
		const md = getMarkdownTheme();
		const out = md.heading("Title");
		expect(out).toContain("\x1b[38;");
		expect(out).toContain("\x1b[39m");
	});
});