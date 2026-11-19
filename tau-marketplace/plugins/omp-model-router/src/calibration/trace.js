import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { getAgentDir } from "tau";
const TRACES_DIR = () => join(getAgentDir(), "model-router", "traces");
/**
 * Open a trace file for a session
 * Returns the file path
 */
export function openTraceFile(sessionId) {
    const dir = TRACES_DIR();
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    const filename = `${sessionId}-calibration.jsonl`;
    const path = join(dir, filename);
    // Create empty file if it doesn't exist
    if (!existsSync(path)) {
        try {
            writeFileSync(path, "", "utf-8");
        }
        catch (error) {
            console.error(`[model-router] Failed to create trace file: ${error}`);
        }
    }
    return path;
}
/**
 * Append a trace record to the file
 */
export function appendTraceRecord(traceFilePath, record) {
    try {
        const line = JSON.stringify(record) + "\n";
        appendFileSync(traceFilePath, line, "utf-8");
    }
    catch (error) {
        console.error(`[model-router] Failed to append trace record: ${error}`);
    }
}
/**
 * Truncate prompt for trace (200 char limit)
 */
export function truncatePrompt(prompt, maxLength = 200) {
    if (prompt.length <= maxLength)
        return prompt;
    return prompt.slice(0, maxLength - 3) + "...";
}
/**
 * Append one classifier prompt+verdict record to classifierPrompt.jsonl.
 * Best-effort: silently swallows write errors.
 */
export async function appendPromptRecord(path, record) {
    try {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, JSON.stringify(record) + "\n", "utf-8");
    }
    catch {
        // best-effort
    }
}
