import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
const cache = new Map();
export function loadPitfalls(cwd, overridePath) {
    const candidates = [];
    if (overridePath)
        candidates.push(resolve(overridePath));
    candidates.push(resolve(cwd, "model-router-pitfalls.md"));
    candidates.push(join(homedir(), ".omp", "agent", "model-router", "pitfalls.md"));
    for (const p of candidates) {
        const cached = cache.get(p);
        if (cached !== undefined)
            return cached;
        if (existsSync(p)) {
            try {
                const content = readFileSync(p, "utf8").trim();
                cache.set(p, content);
                return content;
            }
            catch {
                return "";
            }
        }
    }
    return "";
}
export function clearPitfallsCache() {
    cache.clear();
}
