import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { getAgentDir } from "tau";
import { resolveProfileName } from "../config";
// ─── Type guard for deserialization ──────────────────────────────────────────
export const isRouterPersistedState = (value) => {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const v = value;
    return typeof v.enabled === "boolean" && typeof v.selectedProfile === "string" && typeof v.timestamp === "number";
};
// ─── Persistent state file helpers ─────────────────────────────────────────
const loadPersistentState = () => {
    try {
        const dir = join(getAgentDir(), "model-router");
        const file = join(dir, "router-state.json");
        if (!existsSync(file))
            return null;
        const raw = readFileSync(file, "utf-8");
        const data = JSON.parse(raw);
        return isRouterPersistedState(data) ? data : null;
    }
    catch {
        return null;
    }
};
const savePersistentState = (state) => {
    try {
        const dir = join(getAgentDir(), "model-router");
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        const file = join(dir, "router-state.json");
        writeFileSync(file, JSON.stringify(state, null, 2), "utf-8");
    }
    catch {
        // Silently fail - state will retry on next persist
    }
};
// ─── Debug file helpers ────────────────────────────────────────────────────
/**
 * Derive the `.debug.jsonl` path from the current session file path.
 * Returns `undefined` when sessions are disabled (no session file).
 */
const debugFilePath = (state) => {
    const sessionFile = state.lastExtensionContext?.sessionManager.sessionFile;
    if (!sessionFile)
        return undefined;
    // Replace trailing .jsonl with .debug.jsonl; handles any extension gracefully.
    return sessionFile.endsWith(".jsonl")
        ? sessionFile.slice(0, -".jsonl".length) + ".debug.jsonl"
        : sessionFile + ".debug.jsonl";
};
/**
 * Append a single routing decision to the session-paired `.debug.jsonl` file.
 * Each line is a self-contained JSON object:
 *   { "turn": <userMessagesSeen>, "ts": <timestamp>, ...RoutingDecision }
 *
 * Called from `recordDecision()` at write-time so the file is always current
 * regardless of whether `debugVerbose` is set. The main session JSONL never
 * carries `debugHistory` data — only a count reference.
 */
export const appendDebugEntry = (state, decision) => {
    const file = debugFilePath(state);
    if (!file)
        return;
    try {
        const dir = dirname(file);
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        appendFileSync(file, JSON.stringify({ turn: state.userMessagesSeen, ...decision }) + "\n");
    }
    catch {
        // Never surface debug write errors to the user.
    }
};
// ─── Persistence logic ─────────────────────────────────────────────────────
/** Minimum interval between session entry writes (ms) */
export const PERSIST_DEBOUNCE_MS = 1000;
export const buildPersistedState = (state) => ({
    enabled: state.routerEnabled,
    selectedProfile: state.selectedProfile,
    thinkingByProfile: { ...state.thinkingByProfile },
    debugEnabled: state.debugEnabled,
    widgetEnabled: state.widgetEnabled,
    debugHistory: state.debugHistory,
    lastPhase: state.lastDecision?.phase,
    lastDecision: state.lastDecision,
    lastNonRouterModel: state.lastNonRouterModel,
    accumulatedCost: state.accumulatedCost,
    timestamp: Date.now(),
});
const persistNow = (state) => {
    const persisted = buildPersistedState(state);
    const snapshot = JSON.stringify({
        ...persisted,
        timestamp: 0,
        lastDecision: persisted.lastDecision ? { ...persisted.lastDecision, timestamp: 0 } : undefined,
        debugHistory: persisted.debugHistory?.map(d => ({
            ...d,
            timestamp: 0,
        })),
    });
    if (snapshot === state.lastPersistedSnapshot)
        return;
    state.lastPersistTime = Date.now();
    // Save to persistent file (survives session restart)
    savePersistentState(persisted);
    // Append a lean router-state entry to the session JSONL when debugVerbose
    // is enabled. debugHistory is intentionally omitted — decisions are written
    // individually to the paired .debug.jsonl file by appendDebugEntry(), keeping
    // the main session file small. Only a count is included so readers can see
    // how many decisions were made without loading the full history.
    if (state.currentConfig.debugVerbose) {
        try {
            const { debugHistory: _dropped, ...leanPersisted } = persisted;
            state.pi.appendEntry("router-state", {
                ...leanPersisted,
                debugHistoryCount: persisted.debugHistory?.length ?? 0,
            });
        }
        catch {
            // Runtime not yet initialized. Skip silently.
        }
    }
    state.lastPersistedSnapshot = snapshot;
};
export const persist = (state) => {
    const now = Date.now();
    const elapsed = now - state.lastPersistTime;
    // Debounce: if we persisted less than 1s ago, schedule a deferred write
    if (elapsed < PERSIST_DEBOUNCE_MS) {
        if (!state.pendingPersistTimer) {
            state.pendingPersistTimer = setTimeout(() => {
                state.pendingPersistTimer = undefined;
                persistNow(state);
            }, PERSIST_DEBOUNCE_MS - elapsed);
        }
        return;
    }
    persistNow(state);
};
export const restoreFromSession = (state, ctx) => {
    // NOTE: lastExtensionContext is intentionally NOT assigned here.
    // Storing ctx during session_start/branch pins the full ExtensionContext
    // (including sessionManager with the entire JSONL branch tree) in heap for
    // the lifetime of the session — on parallel subagent workloads this causes
    // N × full-context live objects to accumulate simultaneously.
    // lastExtensionContext is assigned ONLY by turn_start (and cleared by turn_end),
    // which correctly bounds its lifetime to one turn.
    state.currentModelRegistry = ctx.modelRegistry;
    state.currentCwd = ctx.cwd;
    // ─── Source of truth for enabled/profile is the config file ─────
    state.routerEnabled = state.currentConfig.routerEnabled ?? false;
    state.selectedProfile = resolveProfileName(state.currentConfig, state.currentConfig.defaultProfile);
    // ─── Reset session-scoped state ─────────────────────────────────
    state.thinkingByProfile = {};
    state.widgetEnabled = false;
    state.debugHistory = [];
    // NOTE: Do NOT reset accumulatedCost, tierCounter, modelCosts here.
    // These are session-scoped metrics that persist across /reload.
    // They are only zero-initialized when activateSession() creates a NEW scope.
    state.lastNonRouterModel =
        ctx.model && ctx.model.provider !== "router" ? `${ctx.model.provider}/${ctx.model.id}` : state.lastNonRouterModel;
    state.lastDecision = undefined;
    // ─── Restore session-level preferences from saved state ─────────
    // (pins, thinking overrides, widget, debug history, cost, etc.)
    const persistedState = loadPersistentState();
    // Scan only the tail of the branch (last 20 entries) for a router-state
    // snapshot. Scanning the full branch is O(N) over potentially hundreds of
    // entries and forces the entire session tree into RAM. The last router-state
    // entry is always near the tail, so a small tail window is sufficient.
    const branch = ctx.sessionManager.getBranch();
    const tail = branch.length > 20 ? branch.slice(-20) : branch;
    const sessionState = tail
        .filter(entry => entry.type === "custom" && entry.customType === "router-state")
        .map(entry => entry.data)
        .reduce((acc, data) => (isRouterPersistedState(data) ? data : acc), null);
    const savedState = sessionState ?? persistedState;
    if (isRouterPersistedState(savedState)) {
        // Do NOT restore enabled/selectedProfile from state — config is authoritative
        // Pins are NO LONGER persisted — scoped pins are memory-only and session-scoped.
        state.thinkingByProfile = savedState.thinkingByProfile ? { ...savedState.thinkingByProfile } : {};
        state.debugEnabled = savedState.debugEnabled ?? state.debugEnabled;
        state.widgetEnabled = savedState.widgetEnabled ?? state.widgetEnabled;
        // debugHistory is session-scoped and NOT restored — usage ledger is
        // the authoritative source for /router usage. debugHistory only shows
        // the last N routing decisions for debugging purposes.
        state.lastNonRouterModel = savedState.lastNonRouterModel ?? state.lastNonRouterModel;
        // Accumulated metrics (cost, tokens, cache) are session-scoped and
        // intentionally NOT restored from persisted state. They always start at 0
        // for each new session to accurately reflect the current session's usage.
    }
};
