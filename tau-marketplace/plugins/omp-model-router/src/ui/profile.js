import { DEFAULT_PIN_TIMEOUT_MS } from "../routing/pin";
export const formatDecision = (decision) => {
    return `${decision.profile}: ${decision.tier} -> ${decision.targetProvider}/${decision.targetModelId} [${decision.thinking}] (${decision.reasoning})`;
};
/** Format scoped pin info for widget display. */
export const formatScopedPin = (scope, config) => {
    const pin = scope.scopedPin;
    if (!pin) {
        const floor = config.defaultPin ?? "auto";
        return floor === "auto" ? "auto" : `${floor} (config floor)`;
    }
    const timeout = config.pinTimeout ?? DEFAULT_PIN_TIMEOUT_MS;
    const remaining = timeout - (Date.now() - pin.setAt);
    if (remaining <= 0)
        return "expired";
    const secs = Math.ceil(remaining / 1000);
    const ttl = secs >= 60 ? `${Math.floor(secs / 60)}m${secs % 60 > 0 ? ` ${secs % 60}s` : ""}` : `${secs}s`;
    return `${pin.tier} [${pin.source}] (${ttl})`;
};
export const formatThinkingSummary = (thinkingByProfile) => {
    const entries = Object.entries(thinkingByProfile)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([profile, tierMap]) => {
        const tiers = Object.entries(tierMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([tier, level]) => `${tier}:${level}`);
        return `${profile}(${tiers.join(",")})`;
    });
    return entries.length > 0 ? entries.join(", ") : "none";
};
export const formatModelRef = (ref) => {
    return ref ?? "none";
};
