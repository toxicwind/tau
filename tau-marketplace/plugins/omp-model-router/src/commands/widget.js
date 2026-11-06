export const handleWidget = (state, actions) => async (args, ctx) => {
    const cmd = args[0]?.toLowerCase();
    if (cmd === "on")
        state.widgetEnabled = true;
    else if (cmd === "off")
        state.widgetEnabled = false;
    else
        state.widgetEnabled = !state.widgetEnabled;
    actions.persistState();
    actions.updateStatus(ctx);
    ctx.ui.notify(`Router widget ${state.widgetEnabled ? "enabled" : "disabled"}.`, "info");
};
