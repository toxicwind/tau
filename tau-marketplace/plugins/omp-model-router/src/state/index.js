import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { FALLBACK_CONFIG, resolveProfileName } from "../config";
import { MAX_DEBUG_HISTORY } from "../constants";
import { persist, restoreFromSession, appendDebugEntry } from "./persist";
// ─── RouterState class ────────────────────────────────────────────────────────
export class RouterState {
    // ─── Config & environment ────────────────────────────────────────────
    currentConfig = FALLBACK_CONFIG;
    currentModelRegistry;
    currentCwd = process.cwd();
    /**
     * Set when streamSimple throws an internal error (e.g. registry not ready).
     * Prevents turn_start from permanently disabling the router when OMP falls
     * back to a non-router model due to a transient provider error.
     * Cleared on next successful stream or on session_start.
     */
    lastStreamWasInternalError = false;
    /**
     * Per-session ExtensionContext references, keyed by sessionId.
     * Populated in turn_start, cleared in turn_end.
     * Using a Map instead of a single field prevents parallel sub-agents
     * from clobbering each other's context reference.
     */
    sessionContexts = new Map();
    /** Store ctx for the given session (called from turn_start). */
    setSessionContext(sessionId, ctx) {
        this.sessionContexts.set(sessionId, ctx);
    }
    /** Release ctx for the given session (called from turn_end). */
    clearSessionContext(sessionId) {
        this.sessionContexts.delete(sessionId);
    }
    /** Get ctx for a specific session (used by provider.ts at routing time). */
    getSessionContext(sessionId) {
        return this.sessionContexts.get(sessionId);
    }
    /** Get scope for a specific session without changing activeSessionId. */
    getSessionScope(sessionId) {
        const s = this.sessionScopes.get(sessionId);
        if (s)
            return s;
        // Fallback: activate and return (should not normally happen)
        this.activateSession(sessionId);
        return this.sessionScopes.get(sessionId);
    }
    /** Get ctx for the currently active session (backward-compat helper). */
    get lastExtensionContext() {
        const key = this.activeSessionId ?? "__default__";
        return this.sessionContexts.get(key);
    }
    /** Set ctx for the currently active session (backward-compat for tests and callers). */
    set lastExtensionContext(ctx) {
        // Use activeSessionId if available, otherwise use a stable fallback key
        // so tests that set lastExtensionContext before activateSession still work.
        const key = this.activeSessionId ?? "__default__";
        if (ctx) {
            this.sessionContexts.set(key, ctx);
        }
        else {
            this.sessionContexts.delete(key);
        }
    }
    // ─── Router lifecycle ────────────────────────────────────────────────
    routerEnabled = false;
    selectedProfile;
    isInternalModelSwitch = false;
    // ─── Routing state ───────────────────────────────────────────────────
    thinkingByProfile = {};
    // ─── Session-scoped state (per-session isolation) ───────────────────
    sessionScopes = new Map();
    activeSessionId;
    parentAttributionLogged = new Set();
    // ─── Debug & UI ──────────────────────────────────────────────────────
    debugEnabled = false;
    widgetEnabled = false;
    // ─── Cost & model tracking (shared across scopes for backward compat) ─
    lastNonRouterModel;
    lastRegisteredModels = "";
    // ─── RTK stats (session-level) ──────────────────────────────────────
    /** Number of bash commands rewritten by RTK. */
    rtkRewriteCount = 0;
    /** Whether RTK integration is active (config enabled + binary available). */
    rtkActive = false;
    // ─── Calibration (session-level, ephemeral) ─────────────────────────
    calibration;
    // ─── Auto-upgrade failure tracking (transient, not persisted) ───────
    /** Tracks consecutive failures: toolName → count */
    toolFailureStreak = new Map();
    // ─── Embargo state (global, persisted to disk) ─────────────────────
    /** Model ref → embargo entry. Global across all sessions/profiles. */
    embargoMap = new Map();
    /** Debounce timer for embargo persistence. */
    embargoWriteTimer;
    /** Path to embargo persistence file. */
    get embargoFilePath() {
        return join(this.embargoDir, "model-router-embargo.json");
    }
    get embargoDir() {
        try {
            const { getAgentDir } = require("tau");
            return getAgentDir();
        }
        catch {
            return join(homedir(), ".omp", "agent");
        }
    }
    // ─── Update detection (transient, not persisted) ────────────────────
    updateAvailable;
    updateBannerShown = false;
    // ─── Internal (debounce + persistence state) ────────────────────────
    lastPersistedSnapshot;
    lastPersistTime = 0;
    pendingPersistTimer;
    pi;
    constructor(pi) {
        this.pi = pi;
        this.selectedProfile = resolveProfileName(FALLBACK_CONFIG, FALLBACK_CONFIG.defaultProfile);
    }
    // ─── Session scope management ───────────────────────────────────────
    /**
     * Activate a session scope. Called on session_start/turn_start.
     *
     * Late-binding rule: the **first non-undefined** `parentSessionId` observed
     * for a given `sessionId` wins. A subsequent call with a defined parent
     * will populate the field only if the existing scope's parent is still
     * `undefined`; it NEVER overwrites a parent that was already set.
     *
     * Callers SHOULD pass the parent from the harness's authoritative source:
     * `ctx.sessionManager.getHeader()?.parentSession`. Do not infer parents
     * from heuristics — pass `undefined` if the header is not available and
     * rely on a later activation to late-bind.
     *
     * The optional `source` argument is used only for debug-log attribution
     * (gated on `config.debug`) and has no functional effect.
     *
     * @param sessionId       The session being activated.
     * @param parentSessionId Parent session id from `SessionHeader.parentSession`, if known.
     * @param source          Provenance of `parentSessionId` for diagnostics: "header" |
     *                        "fallback" | "none". Defaults to "none".
     */
    activateSession(sessionId, parentSessionId, source = "none") {
        const previousSessionId = this.activeSessionId;
        this.activeSessionId = sessionId;
        const existing = this.sessionScopes.get(sessionId);
        if (!existing) {
            // ── Sibling carry-forward: when a new session ID appears that shares
            // the same parent as the previously-active scope (e.g. OMP issues a
            // new session ID for a system-reminder retry within the same sub-agent),
            // carry forward accumulated cost/counters so budget enforcement isn't
            // inadvertently bypassed by the ID rotation.
            const previousScope = previousSessionId ? this.sessionScopes.get(previousSessionId) : undefined;
            const isSibling = previousScope && parentSessionId !== undefined && previousScope.parentSessionId === parentSessionId;
            this.sessionScopes.set(sessionId, {
                sessionId,
                parentSessionId,
                accumulatedCost: isSibling ? previousScope.accumulatedCost : 0,
                debugHistory: isSibling ? previousScope.debugHistory : [],
                lastDecision: isSibling ? previousScope.lastDecision : undefined,
                isStreaming: false,
                tierCounter: isSibling ? { ...previousScope.tierCounter } : { high: 0, medium: 0, low: 0 },
                modelCosts: isSibling ? new Map(previousScope.modelCosts) : new Map(),
                // Classifier cache — never carry forward (each session gets a fresh cache)
                lastClassifierKey: undefined,
                lastClassifierVerdict: undefined,
                classifierTurnsSinceRun: 0,
                classifierInvocations: isSibling ? previousScope.classifierInvocations : 0,
                classifierCacheHits: isSibling ? previousScope.classifierCacheHits : 0,
                // Monotonic user-message counter — carry forward for siblings
                // (sibling sessions share the same user message stream)
                userMessagesSeen: isSibling ? previousScope.userMessagesSeen : 0,
                lastUserEntryId: isSibling ? previousScope.lastUserEntryId : undefined,
            });
            if (this.currentConfig.debug && !this.parentAttributionLogged.has(sessionId)) {
                this.parentAttributionLogged.add(sessionId);
                // Schedule removal so the Set doesn't grow forever
                setTimeout(() => this.parentAttributionLogged.delete(sessionId), 60000);
                if (isSibling) {
                    console.log(`[model-router] sibling carry-forward: ${previousSessionId} → ${sessionId} (cost=$${previousScope.accumulatedCost.toFixed(4)})`);
                }
                else if (parentSessionId !== undefined && source === "header") {
                    console.log(`[model-router] parent attribution: child=${sessionId} source=header parent=${parentSessionId}`);
                }
                else if (parentSessionId !== undefined && source === "fallback") {
                    console.log(`[model-router] parent attribution: child=${sessionId} source=fallback parent=${parentSessionId}`);
                }
                else {
                    console.log(`[model-router] parent attribution: child=${sessionId} source=none (root or orphan)`);
                }
            }
        }
        else {
            this.setParentIfAbsent(existing, parentSessionId, sessionId);
        }
        // Evict scopes that are no longer reachable:
        // keep the active scope + any ancestor in its parent chain + any scope
        // that is a direct parent of the current scope (needed for rollup on agent_end).
        // Only evict when the map exceeds a threshold to avoid per-turn overhead.
        if (this.sessionScopes.size > 8) {
            this.evictStaleScopes();
        }
    }
    /**
     * Late-bind a parent session id on an existing scope. Only assigns when the
     * scope's current `parentSessionId` is `undefined` and the incoming value
     * is defined — first non-undefined parent wins.
     */
    setParentIfAbsent(scope, parentSessionId, sessionId) {
        if (scope.parentSessionId === undefined && parentSessionId !== undefined) {
            scope.parentSessionId = parentSessionId;
            if (this.currentConfig.debug) {
                console.log(`[model-router] late-bound parent for ${sessionId}: ${parentSessionId}`);
            }
        }
    }
    /**
     * Evict session scopes that are no longer reachable from the active session.
     * Keeps: active scope + all ancestors in parent chain + any in-flight children
     * whose parentSessionId points to a kept scope (needed for rollup on agent_end).
     * Orphaned / stale sibling scopes that died mid-turn without agent_end are removed.
     */
    evictStaleScopes() {
        // Walk up the parent chain from active scope — everything on that path is reachable
        const reachable = new Set();
        let cursor = this.activeSessionId;
        while (cursor) {
            if (reachable.has(cursor))
                break;
            reachable.add(cursor);
            cursor = this.sessionScopes.get(cursor)?.parentSessionId;
        }
        // Keep in-flight children (parentSessionId in reachable set)
        for (const [id, scope] of this.sessionScopes) {
            if (scope.parentSessionId && reachable.has(scope.parentSessionId)) {
                reachable.add(id);
            }
        }
        // Evict anything not reachable
        for (const id of this.sessionScopes.keys()) {
            if (!reachable.has(id) && id !== "__default__") {
                this.sessionScopes.delete(id);
                if (this.currentConfig.debug) {
                    console.log(`[model-router] evicted stale scope: ${id}`);
                }
            }
        }
    }
    /** Get the active session scope (creates a default if none active). */
    get scope() {
        if (this.activeSessionId) {
            const s = this.sessionScopes.get(this.activeSessionId);
            if (s)
                return s;
        }
        // Fallback: create an ephemeral scope (should not normally happen)
        const fallbackId = "__default__";
        if (!this.sessionScopes.has(fallbackId)) {
            this.activateSession(fallbackId);
        }
        return this.sessionScopes.get(fallbackId);
    }
    /**
     * Finalize a child session scope and merge its aggregable metrics into the parent.
     * Called when a sub-agent completes (`agent_end` event).
     *
     * **Merged fields** (summed into parent):
     *   accumulatedCost, tierCounter (element-wise),
     *   modelCosts (by model key — see {@link mergeModelCosts}).
     *
     * **Skipped fields** (parent retains its own values):
     *   debugHistory, lastDecision — parent's own routing trace.
     *   isStreaming — per-session ephemeral state.
     *   sessionId, parentSessionId — identity fields.
     *
     * If `child.parentSessionId` is `undefined` or the parent scope no longer
     * exists in memory, the child scope is deleted without any rollup. To diagnose
     * missing rollups enable `config.debug` and inspect `[model-router] parent
     * attribution:` log lines from {@link activateSession}.
     */
    finalizeChildSession(childSessionId) {
        const child = this.sessionScopes.get(childSessionId);
        if (!child)
            return;
        const parentId = child.parentSessionId;
        if (parentId) {
            const parent = this.sessionScopes.get(parentId);
            if (parent) {
                // ── numeric sums ─────────────────────────────────────────────
                parent.accumulatedCost += child.accumulatedCost;
                // ── struct sum ───────────────────────────────────────────────
                parent.tierCounter.high += child.tierCounter.high;
                parent.tierCounter.medium += child.tierCounter.medium;
                parent.tierCounter.low += child.tierCounter.low;
                parent.classifierInvocations += child.classifierInvocations;
                parent.classifierCacheHits += child.classifierCacheHits;
                // ── map merge ────────────────────────────────────────────────
                this.mergeModelCosts(parent.modelCosts, child.modelCosts);
                // SKIP: debugHistory, lastDecision — parent retains its own routing trace.
                // SKIP: isStreaming — per-session ephemeral state.
                // SKIP: sessionId, parentSessionId — identity fields.
            }
        }
        // Clean up child scope to free memory
        this.sessionScopes.delete(childSessionId);
    }
    /**
     * Merge source model-cost map into target. For each entry in source:
     * - If absent from target: copy as a new entry (value copy, not reference).
     * - If present: sum all numeric fields in-place; keep target's `tier` label.
     */
    mergeModelCosts(target, source) {
        for (const [key, src] of source) {
            const existing = target.get(key);
            if (existing) {
                existing.invocations += src.invocations;
                existing.inputTokens += src.inputTokens;
                existing.outputTokens += src.outputTokens;
                existing.cacheReadTokens += src.cacheReadTokens;
                existing.cacheWriteTokens += src.cacheWriteTokens;
                existing.cost += src.cost;
                // keep existing.tier — parent's label wins
            }
            else {
                target.set(key, { ...src });
            }
        }
    }
    /** Get total cost across all active session scopes. */
    get totalCost() {
        let total = 0;
        for (const scope of this.sessionScopes.values()) {
            total += scope.accumulatedCost;
        }
        return total;
    }
    /**
     * Aggregate token counts across all active session scopes.
     *
     * Sourced from `scope.modelCosts`, which is populated by
     * `recordModelCost` on each LLM stream completion. This is the authoritative
     * source for billable input/output tokens and cache-write tokens.
     *
     * Child sessions that have already been finalized via `finalizeChildSession`
     * are rolled up into their parent scope before this method is called, so
     * the result already includes sub-agent spend.
     */
    totalTokens() {
        let inputTokens = 0;
        let outputTokens = 0;
        let modelCacheReadTokens = 0;
        let cacheWriteTokens = 0;
        for (const scope of this.sessionScopes.values()) {
            for (const entry of scope.modelCosts.values()) {
                inputTokens += entry.inputTokens;
                outputTokens += entry.outputTokens;
                modelCacheReadTokens += entry.cacheReadTokens;
                cacheWriteTokens += entry.cacheWriteTokens;
            }
        }
        return {
            inputTokens,
            outputTokens,
            modelCacheReadTokens,
            cacheWriteTokens,
            totalBillableInputTokens: inputTokens + modelCacheReadTokens + cacheWriteTokens,
        };
    }
    // ─── Backward-compatible accessors (delegate to active scope) ────────
    get accumulatedCost() {
        return this.scope.accumulatedCost;
    }
    set accumulatedCost(v) {
        this.scope.accumulatedCost = v;
    }
    get debugHistory() {
        return this.scope.debugHistory;
    }
    set debugHistory(v) {
        this.scope.debugHistory = v;
    }
    get lastDecision() {
        return this.scope.lastDecision;
    }
    set lastDecision(v) {
        this.scope.lastDecision = v;
    }
    get isStreaming() {
        return this.scope.isStreaming;
    }
    set isStreaming(v) {
        this.scope.isStreaming = v;
    }
    get tierCounter() {
        return this.scope.tierCounter;
    }
    get modelCosts() {
        return this.scope.modelCosts;
    }
    // ─── Classifier cache accessors (scope-delegating) ───────────────────
    get lastClassifierKey() {
        return this.scope.lastClassifierKey;
    }
    set lastClassifierKey(v) {
        this.scope.lastClassifierKey = v;
    }
    get lastClassifierVerdict() {
        return this.scope.lastClassifierVerdict;
    }
    set lastClassifierVerdict(v) {
        this.scope.lastClassifierVerdict = v;
    }
    get classifierTurnsSinceRun() {
        return this.scope.classifierTurnsSinceRun;
    }
    set classifierTurnsSinceRun(v) {
        this.scope.classifierTurnsSinceRun = v;
    }
    get classifierInvocations() {
        return this.scope.classifierInvocations;
    }
    get classifierCacheHits() {
        return this.scope.classifierCacheHits;
    }
    get userMessagesSeen() {
        return this.scope.userMessagesSeen;
    }
    set userMessagesSeen(v) {
        this.scope.userMessagesSeen = v;
    }
    get lastUserEntryId() {
        return this.scope.lastUserEntryId;
    }
    set lastUserEntryId(v) {
        this.scope.lastUserEntryId = v;
    }
    /** Record a routing decision (tier counter). Called at decision time. */
    recordRoutingDecision(tier) {
        this.scope.tierCounter[tier]++;
    }
    /** Record model cost on stream completion. Called when usage data arrives. */
    recordModelCost(model, tier, usage) {
        const existing = this.scope.modelCosts.get(model);
        if (existing) {
            existing.invocations++;
            existing.inputTokens += usage.inputTokens;
            existing.outputTokens += usage.outputTokens;
            existing.cacheReadTokens += usage.cacheReadTokens;
            existing.cacheWriteTokens += usage.cacheWriteTokens;
            existing.cost += usage.cost;
        }
        else {
            this.scope.modelCosts.set(model, {
                model,
                tier,
                invocations: 1,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                cacheReadTokens: usage.cacheReadTokens,
                cacheWriteTokens: usage.cacheWriteTokens,
                cost: usage.cost,
            });
        }
    }
    recordDecision(decision) {
        const limit = this.currentConfig.debugHistoryLimit ?? MAX_DEBUG_HISTORY;
        if (this.debugHistory.length >= limit)
            this.debugHistory.shift();
        this.debugHistory.push(decision);
        appendDebugEntry(this, decision);
    }
    getThinkingOverride(profileName, tier) {
        return this.thinkingByProfile[profileName]?.[tier];
    }
    // ─── Embargo methods ─────────────────────────────────────────────────
    /**
     * Embargo a model. Sets the entry in the map and triggers debounced persist.
     */
    embargoModel(modelRef, status, reason, durationMs, requestedDurationMs) {
        const now = Date.now();
        const entry = {
            modelRef,
            expiresAt: now + durationMs,
            embargoedAt: now,
            status,
            reason,
            requestedDurationMs,
            effectiveDurationMs: durationMs,
        };
        this.embargoMap.set(modelRef, entry);
        this.persistEmbargo();
    }
    /**
     * Check if a model is currently embargoed (non-expired).
     * Lazily cleans expired entries.
     */
    isEmbargoed(modelRef) {
        const entry = this.embargoMap.get(modelRef);
        if (!entry)
            return false;
        if (Date.now() >= entry.expiresAt) {
            this.embargoMap.delete(modelRef);
            return false;
        }
        return true;
    }
    /**
     * Get remaining embargo time in ms for a model, or 0 if not embargoed.
     */
    getEmbargoTimeRemaining(modelRef) {
        const entry = this.embargoMap.get(modelRef);
        if (!entry)
            return 0;
        const remaining = entry.expiresAt - Date.now();
        if (remaining <= 0) {
            this.embargoMap.delete(modelRef);
            return 0;
        }
        return remaining;
    }
    /**
     * Lift embargo for a model (e.g., on successful stream completion).
     */
    liftEmbargo(modelRef) {
        if (this.embargoMap.delete(modelRef)) {
            this.persistEmbargo();
        }
    }
    /**
     * Get all active (non-expired) embargo entries.
     */
    getActiveEmbargoes() {
        const now = Date.now();
        const active = [];
        for (const [ref, entry] of this.embargoMap) {
            if (now < entry.expiresAt) {
                active.push(entry);
            }
            else {
                this.embargoMap.delete(ref);
            }
        }
        return active;
    }
    /**
     * Clear all embargoes.
     */
    clearAllEmbargoes() {
        this.embargoMap.clear();
        this.persistEmbargo();
    }
    /**
     * Get the model ref with the soonest expiry from a list of model refs.
     * Used for deadlock prevention when all models are embargoed.
     */
    getSoonestExpiry(modelRefs) {
        let soonest;
        let soonestTime = Infinity;
        for (const ref of modelRefs) {
            const entry = this.embargoMap.get(ref);
            if (entry && entry.expiresAt < soonestTime) {
                soonestTime = entry.expiresAt;
                soonest = ref;
            }
        }
        return soonest;
    }
    /**
     * Persist embargo map to disk (debounced 100ms).
     */
    persistEmbargo() {
        if (this.embargoWriteTimer)
            clearTimeout(this.embargoWriteTimer);
        this.embargoWriteTimer = setTimeout(() => {
            this.embargoWriteTimer = undefined;
            try {
                const dir = this.embargoDir;
                if (!existsSync(dir))
                    mkdirSync(dir, { recursive: true });
                const data = {};
                for (const [ref, entry] of this.embargoMap) {
                    if (entry.expiresAt > Date.now()) {
                        data[ref] = entry;
                    }
                }
                writeFileSync(this.embargoFilePath, JSON.stringify(data, null, 2));
            }
            catch {
                // Best-effort persistence — never throw
            }
        }, 100);
    }
    /**
     * Restore embargo map from disk. Discards expired entries.
     * Safe to call multiple times (idempotent).
     */
    restoreEmbargo() {
        try {
            const filePath = this.embargoFilePath;
            if (!existsSync(filePath))
                return;
            const raw = readFileSync(filePath, "utf-8");
            const data = JSON.parse(raw);
            const now = Date.now();
            for (const [ref, entry] of Object.entries(data)) {
                if (entry && typeof entry.expiresAt === "number" && entry.expiresAt > now) {
                    this.embargoMap.set(ref, entry);
                }
            }
        }
        catch {
            // Missing or corrupt file — start with empty map
        }
    }
    persist() {
        persist(this);
    }
    restoreFromSession(ctx) {
        restoreFromSession(this, ctx);
    }
}
// Re-exports from persist module
export { buildPersistedState, isRouterPersistedState } from "./persist";
