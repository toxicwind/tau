/** Build a SelectListTheme from a Theme instance (avoids relying on uninitialized module global). */
export function buildSelectListTheme(theme) {
    const preset = theme.getSymbolPreset();
    const symbols = {
        cursor: theme.nav.cursor,
        inputCursor: preset === "ascii" ? "|" : "\u258f",
        boxRound: theme.boxRound,
        boxSharp: theme.boxSharp,
        table: theme.boxSharp,
        quoteBorder: theme.md.quoteBorder,
        hrChar: theme.md.hrChar,
        spinnerFrames: theme.getSpinnerFrames("activity"),
    };
    return {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("muted", text),
        noMatch: (text) => theme.fg("muted", text),
        symbols,
    };
}
