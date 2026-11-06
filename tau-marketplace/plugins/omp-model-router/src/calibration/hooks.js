/**
 * Calibration system lifecycle hooks
 * Wired into OMP extension events: session_start, turn_start, turn_end, session_end
 */
import { initSessionCalibration, loadGlobalCalibration, mergeSessionIntoGlobal, openTraceFile, cancelPendingSave, } from "./index";
import { getCurrentVersion } from "../version-check";
/**
 * session_start: Initialize calibration state
 */
export async function onSessionStart(_event, ctx, state, config) {
    if (!config.calibration?.enabled) {
        state.calibration = undefined;
        return;
    }
    const global = config.calibration.useGlobalPrior ? loadGlobalCalibration() : undefined;
    state.calibration = initSessionCalibration(global, config.calibration);
    if (config.calibration.traceEnabled) {
        const sessionId = `session-${Date.now().toString(36)}`;
        state.calibration.traceFilePath = openTraceFile(sessionId);
    }
    if (state.debugEnabled) {
        ctx.ui.notify(`[calibration] Initialized (mode: ${config.calibration.mode}, warmup: ${config.calibration.warmupTurns})`, "info");
    }
}
/**
 * session_branch: Reset pending state, open new trace file
 */
export async function onSessionBranch(_event, _ctx, state, config) {
    if (!config.calibration?.enabled || !state.calibration) {
        return;
    }
    if (config.calibration.traceEnabled) {
        const sessionId = `branch-${Date.now().toString(36)}`;
        state.calibration.traceFilePath = openTraceFile(sessionId);
    }
}
/**
 * turn_start: Increment turn counter (no polling — results self-record)
 */
export async function onTurnStart(_event, _ctx, state, config) {
    if (!config.calibration?.enabled || !state.calibration) {
        return;
    }
    state.calibration.turnsProcessed++;
}
/**
 * turn_end: No-op
 */
export async function onTurnEnd(_event, _ctx, _state, _config) {
    // no-op
}
/**
 * session_end (not a real event, called from extension cleanup)
 */
export async function onSessionEnd(_event, _ctx, state, config) {
    if (!config.calibration?.enabled || !state.calibration) {
        return;
    }
    cancelPendingSave();
    const cal = state.calibration;
    if (cal.totalComparisons > 0) {
        mergeSessionIntoGlobal(cal, getCurrentVersion(), true);
    }
    state.calibration = undefined;
}
