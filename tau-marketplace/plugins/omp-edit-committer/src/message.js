/** Threshold above which we emit the diagram block. Tuned to err verbose. */
const COMPLEX_HUNK_THRESHOLD = 3;
/** "Complex" path count (multi-file edits usually mean a refactor). */
const MULTI_FILE_THRESHOLD = 2;
const INTENT_VERBS = [
    { token: /\bdrop|remove|delete\b/i, verb: "drop" },
    { token: /\badd|introduce|implement\b/i, verb: "add" },
    { token: /\bfix|repair|patch\b/i, verb: "fix" },
    { token: /\brefactor|restructure|reorganize|rewrite\b/i, verb: "refactor" },
    { token: /\boptimi[sz]e|perf\b/i, verb: "optimize" },
    { token: /\bupdat|adjust|tweak|bump\b/i, verb: "update" },
    { token: /\brenam|move\b/i, verb: "rename" },
    { token: /\bdoc|comment|note\b/i, verb: "docs" },
    { token: /\btest\b/i, verb: "test" },
];
/** Reduce the raw edit event into a {@link DiffSummary}. */
export function summarize(paths, details, perFile) {
    const files = collectDiffs(paths, details, perFile);
    const seen = new Set();
    const unique = [];
    for (const p of paths) {
        if (seen.has(p))
            continue;
        seen.add(p);
        unique.push(p);
    }
    let added = 0;
    let removed = 0;
    let hunks = 0;
    let firstAdded = null;
    let firstRemoved = null;
    let hasStructural = false;
    for (const f of files) {
        for (const line of f.diff.split("\n")) {
            if (line.startsWith("@@")) {
                hunks++;
                continue;
            }
            if (line.startsWith("+++") || line.startsWith("---"))
                continue;
            if (line.startsWith("+")) {
                added++;
                if (firstAdded === null)
                    firstAdded = line.slice(1).trim();
            }
            else if (line.startsWith("-")) {
                removed++;
                if (firstRemoved === null)
                    firstRemoved = line.slice(1).trim();
            }
        }
        // EditToolPerFileResult.op is "create" | "delete" | "update"; the
        // agent uses "update" for plain edits AND for renames, so we
        // only treat create/delete as structural changes. Rename is
        // signalled by `sourcePath` and handled by the diagram block
        // downstream — see EditKind "rename".
        if (f.op === "create" || f.op === "delete")
            hasStructural = true;
    }
    if (details?.op === "create" || details?.op === "delete") {
        hasStructural = true;
    }
    // A rename shows up in the event as `op: "update"` plus a
    // `sourcePath`. Treat it as structural so the Diagram block kicks
    // in for the file-list scaffold.
    if (details?.sourcePath)
        hasStructural = true;
    return {
        paths: unique,
        added,
        removed,
        hunks,
        hasStructuralChange: hasStructural,
        hasMultiFile: unique.length >= MULTI_FILE_THRESHOLD,
        hasManyHunks: hunks >= COMPLEX_HUNK_THRESHOLD,
        firstAddedLine: firstAdded,
        firstRemovedLine: firstRemoved,
    };
}
function collectDiffs(paths, details, perFile) {
    if (perFile && perFile.length > 0) {
        return perFile.map(entry => ({
            path: entry.path,
            diff: entry.diff,
            op: entry.op,
        }));
    }
    if (details) {
        return [
            {
                path: details.path ?? paths[0] ?? "",
                diff: details.diff,
                op: details.op,
            },
        ];
    }
    // `write` tool details is `undefined`; fall back to one entry per path
    // with an empty diff. We still know *which* files were touched.
    return paths.map(p => ({ path: p, diff: "" }));
}
/** Pick the verb that best matches the first added line, if any. */
function detectVerb(added, kind) {
    if (kind === "create")
        return "add";
    if (kind === "delete")
        return "drop";
    if (kind === "rename")
        return "rename";
    if (kind === "write")
        return added ? (firstVerbMatch(added) ?? "update") : "update";
    return added ? (firstVerbMatch(added) ?? "edit") : "edit";
}
function firstVerbMatch(text) {
    for (const { token, verb } of INTENT_VERBS) {
        if (token.test(text))
            return verb;
    }
    return null;
}
/** Short scope derived from paths: directory or filename stem. */
function detectScope(paths) {
    if (paths.length === 0)
        return "config";
    const first = paths[0] ?? "";
    const lastSlash = first.lastIndexOf("/");
    if (paths.length > 1) {
        // Multi-file: prefer the shared directory.
        const dirs = new Set(paths.map(p => p.slice(0, p.lastIndexOf("/"))));
        if (dirs.size === 1) {
            const d = [...dirs][0] ?? "";
            return shortenScope(d) || "config";
        }
        return "multi";
    }
    const stem = first.slice(lastSlash + 1).replace(/\.[^.]+$/, "");
    if (stem)
        return stem;
    return shortenScope(lastSlash > 0 ? first.slice(0, lastSlash) : "") || "config";
}
function shortenScope(scope) {
    if (!scope)
        return "";
    const parts = scope.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? scope;
}
/** Build a 72-char-or-fewer subject line. */
export function buildSubject(summary, kind, intentHint) {
    const verb = detectVerb(summary.firstAddedLine ?? intentHint ?? null, kind);
    const scope = detectScope(summary.paths);
    const subject = intentHint ? sanitizeSubject(intentHint) : summarizeFromDiff(summary, verb);
    return trimSubject(`${verb}(${scope}): ${subject}`);
}
function summarizeFromDiff(summary, verb) {
    const first = summary.firstAddedLine;
    if (first)
        return `${verb} ${first.replace(/\s+/g, " ").slice(0, 64)}`;
    if (summary.firstRemovedLine) {
        return `${verb} ${summary.firstRemovedLine.replace(/\s+/g, " ").slice(0, 64)}`;
    }
    return `${verb} ${summary.paths[0] ?? "file"}`;
}
function sanitizeSubject(text) {
    return text
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[.;:]+$/, "");
}
function trimSubject(s) {
    if (s.length <= 72)
        return s;
    return `${s.slice(0, 69)}...`;
}
/** Build the "Intent" block. Pulls the user's hint when present. */
function buildIntent(intentHint, summary) {
    if (intentHint)
        return [`- ${sanitizeSubject(intentHint)}`];
    if (summary.firstAddedLine)
        return [`- ${sanitizeSubject(summary.firstAddedLine)}`];
    if (summary.hasStructuralChange) {
        return [`- ${summary.paths[0] ?? "file"} ${summary.hunks === 0 ? "structure" : "touched"}`];
    }
    return ["- no semantic change; pure formatting or whitespace"];
}
/**
 * Build the "Trade-offs" block. We always emit at least one bullet — if no
 * automatic signal is present we fall back to "no semantic change" so the
 * reviewer knows the diff is shape-only.
 */
function buildTradeoffs(summary, kind) {
    const out = [];
    if (summary.added === 0 && summary.removed > 0) {
        out.push("- net removal; callers depending on the removed API/symbol will break");
    }
    if (summary.hasMultiFile && !summary.hasStructuralChange) {
        out.push("- spans multiple files; reviewer should confirm coupling between sites");
    }
    if (summary.hasManyHunks) {
        out.push("- many hunks; consider splitting the commit before review");
    }
    if (kind === "create") {
        out.push("- new file; not yet exercised by any caller, so hidden coupling is possible");
    }
    if (kind === "delete") {
        out.push("- the file is gone; no greppable tombstones, search the old name manually");
    }
    if (out.length === 0) {
        out.push("- kept the diff shape minimal; no refactor / no rename / no formatting churn");
    }
    return out;
}
/**
 * Render an ASCII block when the change is "complex" by the heuristics in
 * {@link summarize}. We don't try to derive a *true* control-flow diagram
 * from the diff — that's a job for the LLM at edit time, not the committer.
 * We emit a small, well-defined scaffold the LLM can replace with prose.
 */
function buildDiagram(summary, kind) {
    if (!summary.hasMultiFile && !summary.hasManyHunks && !summary.hasStructuralChange) {
        return [];
    }
    const op = kind === "create"
        ? "create"
        : kind === "delete"
            ? "delete"
            : kind === "rename"
                ? "rename"
                : kind === "write"
                    ? "overwrite"
                    : `edit (+${summary.added}/-${summary.removed})`;
    const lines = ["```", "Edit shape:", "  before           after", "  ───────          ─────"];
    for (const p of summary.paths.slice(0, 4)) {
        lines.push(`  ${p}  ──►  ${op}`);
    }
    if (summary.paths.length > 4) {
        lines.push(`  (+${summary.paths.length - 4} more)`);
    }
    lines.push("```");
    return lines;
}
function buildRefs(summary) {
    const pathList = summary.paths.length > 6
        ? `${summary.paths.slice(0, 6).join(", ")} (+${summary.paths.length - 6} more)`
        : summary.paths.join(", ");
    return `Refs: ${pathList}, +${summary.added}/-${summary.removed}, ${summary.hunks} hunks`;
}
/** Compose the full commit message from a summary. */
export function buildMessage(summary, opts = { kind: "edit" }) {
    const subject = buildSubject(summary, opts.kind, opts.intentHint);
    const sections = [subject, ""];
    const intent = buildIntent(opts.intentHint, summary);
    if (intent.length > 0)
        sections.push("Intent", ...intent, "");
    const tradeoffs = buildTradeoffs(summary, opts.kind);
    if (tradeoffs.length > 0)
        sections.push("Trade-offs", ...tradeoffs, "");
    const diagram = buildDiagram(summary, opts.kind);
    if (diagram.length > 0)
        sections.push("Diagram", ...diagram, "");
    sections.push(buildRefs(summary));
    // Marker so reviewers can grep auto-commits at a glance. The live
    // SHA lives in the TUI badge, not here — see the file header for
    // why we don't try to embed it in the body.
    sections.push("hunk: yes");
    return {
        body: `${sections.join("\n").trimEnd()}\n`,
        subject,
        kind: opts.kind,
        summary,
    };
}
