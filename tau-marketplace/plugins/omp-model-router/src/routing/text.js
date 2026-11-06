/**
 * Text extraction utilities for routing decisions.
 * Re-exports from utils/messages.ts for stable API.
 */
import { extractMessageText, getLastUserText as getLastUserTextUtil } from "../utils/messages.js";
export const extractTextFromContent = extractMessageText;
export const getLastUserText = getLastUserTextUtil;
export const getRecentConversationText = (context, limit = 6) => {
    return context.messages
        .slice(-limit)
        .map(message => extractTextFromContent(message.content).trim())
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
};
/**
 * Get recent user prompts only (for classifier context)
 * Excludes assistant responses and tool results to reduce noise
 */
export const getRecentUserText = (context, limit = 4) => {
    return context.messages
        .filter(message => message.role === "user")
        .slice(-limit)
        .map(message => extractTextFromContent(message.content).trim())
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
};
export const countToolResults = (context) => {
    return context.messages.filter(message => message.role === "toolResult").length;
};
export const countWords = (text) => {
    return text.split(/\s+/).filter(Boolean).length;
};
export const hasImageAttachment = (context) => {
    return context.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === "image"));
};
