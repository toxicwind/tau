import type { ExtensionAPI, ExtensionContext } from "tau";
import { existsSync, readFileSync } from "node:fs";

// ============================================================================
// IN-PROCESS MITM MOBILE AUTOCORRECT ENGINE (OH-MY-PI / TAU RUNTIME)
// ============================================================================
// Solves Android terminal emulator (Termux, ConnectBot) virtual keyboard
// NO_SUGGESTIONS limitation by providing an in-process, sub-5ms, domain-aware
// Man-in-the-Middle autocorrect middleware that corrects prose QWERTY slips
// while rigorously protecting code, flags, paths, URLs, and identifiers.

// ============================================================================
// 1. QWERTY KEYBOARD SPATIAL TOPOLOGY
// ============================================================================

interface Point {
  x: number;
  y: number;
}

const QWERTY_LAYOUT: Record<string, Point> = {
  // Row 0
  q: { x: 0.0, y: 0 }, w: { x: 1.0, y: 0 }, e: { x: 2.0, y: 0 }, r: { x: 3.0, y: 0 },
  t: { x: 4.0, y: 0 }, y: { x: 5.0, y: 0 }, u: { x: 6.0, y: 0 }, i: { x: 7.0, y: 0 },
  o: { x: 8.0, y: 0 }, p: { x: 9.0, y: 0 },
  // Row 1
  a: { x: 0.5, y: 1 }, s: { x: 1.5, y: 1 }, d: { x: 2.5, y: 1 }, f: { x: 3.5, y: 1 },
  g: { x: 4.5, y: 1 }, h: { x: 5.5, y: 1 }, j: { x: 6.5, y: 1 }, k: { x: 7.5, y: 1 },
  l: { x: 8.5, y: 1 },
  // Row 2
  z: { x: 1.5, y: 2 }, x: { x: 2.5, y: 2 }, c: { x: 3.5, y: 2 }, v: { x: 4.5, y: 2 },
  b: { x: 5.5, y: 2 }, n: { x: 6.5, y: 2 }, m: { x: 7.5, y: 2 },
};

function getSpatialSubstitutionCost(c1: string, c2: string): number {
  if (c1 === c2) return 0.0;
  const p1 = QWERTY_LAYOUT[c1.toLowerCase()];
  const p2 = QWERTY_LAYOUT[c2.toLowerCase()];
  if (!p1 || !p2) return 1.0;

  const dx = p1.x - p2.x;
  const dy = (p1.y - p2.y) * 1.25; // 1.25x vertical penalty reflecting thumb sweep ergonomics
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Direct horizontal neighbor: ~0.25; diagonal neighbor: ~0.34; distant: capped at 1.0
  return Math.min(1.0, dist * 0.25);
}

// ============================================================================
// 2. PROTECTED DEV TERMS & IMMUTABLE IDENTIFIERS
// ============================================================================

const PROTECTED_DEV_TERMS: Record<string, true> = {
  md: true, ts: true, js: true, py: true, rs: true, go: true, sh: true,
  sql: true, css: true, html: true, git: true, cd: true, ls: true, rm: true,
  cp: true, mv: true, cat: true, df: true, ps: true, ui: true, id: true,
  ip: true, os: true, vm: true, pr: true, ci: true, io: true, ai: true,
  llm: true, mcp: true, rpc: true, tui: true, cli: true, sdk: true, api: true,
  url: true, uri: true, jwt: true, env: true, json: true, yaml: true, yml: true,
  toml: true, diff: true, npm: true, pnpm: true, bun: true, bunx: true, tsc: true,
  pip: true, cargo: true, docker: true, sudo: true, curl: true, ssh: true,
  tau: true, omp: true, vim: true, sed: true, awk: true, zsh: true, bash: true,
  tar: true, zip: true, gzip: true, grep: true, glob: true, ast: true, nix: true, bazel: true,
};

// ============================================================================
// 3. CODING & GENERAL LEXICON (IN-MEMORY EMBEDDED)
// ============================================================================

const VOCABULARY = [
  // Blueprint baseline words
  "figure", "out", "what", "the", "diff", "difference", "between", "each",
  "keys", "key", "are", "and", "make", "file", "after", "you", "update",
  "all", "to", "convention", "conventions", "check", "fix", "clean",
  "refactor", "run", "test", "build", "commit", "branch", "create", "delete",
  "remove", "show", "list", "inspect", "audit", "header", "headers", "service",
  "services", "upstream", "token", "pool", "proxy", "config", "type", "types",
  "about", "above", "across", "again", "almost", "already", "also", "always",
  "before", "better", "cannot", "change", "could", "first", "found", "from",
  "have", "here", "into", "just", "like", "look", "more", "most", "need",
  "only", "other", "please", "read", "same", "some", "that", "then", "there",
  "these", "they", "this", "time", "under", "used", "want", "well", "were",
  "will", "with", "would", "write",
  // Sovereign estate, agents & infrastructure
  "sovereign", "estate", "ranch", "stockyard", "barn", "flock", "herd",
  "yote", "openfang", "tau", "omp", "kimi", "pitchfork", "mise", "cell",
  "bridge", "hatch", "quill", "shrew", "trailboss", "effusion", "oracle",
  "market", "btrfs", "fclones", "flicker", "telemetry", "runtime", "harness",
  "gatehouse", "sentinel", "smithers", "somasays", "corral", "router",
  "keypool", "keypools", "secret", "secrets", "vault", "model", "models",
  "provider", "providers", "subagent", "subagents", "agent", "agents",
  "turn", "session", "sessions", "prompt", "prompts", "context", "stream",
  "streaming",
  // Development actions & CLI terms
  "moved", "move", "moving", "adds", "added", "adding", "fix", "fixes",
  "fixed", "fixing", "patch", "patches", "patched", "patching", "edit",
  "edits", "edited", "editing", "code", "coding", "repo", "repos",
  "repository", "repositories", "pull", "pulls", "pulled", "pulling",
  "push", "pushes", "pushed", "pushing", "fetch", "clone", "status",
  "stash", "rebase", "merge", "merges", "merged", "merging", "checkout",
  "stage", "staged", "unstage", "untracked", "commits", "committed",
  "committing", "diffs", "log", "logs", "reset", "revert", "tag", "tags",
  "remote", "origin", "main", "master", "head", "install", "installs",
  "installed", "installing", "setup", "deploy", "deploying", "deployed",
  "server", "servers", "client", "clients", "daemon", "daemons", "process",
  "processes", "worker", "workers", "job", "jobs", "pipeline", "script",
  "scripts", "command", "commands", "flag", "flags", "option", "options",
  "arg", "args", "argument", "arguments", "param", "params", "parameter",
  "parameters", "function", "functions", "method", "methods", "class",
  "classes", "interface", "interfaces", "module", "modules", "package",
  "packages", "import", "imports", "imported", "importing", "export",
  "exports", "exported", "exporting", "return", "returns", "returned",
  "returning", "value", "values", "variable", "variables", "constant",
  "constants", "const", "let", "var", "async", "await", "promise",
  "promises", "callback", "callbacks", "handler", "handlers", "event",
  "events", "listen", "listener", "listeners", "emit", "emits", "emitted",
  "emitting", "dispatch", "dispatched", "dispatching", "error", "errors",
  "warn", "warns", "warning", "warnings", "info", "debug", "trace",
  "exception", "exceptions", "fail", "fails", "failed", "failing",
  "failure", "failures", "pass", "passes", "passed", "passing", "success",
  "successful", "timeout", "timeouts", "timed", "retry", "retries",
  "retried", "retrying", "loop", "loops", "iterate", "iterating",
  "iteration", "array", "arrays", "object", "objects", "string", "strings",
  "number", "numbers", "boolean", "booleans", "null", "undefined", "void",
  "never", "any", "unknown", "schema", "schemas", "database", "databases",
  "table", "tables", "record", "records", "row", "rows", "column", "columns",
  "field", "fields", "query", "queries", "select", "insert", "updates",
  "updated", "updating", "deletes", "deleted", "deleting", "drop",
  "truncate", "index", "indexes", "indices", "primary", "foreign", "unique",
  "cascade", "transaction", "transactions", "rollback", "migrate",
  "migration", "migrations", "sqlite", "postgres", "mysql", "redis",
  "socket", "sockets", "port", "ports", "host", "hosts", "network",
  "header", "body", "payload", "response", "responses", "request",
  "requests", "endpoint", "endpoints", "route", "routes", "routing",
  "middleware", "gateway", "gateways", "proxies", "reverse", "forward",
  "traffic", "rate", "limit", "limits", "limiting", "auth", "authentication",
  "authorization", "bearer", "cookie", "cookies", "login", "logout",
  "user", "users", "password", "public", "private", "hash", "hashes",
  "digest", "sign", "signed", "signature", "signatures", "verify",
  "verifies", "verified", "verifying", "verification", "encrypt", "decrypt",
  "encryption", "decryption", "cert", "certificate", "certificates",
  "ssl", "tls", "pair", "root", "base", "path", "paths", "dir", "directory",
  "directories", "folder", "folders", "filename", "extension",
  "link", "links", "symlink", "symlinks", "target", "source", "dest",
  "destination", "append", "seek", "open", "close", "flush", "sync",
  "pipe", "chunk", "buffer", "buffers", "line", "lines", "char", "chars",
  "character", "characters", "word", "words", "text", "syntax", "parser",
  "parsers", "parse", "parses", "parsed", "parsing", "lexer", "lexical",
  "tokenize", "tokenizer", "ast", "node", "nodes", "tree", "trees",
  "leaf", "child", "children", "parent", "sibling", "depth", "breadth",
  "traverse", "traversal", "walk", "visitor", "visit", "compile", "compiler",
  "transpile", "transpiler", "bundle", "bundler", "minify", "map", "builds",
  "testing", "spec", "specs", "suite", "suites", "unit", "integration",
  "assert", "assertion", "assertions", "expect", "mock", "mocks", "stub",
  "stubs", "spy", "fixture", "fixtures", "coverage", "benchmark",
  "benchmarks", "profile", "profiler", "profiling", "perf", "performance",
  "memory", "leak", "heap", "stack", "cpu", "gpu", "vram", "disk",
  "latency", "throughput", "speed", "fast", "slow", "quick", "optimize",
  "optimizes", "optimized", "optimizing", "optimization", "refactors",
  "refactored", "refactoring", "cleanup", "tidy", "prune", "pruning",
  "format", "formatter", "lint", "linter", "rules", "rule", "policy",
  "policies", "guard", "checks", "checked", "checking", "audits", "audited",
  "auditing", "inspects", "inspected", "inspecting", "explore", "search",
  "match", "matches", "matched", "matching", "replace", "replaces",
  "replaced", "replacing", "filter", "filters", "filtered", "filtering",
  "sort", "sorted", "sorting", "group", "grouped", "grouping", "count",
  "counts", "sum", "avg", "min", "max", "total", "summary", "overview",
  "report", "reports", "reported", "reporting", "issue", "issues", "bug",
  "bugs", "defect", "defects", "flaw", "flaws", "vulnerability",
  "vulnerabilities", "security", "safe", "safety", "danger", "dangerous",
  "block", "blocks", "blocked", "blocking", "allow", "allows", "allowed",
  "allowing", "deny", "denies", "denied", "denying", "grant", "reject",
  "skip", "skips", "skipped", "skipping", "ignore", "ignores", "ignored",
  "ignoring", "drops", "dropped", "dropping", "stop", "stops", "stopped",
  "stopping", "start", "starts", "started", "starting", "begin", "finish",
  "done", "complete", "completed", "completing", "completion", "ready",
  "waiting", "waits", "waited", "idle", "busy", "active", "alive", "dead",
  "kill", "killed", "killing", "spawn", "spawns", "spawned", "spawning",
  "forks", "forked", "forking", "exec", "execute", "executes", "executed",
  "executing", "execution", "runs", "ran", "running", "call", "calls",
  "called", "calling", "invoke", "invokes", "invoked", "invoking",
  "invocation",
  // Common conversational & instructional vocabulary
  "yes", "no", "not", "sure", "ok", "okay", "fine", "cool", "great", "good",
  "bad", "best", "worse", "worst", "new", "old", "latest", "recent", "next",
  "prev", "previous", "following", "current", "now", "today", "yesterday",
  "tomorrow", "often", "usually", "rarely", "maybe", "perhaps", "probably",
  "definitely", "certainly", "indeed", "actually", "really", "truly",
  "simply", "still", "yet", "once", "twice", "nearly", "quite", "very",
  "much", "many", "less", "least", "few", "little", "bit", "lot", "lots",
  "both", "every", "either", "neither", "none", "several", "such",
  "whatever", "which", "whichever", "who", "whoever", "whom", "whose",
  "where", "wherever", "when", "whenever", "why", "how", "however",
  "because", "since", "though", "although", "even", "while", "whereas",
  "unless", "until", "till", "if", "whether", "else", "otherwise", "so",
  "therefore", "thus", "hence", "besides", "furthermore", "moreover",
  "instead", "rather", "meanwhile", "finally", "lastly", "second", "third",
  "during", "among", "through", "throughout", "along", "around", "behind",
  "beyond", "inside", "outside", "within", "without", "below", "over",
  "onto", "upon", "toward", "towards", "by", "for", "against", "of", "at",
  "on", "in", "off", "up", "down", "back", "away", "together", "apart",
  "aside", "ahead", "backward", "everywhere", "nowhere", "somewhere",
  "anywhere", "those", "it", "its", "them", "their", "theirs", "we", "us",
  "our", "ours", "your", "yours", "he", "him", "his", "she", "her",
  "hers", "me", "my", "mine", "one", "ones", "self", "selves", "be", "am",
  "is", "was", "been", "being", "has", "had", "having", "do", "does",
  "did", "doing", "say", "says", "said", "saying", "tell", "tells", "told",
  "telling", "ask", "asks", "asked", "asking", "answer", "answers",
  "answered", "answering", "reply", "replies", "replied", "replying",
  "speak", "talk", "hear", "see", "sees", "saw", "seen", "seeing",
  "looks", "looked", "looking", "watch", "shows", "showed", "shown",
  "showing", "finds", "finding", "give", "gives", "gave", "given",
  "giving", "take", "takes", "took", "taken", "taking", "get", "gets",
  "got", "gotten", "getting", "put", "puts", "putting", "makes", "made",
  "making", "go", "goes", "went", "gone", "come", "comes", "came",
  "coming", "leave", "keep", "keeps", "kept", "keeping", "lets",
  "letting", "help", "helps", "helped", "helping", "needs", "needed",
  "needing", "wants", "wanted", "wanting", "wish", "hope", "think",
  "thinks", "thought", "thinking", "know", "knows", "knew", "known",
  "knowing", "understand", "understood", "understanding", "learn",
  "remember", "forget", "feel", "seem", "appear", "become", "try",
  "tries", "tried", "trying", "attempt", "uses", "using", "work", "works",
  "worked", "working", "live", "stand", "turns", "turned", "turning",
  "mean", "means", "meant", "meaning", "sets", "setting", "meet",
  "include", "includes", "included", "including", "continue", "changes",
  "changed", "changing", "lead", "creates", "created", "creating",
  "spend", "grow", "opens", "opened", "opening", "walk", "win", "offer",
  "love", "consider", "buy", "serve", "sends", "sent", "sending",
  "stay", "fall", "cuts", "reach", "remain", "suggest", "raise", "sell",
  "require", "requires", "required", "requiring", "decide", "break",
  "breaks", "broke", "broken", "breaking", "explain", "explains",
  "explained", "explaining", "detail", "details", "detailed", "example",
  "examples", "sample", "samples", "step", "steps", "phases", "stages",
  "part", "parts", "piece", "pieces", "item", "items", "named", "naming",
  "thing", "things", "way", "ways", "case", "cases", "fact", "facts",
  "point", "points", "end", "ends", "side", "sides", "place", "places",
  "state", "states", "system", "systems", "world", "problem", "problems",
  "solution", "solutions", "question", "questions", "idea", "ideas",
  "reason", "reasons", "result", "results", "power", "level", "levels",
  "order", "orders", "form", "forms", "view", "views", "group", "groups",
  "team", "teams", "person", "people", "hand", "hands", "head", "heads",
  "face", "mind", "heart", "eye", "eyes", "hour", "hours", "day", "days",
  "week", "weeks", "month", "months", "year", "years", "figure",
  "figures", "cost", "costs", "price", "term", "terms", "book", "books",
  "page", "pages", "paper", "papers", "room", "house", "area", "areas",
  "space", "spaces", "game", "kind", "kinds", "matter", "matters", "care",
  "differences"
];

const DICTIONARY: Set<string> = new Set([
  ...VOCABULARY,
  ...Object.keys(PROTECTED_DEV_TERMS)
]);

// Whitelist of all valid English words and developer terms (never corrected)
const VALID_WORDS: Set<string> = new Set([
  ...DICTIONARY,
  "or", "an", "as", "at", "be", "by", "do", "go", "he", "if", "in", "is", "it",
  "me", "my", "no", "of", "on", "so", "to", "up", "us", "we", "fence", "fences",
  "stay", "stays", "stayed", "staying", "touch", "touched", "untouched", "hence"
]);

try {
  const dictPath = "/usr/share/dict/cracklib-small";
  if (existsSync(dictPath)) {
    const lines = readFileSync(dictPath, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const w = lines[i].trim().toLowerCase();
      if (w.length >= 2) VALID_WORDS.add(w);
    }
  }
} catch {
  // Fallback to embedded vocabulary if dict is absent
}

// Length-bucketed index for sub-millisecond candidate lookup
const LENGTH_BUCKETS: Map<number, string[]> = new Map();
for (const word of DICTIONARY) {
  const len = word.length;
  let list = LENGTH_BUCKETS.get(len);
  if (!list) {
    list = [];
    LENGTH_BUCKETS.set(len, list);
  }
  list.push(word);
}

// ============================================================================
// 4. TOKEN CLASSIFIER (PROTECTED CODE VS PROSE)
// ============================================================================

enum TokenType {
  PROTECTED_CODE,
  PROSE_WORD,
  PUNCTUATION_OR_WHITESPACE,
}

function classifyToken(token: string): TokenType {
  // Whitespace & single punctuation
  if (/^\s+$/.test(token) || /^[^\w\s]$/.test(token)) {
    return TokenType.PUNCTUATION_OR_WHITESPACE;
  }

  // Inline code / backtick blocks: `diff`, `foo bar`
  if (/^`[^`]*`$/.test(token)) {
    return TokenType.PROTECTED_CODE;
  }

  // URLs & URIs: http://..., https://..., skill://..., ssh://..., file://...
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+$/.test(token)) {
    return TokenType.PROTECTED_CODE;
  }

  // CLI flags: -p, --noEmit, -rf, --dry-run
  if (/^-{1,2}[a-zA-Z0-9_-]+$/.test(token)) {
    return TokenType.PROTECTED_CODE;
  }

  // File paths and filenames: pool.js, ./src/index.ts, tsconfig.json, foo/bar
  if (
    /^(\.{0,2}\/)?[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(token) ||
    /^(\.{0,2}\/)?[\w.-]+\.[a-zA-Z0-9]+$/.test(token)
  ) {
    return TokenType.PROTECTED_CODE;
  }

  // Mixed identifiers: camelCase, snake_case, SCREAMING_SNAKE, digits: authHeader, bg_9, utf8
  if (/[a-z][A-Z]/.test(token) || /_/.test(token) || /\d/.test(token)) {
    return TokenType.PROTECTED_CODE;
  }

  // Known developer tool names / abbreviations (e.g. md, ts, js, git, bunx, etc.)
  if (PROTECTED_DEV_TERMS[token.toLowerCase()]) {
    return TokenType.PROTECTED_CODE;
  }

  // Pure alphabetic token: evaluate for prose autocorrect
  if (/^[a-zA-Z]+$/.test(token)) {
    return TokenType.PROSE_WORD;
  }

  return TokenType.PROTECTED_CODE;
}

// ============================================================================
// 5. SPATIAL WEIGHTED DAMERAU-LEVENSHTEIN SEARCH
// ============================================================================

function spatialEditDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  if (Math.abs(m - n) > 2) return 999;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i * 0.8; // Deletion cost
  for (let j = 0; j <= n; j++) dp[0][j] = j * 0.8; // Insertion cost

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c1 = s1[i - 1];
      const c2 = s2[j - 1];
      const cost = getSpatialSubstitutionCost(c1, c2);

      dp[i][j] = Math.min(
        dp[i - 1][j] + 0.8,        // Deletion
        dp[i][j - 1] + 0.8,        // Insertion
        dp[i - 1][j - 1] + cost    // Spatial substitution
      );

      // Damerau-Levenshtein transposition check
      if (i > 1 && j > 1 && s1[i - 1] === s2[j - 2] && s1[i - 2] === s2[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 0.4);
      }
    }
  }

  return dp[m][n];
}

function findBestCorrection(word: string): string {
  const lower = word.toLowerCase();

  // Already correct or explicitly protected
  if (VALID_WORDS.has(lower) || PROTECTED_DEV_TERMS[lower]) {
    return word;
  }

  // Common single-letter exceptions (e.g. 'a', 'I')
  if (lower.length === 1 && (lower === "a" || lower === "i")) {
    return word;
  }

  let bestMatch = word;
  let lowestCost = 1.05; // Strict cutoff threshold

  const minLen = Math.max(1, lower.length - 2);
  const maxLen = lower.length + 2;

  for (let len = minLen; len <= maxLen; len++) {
    const candidates = LENGTH_BUCKETS.get(len);
    if (!candidates) continue;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const cost = spatialEditDistance(lower, candidate);
      if (cost < lowestCost) {
        lowestCost = cost;
        bestMatch = candidate;
      }
    }
  }

  // Preserve initial casing (e.g. capitalized sentence beginnings)
  if (bestMatch !== word && /^[A-Z]/.test(word)) {
    return bestMatch.charAt(0).toUpperCase() + bestMatch.slice(1);
  }

  return bestMatch;
}

const TOKEN_REGEX =
  /(`[^`]*`|[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+|(?:[.~]?\/)?[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+|[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+|--?[a-zA-Z0-9_-]+|[a-zA-Z]*[a-z][A-Z][a-zA-Z0-9]*|\b\w*[_\d]\w*\b|\s+|[^\w\s]|[a-zA-Z]+)/g;

export interface AutocorrectResult {
  correctedText: string;
  corrections: Array<{ original: string; corrected: string }>;
}

export function autocorrectText(rawInput: string): AutocorrectResult {
  // Bypass empty, short queries, or direct CLI/slash commands
  if (
    !rawInput ||
    rawInput.trim().startsWith("/") ||
    rawInput.trim().startsWith("$") ||
    rawInput.trim().startsWith("!") ||
    rawInput.length < 5
  ) {
    return { correctedText: rawInput, corrections: [] };
  }

  const tokens = rawInput.match(TOKEN_REGEX) ?? [];
  const corrections: Array<{ original: string; corrected: string }> = [];

  const rectifiedTokens = tokens.map(token => {
    const type = classifyToken(token);
    if (type !== TokenType.PROSE_WORD) {
      return token; // Code flags, file paths, variables stay untouched
    }

    const corrected = findBestCorrection(token);
    if (corrected.toLowerCase() !== token.toLowerCase()) {
      corrections.push({ original: token, corrected });
    }
    return corrected;
  });

  return {
    correctedText: rectifiedTokens.join(""),
    corrections
  };
}

// ============================================================================
// 6. IN-PROCESS MITM OH-MY-PI HOOK REGISTRATION
// ============================================================================

export default function mobileAutocorrectExtension(pi: ExtensionAPI): void {
  // Hook 1: "input" event — interactive mode (Termux TUI / Android keyboard)
  // Rewrites prompt text as soon as the user hits enter in the terminal.
  pi.on("input", async (event, ctx: ExtensionContext) => {
    const rawInput = event.text;
    const { correctedText, corrections } = autocorrectText(rawInput);
    if (corrections.length === 0) return;

    if (ctx.hasUI && ctx.ui?.setStatus) {
      const diffSummary = corrections
        .map(c => `${c.original}→${c.corrected}`)
        .slice(0, 3)
        .join(", ");
      ctx.ui.setStatus("autocorrect", `Termux Autocorrect: [${diffSummary}]`);
    }

    return { text: correctedText };
  });

  // Hook 2: "context" event — MITM fail-safe right before LLM dispatch.
  // Catches all prompt sources (RPC, subagent dispatch, unhooked inputs).
  pi.on("context", async (event, ctx: ExtensionContext) => {
    const messages = event.messages as Array<{
      role: string;
      content: Array<{ type: string; text?: string; [key: string]: unknown }> | string;
      [key: string]: unknown;
    }>;

    if (!messages || messages.length === 0) return;

    // Isolate the latest active user instruction
    const lastUserIdx = messages.map(m => m.role).lastIndexOf("user");
    if (lastUserIdx === -1) return;

    const userMessage = messages[lastUserIdx];

    // Case A: content is a plain string
    if (typeof userMessage.content === "string") {
      const { correctedText, corrections } = autocorrectText(userMessage.content);
      if (corrections.length === 0) return;

      const updatedMessages = [...messages];
      updatedMessages[lastUserIdx] = {
        ...userMessage,
        content: correctedText,
      };

      if (ctx.hasUI && ctx.ui?.setStatus) {
        const diffSummary = corrections
          .map(c => `${c.original}→${c.corrected}`)
          .slice(0, 3)
          .join(", ");
        ctx.ui.setStatus("autocorrect", `Termux Autocorrect: [${diffSummary}]`);
      }

      return { messages: updatedMessages };
    }

    // Case B: content is an array of text/image chunks
    if (Array.isArray(userMessage.content)) {
      const textChunkIdx = userMessage.content.findIndex(
        c => c.type === "text" && typeof c.text === "string"
      );
      if (textChunkIdx === -1) return;

      const rawInput = userMessage.content[textChunkIdx].text!;
      const { correctedText, corrections } = autocorrectText(rawInput);
      if (corrections.length === 0) return;

      const updatedMessages = [...messages];
      const updatedContent = [...userMessage.content];

      updatedContent[textChunkIdx] = {
        ...updatedContent[textChunkIdx],
        text: correctedText,
      };
      updatedMessages[lastUserIdx] = {
        ...userMessage,
        content: updatedContent,
      };

      if (ctx.hasUI && ctx.ui?.setStatus) {
        const diffSummary = corrections
          .map(c => `${c.original}→${c.corrected}`)
          .slice(0, 3)
          .join(", ");
        ctx.ui.setStatus("autocorrect", `Termux Autocorrect: [${diffSummary}]`);
      }

      return { messages: updatedMessages };
    }
  });
}
