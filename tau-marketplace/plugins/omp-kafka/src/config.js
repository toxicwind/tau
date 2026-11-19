/**
 * Config loader for omp-kafka.
 *
 * Resolution order (first hit wins):
 *   1. `KAFKA_CONFIG` env var (absolute path).
 *   2. `<cwd>/kafka.yml`.
 *   3. `<cwd>/.omp/kafka.yml`.
 *   4. `~/.omp/agent/kafka.yml`.
 *
 * The file is parsed with the `yaml` package for full YAML support.
 * A JSON file (`.kafka.json` or any `.json`) is parsed with `JSON.parse`.
 *
 * The loader is intentionally strict: an unknown shape, a duplicate
 * consumer name, or a missing `brokers`/`topics` array all throw. The
 * factory catches and reports the error, then runs the extension in
 * disabled mode.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { parse as parseYaml } from "yaml";
const DEFAULTS = {
    clientId: "omp-kafka",
    fromBeginning: false,
    notify: true,
    maxQueue: 200,
    autoDeliverAs: "steer",
};
/** Public entry point. Returns an empty `config` on any error. */
export async function loadConfig(cwd, env = process.env) {
    const errors = [];
    const source = resolveConfigPath(cwd, env);
    if (!source) {
        return {
            config: [],
            source: null,
            errors: ["no kafka.yml found and KAFKA_CONFIG not set"],
        };
    }
    let raw;
    try {
        const text = await readText(source);
        raw = source.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
    }
    catch (err) {
        errors.push(`failed to parse ${source}: ${err.message}`);
        return { config: [], source, errors };
    }
    const validated = validate(raw, errors);
    if (errors.length > 0) {
        return { config: [], source, errors };
    }
    const seen = new Set();
    const resolved = [];
    for (const c of validated.consumers) {
        if (seen.has(c.name)) {
            errors.push(`duplicate consumer name: ${c.name}`);
            continue;
        }
        seen.add(c.name);
        resolved.push(applyDefaults(c));
    }
    if (resolved.length === 0) {
        errors.push("kafka.yml contains no consumers");
    }
    return { config: resolved, source, errors };
}
function resolveConfigPath(cwd, env) {
    const candidates = [];
    if (env.KAFKA_CONFIG) {
        candidates.push(isAbsolute(env.KAFKA_CONFIG) ? env.KAFKA_CONFIG : resolvePath(cwd, env.KAFKA_CONFIG));
    }
    candidates.push(resolvePath(cwd, "kafka.yml"));
    candidates.push(resolvePath(cwd, ".omp", "kafka.yml"));
    candidates.push(resolvePath(homedir(), ".omp", "agent", "kafka.yml"));
    return candidates.find(c => existsSync(c)) ?? null;
}
async function readText(path) {
    if (typeof Bun !== "undefined")
        return Bun.file(path).text();
    return readFileSync(path, "utf8");
}
// --- Validation ------------------------------------------------------------
function validate(raw, errors) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push("top-level must be a mapping");
        return { consumers: [] };
    }
    const root = raw;
    const consumersRaw = root.consumers;
    if (!Array.isArray(consumersRaw)) {
        errors.push("missing or non-array `consumers`");
        return { consumers: [] };
    }
    const consumers = [];
    consumersRaw.forEach((entry, idx) => {
        const path = `consumers[${idx}]`;
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
            errors.push(`${path}: must be a mapping`);
            return;
        }
        const e = entry;
        if (typeof e.name !== "string" || e.name.length === 0) {
            errors.push(`${path}.name: required string`);
            return;
        }
        if (e.mode !== "auto" && e.mode !== "pull") {
            errors.push(`${path}.mode: must be "auto" or "pull"`);
            return;
        }
        if (!Array.isArray(e.brokers) ||
            e.brokers.length === 0 ||
            !e.brokers.every(b => typeof b === "string" && b.length > 0)) {
            errors.push(`${path}.brokers: required non-empty array of strings`);
            return;
        }
        if (!Array.isArray(e.topics) ||
            e.topics.length === 0 ||
            !e.topics.every(t => typeof t === "string" && t.length > 0)) {
            errors.push(`${path}.topics: required non-empty array of strings`);
            return;
        }
        consumers.push(e);
    });
    return { consumers };
}
function applyDefaults(c) {
    return {
        name: c.name,
        mode: c.mode,
        brokers: c.brokers.slice(),
        clientId: c.clientId ?? DEFAULTS.clientId,
        groupId: c.groupId ?? `omp-kafka-${c.name}`,
        topics: c.topics.slice(),
        fromBeginning: c.fromBeginning ?? DEFAULTS.fromBeginning,
        notify: c.notify ?? DEFAULTS.notify,
        maxQueue: c.maxQueue ?? DEFAULTS.maxQueue,
        auto: {
            deliverAs: c.auto?.deliverAs ?? DEFAULTS.autoDeliverAs,
            prefix: c.auto?.prefix ?? `[kafka:${c.name}] `,
        },
        sasl: c.sasl,
        ssl: c.ssl ?? false,
        clientConfig: c.clientConfig ?? {},
    };
}
// Re-export for embedders.
export { parseYaml };
