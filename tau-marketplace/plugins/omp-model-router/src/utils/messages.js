/**
 * Shared message text extraction utilities.
 *
 * Consolidates three near-duplicate implementations that previously lived in
 * routing.ts and calibration/classifier-utils.ts.
 */
/**
 * Extract plain text from message content. Handles both the string and
 * structured-array shapes that `Message["content"]` can take.
 */
export function extractMessageText(content, opts = {}) {
    const { includeThinking = true, includeToolCalls = true, toolCallFormat = "args", maxLength, joiner = "\n" } = opts;
    if (typeof content === "string") {
        return maxLength !== undefined ? content.slice(0, maxLength) : content;
    }
    if (!Array.isArray(content))
        return "";
    const parts = [];
    for (const part of content) {
        if (part.type === "text") {
            if (part.text)
                parts.push(part.text);
        }
        else if (part.type === "thinking" && includeThinking) {
            if (part.thinking)
                parts.push(part.thinking);
        }
        else if (part.type === "toolCall" && includeToolCalls) {
            parts.push(toolCallFormat === "name-only" ? `[tool:${part.name}]` : `${part.name} ${JSON.stringify(part.arguments)}`);
        }
    }
    const joined = parts.join(joiner);
    return maxLength !== undefined ? joined.slice(0, maxLength) : joined;
}
/**
 * Extract text from a full Message object.
 */
export function extractText(msg, opts) {
    return extractMessageText(msg.content, opts);
}
/**
 * Get the last user message text from context (trimmed).
 */
export function getLastUserText(context, opts) {
    for (let i = context.messages.length - 1; i >= 0; i--) {
        const msg = context.messages[i];
        if (msg.role === "user") {
            return extractText(msg, opts).trim();
        }
    }
    return "";
}
/** Category map: tool name → primary bucket. Unlisted names fold into "other". */
const TOOL_CATEGORIES = {
    // exploration
    read: "exploration",
    search: "exploration",
    find: "exploration",
    ast_grep: "exploration",
    lsp_hover: "exploration",
    lsp_references: "exploration",
    lsp_definition: "exploration",
    lsp_symbols: "exploration",
    web_search: "exploration",
    browser: "exploration",
    // implementation
    edit: "implementation",
    write: "implementation",
    ast_edit: "implementation",
    lsp_rename: "implementation",
    lsp_code_actions: "implementation",
    // verification
    debug: "verification",
    // bash is intentionally NOT mapped here — cannot disambiguate test/lint vs. general shell
    // without inspecting arguments. Folds to "other" by default.
    // delegation
    task: "delegation",
    eval: "delegation",
};
const DOMINANCE_THRESHOLD = 0.6;
const TOOL_WINDOW_CAP = 12;
/**
 * Extract recent tool call names from the context window since the last user message.
 *
 * Walks `context.messages` backwards from the end, stopping (exclusive) at the
 * first `role === "user"` message. Collects `block.name` from every `toolCall`
 * block on assistant messages. Returns the most recent TOOL_WINDOW_CAP (12) names
 * in chronological order, plus aggregated counts.
 *
 * **NEVER reads** tool arguments, tool result content, thinking blocks, or text.
 *
 * Single-pass: no intermediate arrays, no flat(), early exit when window is full.
 */
export function extractRecentToolCalls(context) {
    // Collect at most TOOL_WINDOW_CAP names in reverse (most-recent first),
    // then reverse once at the end. No intermediate groups array or .flat().
    const reversed = [];
    outer: for (let i = context.messages.length - 1; i >= 0; i--) {
        const msg = context.messages[i];
        if (msg.role === "user")
            break; // stop at last user message (exclusive)
        if (msg.role !== "assistant")
            continue;
        if (!Array.isArray(msg.content))
            continue;
        // Walk blocks in reverse so the last call in a message is collected first
        // (i.e. we fill the cap with the newest calls across all messages).
        const blocks = msg.content;
        for (let j = blocks.length - 1; j >= 0; j--) {
            const block = blocks[j];
            if (block.type === "toolCall" && typeof block.name === "string" && block.name.length > 0) {
                reversed.push(block.name);
                if (reversed.length === TOOL_WINDOW_CAP)
                    break outer;
            }
        }
    }
    // reversed holds newest-first; restore chronological order.
    reversed.reverse();
    const names = reversed;
    const counts = {};
    for (const name of names) {
        counts[name] = (counts[name] ?? 0) + 1;
    }
    return { counts, names };
}
/**
 * Categorize a tool-call count map into a phase bucket.
 *
 * Applies a 60% dominance threshold: if one named category accounts for
 * ≥60% of all tool calls, that bucket is returned. Otherwise "mixed".
 * Fewer than 2 total calls returns "fresh" (insufficient signal).
 *
 * `bash` is bucketed as "other" (mapped to denominator but cannot win)
 * pending argument-based disambiguation (tracked as Task 7 empirical data).
 */
export function getBucket(counts) {
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    if (total < 2)
        return "fresh";
    const categoryTotals = {};
    for (const [name, count] of Object.entries(counts)) {
        const cat = TOOL_CATEGORIES[name] ?? "other";
        categoryTotals[cat] = (categoryTotals[cat] ?? 0) + count;
    }
    // Find winning named bucket (exploration/implementation/verification/delegation)
    let topCategory = "";
    let topCount = 0;
    for (const cat of ["exploration", "implementation", "verification", "delegation"]) {
        const c = categoryTotals[cat] ?? 0;
        if (c > topCount) {
            topCount = c;
            topCategory = cat;
        }
    }
    if (topCount / total >= DOMINANCE_THRESHOLD) {
        return topCategory;
    }
    return "mixed";
}
