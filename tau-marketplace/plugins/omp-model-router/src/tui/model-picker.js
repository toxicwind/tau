import { Input, SelectList, TabBar, fuzzyFilter, replaceTabs, truncateToWidth, } from "@oh-my-pi/pi-tui";
import { buildSelectListTheme } from "./shared.js";
/** Tabs by id; ALL is the unfiltered scope. Rest derived from models. */
function buildTabs(models) {
    const providers = [...new Set(models.map(m => m.provider))].sort();
    const tabs = [{ id: "all", label: "ALL" }];
    for (const p of providers) {
        tabs.push({ id: p, label: p.toUpperCase() });
    }
    return tabs;
}
/**
 * Convert a `Model` from the registry into a `ModelItem` for the picker.
 * Skips router/* virtual models.
 */
function modelToItem(model) {
    if (model.provider === "router")
        return undefined;
    return {
        provider: model.provider,
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        costInput: model.cost?.input,
        costOutput: model.cost?.output,
    };
}
function collectModels(registry) {
    if (!registry)
        return [];
    const available = registry.getAvailable();
    const out = [];
    for (const m of available) {
        const item = modelToItem(m);
        if (item)
            out.push(item);
    }
    return out;
}
function ctxLabel(contextWindow) {
    const k = Math.floor(contextWindow / 1000);
    if (k >= 1000 && k % 1000 === 0)
        return `${k / 1000}M`;
    if (k >= 1000)
        return `${(k / 1000).toFixed(1)}M`;
    return `${k}k`;
}
function costLabel(input, output) {
    if (input == null || output == null)
        return "cost unknown";
    const fmt = (n) => (Number.isInteger(n) ? `${n}` : n.toFixed(2));
    return `$${fmt(input)}/$${fmt(output)}`;
}
function modelMeta(contextWindow, costInput, costOutput) {
    return `${ctxLabel(contextWindow)} ctx ${costLabel(costInput, costOutput)}`;
}
/**
 * ModelPickerComponent — single-select model browser with provider TabBar +
 * fuzzy search + badge column showing primary/fallback assignment for the
 * tier under edit. Returns the picked model ref via `done(modelRef)` or
 * `done(undefined)` on cancel.
 */
export class ModelPickerComponent {
    #theme;
    #keybindings;
    #done;
    #tabBar;
    #searchInput;
    #tier;
    #currentPrimary;
    #currentFallbacks;
    #models;
    #scope = "all";
    #filtered;
    #selectedIndex = 0;
    #selectList;
    constructor(_tui, theme, keybindings, done, options) {
        this.#theme = theme;
        this.#keybindings = keybindings;
        this.#done = done;
        this.#tier = options.tier;
        this.#currentPrimary = options.currentPrimary;
        this.#currentFallbacks = options.currentFallbacks ?? [];
        this.#models = options.models ?? collectModels(options.modelRegistry);
        this.#tabBar = new TabBar("Provider", buildTabs(this.#models), {
            label: text => theme.fg("muted", text),
            activeTab: text => theme.fg("accent", text),
            inactiveTab: text => theme.fg("muted", text),
            hint: text => theme.fg("muted", text),
        }, 0);
        this.#tabBar.onTabChange = (tab) => {
            this.#scope = tab.id;
            this.#applyFilter();
        };
        this.#searchInput = new Input();
        this.#searchInput.focused = true;
        this.#filtered = [...this.#models];
        this.#filtered = [...this.#models];
        this.#selectList = undefined; // Lazy init in render()
    }
    render(width) {
        // Lazy init SelectList on first render (when theme is available)
        if (!this.#selectList) {
            this.#selectList = this.#buildSelectList();
        }
        const t = this.#theme;
        const lines = [];
        // Header
        const tierLabel = this.#tier.toUpperCase();
        const currentName = this.#currentPrimaryName();
        const headerLeft = `Pick model for ${tierLabel}`;
        const headerRight = currentName ? t.fg("muted", `(current: ${currentName})`) : "";
        lines.push(headerRight ? `${headerLeft}  ${headerRight}` : headerLeft);
        lines.push("");
        // TabBar
        for (const tabLine of this.#tabBar.render(width)) {
            lines.push(tabLine);
        }
        lines.push("");
        // Search input
        const inputLines = this.#searchInput.render(width - 2);
        lines.push(`> ${inputLines[0] ?? ""}`);
        lines.push("");
        // SelectList with badge column overlay
        const listLines = this.#renderList(width);
        for (const line of listLines)
            lines.push(line);
        // Footer detail
        lines.push("");
        lines.push(this.#renderFooterDetail());
        lines.push("");
        // Hint line
        lines.push(t.fg("muted", "type filter · TAB scope · ↑↓ navigate · ENTER pick · ESC cancel"));
        return lines.map(line => truncateToWidth(replaceTabs(line), width));
    }
    handleInput(data) {
        // 1. TabBar (consumes Tab/Shift+Tab/arrow when relevant)
        if (this.#tabBar.handleInput(data))
            return;
        const kb = this.#keybindings;
        // 2. Cancel
        if (kb.matches(data, "tui.select.cancel")) {
            this.#done(undefined);
            return;
        }
        // 3. Navigation
        if (kb.matches(data, "tui.select.up")) {
            this.#moveUp();
            return;
        }
        if (kb.matches(data, "tui.select.down")) {
            this.#moveDown();
            return;
        }
        // 4. Confirm
        if (kb.matches(data, "tui.select.confirm")) {
            const picked = this.#highlighted();
            if (picked)
                this.#done(`${picked.provider}/${picked.id}`);
            return;
        }
        // 5. Everything else → search input
        this.#searchInput.handleInput(data);
        this.#applyFilter();
    }
    invalidate() {
        // No-op: this component has no persistent rendering cache.
        // Re-rendering is driven solely by input state mutations.
    }
    // ───────────────────────── internals ─────────────────────────
    #highlighted() {
        return this.#filtered[this.#selectedIndex];
    }
    #moveUp() {
        if (this.#filtered.length === 0)
            return;
        this.#selectedIndex = (this.#selectedIndex - 1 + this.#filtered.length) % this.#filtered.length;
    }
    #moveDown() {
        if (this.#filtered.length === 0)
            return;
        this.#selectedIndex = (this.#selectedIndex + 1) % this.#filtered.length;
    }
    #applyFilter() {
        const query = this.#searchInput.getValue();
        const scoped = this.#scope === "all" ? this.#models : this.#models.filter(m => m.provider === this.#scope);
        const next = query ? fuzzyFilter([...scoped], query, m => `${m.provider}/${m.id} ${m.name}`) : [...scoped];
        this.#filtered = next;
        this.#selectedIndex = Math.min(this.#selectedIndex, Math.max(0, next.length - 1));
    }
    #currentPrimaryName() {
        if (!this.#currentPrimary)
            return undefined;
        const match = this.#findItem(this.#currentPrimary);
        if (match)
            return match.name;
        // Fall back to last segment of the ref so the header still says something useful.
        const slash = this.#currentPrimary.lastIndexOf("/");
        return slash >= 0 ? this.#currentPrimary.slice(slash + 1) : this.#currentPrimary;
    }
    #findItem(ref) {
        const slash = ref.indexOf("/");
        if (slash < 0)
            return undefined;
        const provider = ref.slice(0, slash);
        const id = ref.slice(slash + 1);
        return this.#models.find(m => m.provider === provider && m.id === id);
    }
    #badgeFor(item) {
        const ref = `${item.provider}/${item.id}`;
        if (ref === this.#currentPrimary) {
            const text = "[primary]";
            return { text, styled: this.#theme.fg("accent", text) };
        }
        const fbIndex = this.#currentFallbacks.indexOf(ref);
        if (fbIndex >= 0) {
            const text = `[fallback ${fbIndex + 1}]`;
            return { text, styled: this.#theme.fg("muted", text) };
        }
        return { text: "", styled: "" };
    }
    #renderList(width) {
        const t = this.#theme;
        if (this.#filtered.length === 0) {
            return [t.fg("muted", "  (no matches)")];
        }
        // Bounded viewport — 8 visible rows, scroll window around selection.
        const maxVisible = 8;
        const total = this.#filtered.length;
        let start = 0;
        if (total > maxVisible) {
            const half = Math.floor(maxVisible / 2);
            start = Math.max(0, Math.min(total - maxVisible, this.#selectedIndex - half));
        }
        const end = Math.min(total, start + maxVisible);
        const lines = [];
        for (let i = start; i < end; i++) {
            const item = this.#filtered[i];
            const isSelected = i === this.#selectedIndex;
            const badge = this.#badgeFor(item);
            const cursor = isSelected ? t.fg("accent", "❯ ") : "  ";
            const primary = `${item.provider}/${item.id}`;
            const meta = modelMeta(item.contextWindow, item.costInput, item.costOutput);
            const badgeSuffix = badge.styled ? ` ${badge.styled}` : "";
            const body = isSelected
                ? `${t.fg("accent", primary)} ${t.fg("muted", `· ${meta}`)}${badgeSuffix}`
                : `${primary} ${t.fg("muted", `· ${meta}`)}${badgeSuffix}`;
            lines.push(`${cursor}${body}`);
        }
        // Scroll info
        lines.push(t.fg("muted", `  (${this.#selectedIndex + 1}/${total})`));
        return lines;
    }
    #renderFooterDetail() {
        const item = this.#highlighted();
        if (!item)
            return this.#theme.fg("muted", "  (no model selected)");
        const meta = `${item.name} · ${item.provider} · ${modelMeta(item.contextWindow, item.costInput, item.costOutput)}`;
        return `  ${this.#theme.fg("muted", meta)}`;
    }
    #buildSelectList() {
        // Held for parity with spec composition; rendering is done manually so
        // the badge column lines up exactly. The instance is kept around so
        // future refactors can delegate viewport/scroll logic to it without
        // changing the public surface.
        const items = this.#models.map(m => ({
            value: `${m.provider}/${m.id}`,
            label: `${m.provider}/${m.id}`,
            description: modelMeta(m.contextWindow, m.costInput, m.costOutput),
        }));
        return new SelectList(items, 8, buildSelectListTheme(this.#theme));
    }
}
/**
 * Factory matching the omp custom component signature.
 *
 * @example
 * ```ts
 * const ref = await ctx.ui.custom<string | undefined>((tui, theme, kb, done) =>
 *   createModelPicker(tui, theme, kb, done, { tier: "high", modelRegistry, currentPrimary }),
 * );
 * ```
 */
export function createModelPicker(tui, theme, keybindings, done, options) {
    return new ModelPickerComponent(tui, theme, keybindings, done, options);
}
