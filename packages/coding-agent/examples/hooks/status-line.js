export default function (pi) {
    let turnCount = 0;
    pi.on("session_start", async (_event, ctx) => {
        ctx.ui.setStatus("status-demo", "Ready");
    });
    pi.on("turn_start", async (_event, ctx) => {
        turnCount++;
        ctx.ui.setStatus("status-demo", `● Turn ${turnCount}…`);
    });
    pi.on("turn_end", async (_event, ctx) => {
        ctx.ui.setStatus("status-demo", `✓ Turn ${turnCount} complete`);
    });
    pi.on("session_switch", async (event, ctx) => {
        if (event.reason === "new") {
            turnCount = 0;
            ctx.ui.setStatus("status-demo", "Ready");
        }
    });
}
