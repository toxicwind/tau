import { profileNames } from "../config";
export const handleReload = (state, actions) => async (_args, ctx) => {
    actions.reloadConfig(ctx, { preserveDebug: true });
    await actions.ensureValidActiveRouterProfile(ctx);
    ctx.ui.notify(`Router config reloaded. Profiles: ${profileNames(state.currentConfig).join(", ")}`, "info");
};
