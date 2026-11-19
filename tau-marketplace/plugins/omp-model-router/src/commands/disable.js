import { patchConfigFile, parseCanonicalModelRef } from "../config";
export const handleDisable = (pi, state, actions) => async (_args, ctx) => {
    if (!state.lastNonRouterModel) {
        ctx.ui.notify("No previous non-router model recorded. Use /model to pick a concrete model.", "warning");
        return;
    }
    const { provider, modelId } = parseCanonicalModelRef(state.lastNonRouterModel);
    const targetModel = ctx.modelRegistry.find(provider, modelId);
    if (!targetModel) {
        ctx.ui.notify(`Recorded non-router model is unavailable: ${state.lastNonRouterModel}`, "error");
        return;
    }
    const success = await pi.setModel(targetModel);
    if (!success) {
        ctx.ui.notify(`Failed to switch to ${state.lastNonRouterModel}`, "error");
        return;
    }
    state.routerEnabled = false;
    patchConfigFile({ routerEnabled: false });
    actions.persistState();
    actions.updateStatus(ctx);
    ctx.ui.notify(`Router disabled. Restored ${state.lastNonRouterModel}`, "info");
};
