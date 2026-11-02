#!/usr/bin/env bun
/**
 * [SOVEREIGN] Doorbell Raw Diagnostic — v11 UNTRUNCATED
 * ------------------------------------------------------
 * No slice. No filter. No truncate. No cap. Raw every line.
 * Tees full output to /tmp/doorbell-raw-<ts>.log
 *
 * Adds the probes that actually answer the ACL question from the host:
 *   - tailscale debug netmap        ← control plane's view of this node
 *   - tailscale debug prefs         ← full preference blob
 *   - tailscale status --json       ← full status blob
 *   - tailscale serve status --json ← full serve config
 *   - tailscale funnel status       ← full funnel state
 *   - journalctl tailscaled since boot, unfiltered, no slice
 */

import { spawnSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";

const DOORBELL_DIR   = "/home/toxic/pens/estate/ranch/doorbell";
const SECONDARY_SOCK = "/run/tailscale/doorbell.sock";
const PRIMARY_SOCK   = "/run/tailscale/tailscaled.sock";
const DOORBELL_HOST  = "doorbell.tailc9ac71.ts.net";
const DOORBELL_PORT  = 25202;

const TS = new Date().toISOString().replace(/[:.]/g, "-");
const LOG_PATH = `/tmp/doorbell-raw-${TS}.log`;
let BUF = "";

function emit(line = "") {
  process.stdout.write(line + "\n");
  BUF += line + "\n";
}

function section(title: string) {
  emit("");
  emit("═".repeat(78));
  emit(`▌ ${title}`);
  emit("═".repeat(78));
}

type RunOpts = { sudo?: boolean; timeout?: number };
function run(cmd: string, args: string[], o: RunOpts = {}) {
  const argv = o.sudo ? ["sudo", cmd, ...args] : [cmd, ...args];
  emit(`$ ${argv.join(" ")}`);
  try {
    const r = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf-8",
      timeout: o.timeout ?? 120_000,
      env: { ...process.env, LC_ALL: "C" },
      maxBuffer: 64 * 1024 * 1024,
    });
    emit(`--- stdout (${(r.stdout || "").length} bytes) ---`);
    emit(r.stdout || "");
    emit(`--- stderr (${(r.stderr || "").length} bytes) ---`);
    emit(r.stderr || "");
    emit(`--- exit: ${r.status} ---`);
    return r;
  } catch (e) {
    emit(`--- spawn error: ${(e as Error).message} ---`);
    return { status: 1, stdout: "", stderr: String(e) } as any;
  }
}

async function runFetch(label: string, url: string, init?: RequestInit) {
  emit(`$ FETCH ${label}: ${url}`);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    const text = await r.text();
    emit(`--- status: ${r.status} ---`);
    emit(`--- headers: ---`);
    for (const [k, v] of r.headers.entries()) emit(`  ${k}: ${v}`);
    emit(`--- body (${text.length} bytes) ---`);
    emit(text);
  } catch (e) {
    emit(`--- FETCH ERROR: ${(e as Error).message} ---`);
  } finally {
    clearTimeout(t);
  }
}

emit("█".repeat(78));
emit("█ [SOVEREIGN] Doorbell RAW DIAGNOSTIC — v11 UNTRUNCATED");
emit(`█ Started: ${new Date().toISOString()}`);
emit(`█ Log file: ${LOG_PATH}`);
emit(`█ Bun: ${Bun.version}`);
emit(`█ Host: ${(await import("os")).hostname()}  User: ${process.env.USER}`);
emit("█".repeat(78));

// ─── 0. Identity / environment ───────────────────────────────────────────────
section("0. ENVIRONMENT");
run("uname", ["-a"]);
run("id", []);
run("env", []);

// ─── 1. Tailscale versions ───────────────────────────────────────────────────
section("1. TAILSCALE VERSION (both sockets)");
run("tailscale", [`--socket=${PRIMARY_SOCK}`,  "version"]);
run("tailscale", [`--socket=${SECONDARY_SOCK}`, "version"]);
run("tailscale", ["version"]);

// ─── 2. Sockets present ──────────────────────────────────────────────────────
section("2. TAILSCALE SOCKETS ON DISK");
run("ls", ["-la", "/run/tailscale/"]);

// ─── 3. Daemon processes ─────────────────────────────────────────────────────
section("3. TAILSCALED PROCESSES");
run("ps", ["auxww"]);
run("systemctl", ["status", "tailscaled", "--no-pager", "-l"]);

// ─── 4. Full status JSON (both sockets) ──────────────────────────────────────
section("4. tailscale status --json (PRIMARY)");
run("tailscale", [`--socket=${PRIMARY_SOCK}`, "status", "--json"]);

section("5. tailscale status --json (DOORBELL)");
run("tailscale", [`--socket=${SECONDARY_SOCK}`, "status", "--json"]);

// ─── 6. tailscale status --peers=true (human) ────────────────────────────────
section("6. tailscale status (DOORBELL, human)");
run("tailscale", [`--socket=${SECONDARY_SOCK}`, "status"]);

// ─── 7. tailscale debug netmap — CONTROL PLANE'S VIEW ───────────────────────
section("7. tailscale debug netmap (DOORBELL)  ← CONTROL PLANE VIEW");
run("tailscale", [`--socket=${SECONDARY_SOCK}`, "debug", "netmap"], { timeout: 30_000 });

// ─── 8. tailscale debug prefs ────────────────────────────────────────────────
section("8. tailscale debug prefs (DOORBELL)");
run("tailscale", [`--socket=${SECONDARY_SOCK}`, "debug", "prefs"]);

// ─── 9. tailscale debug watch-ipn (short sample) ─────────────────────────────
section("9. tailscale debug watch-ipn (5s sample)");
run("timeout", ["5", "tailscale", `--socket=${SECONDARY_SOCK}`, "debug", "watch-ipn"], { timeout: 10_000 });

// ─── 10. Serve config ────────────────────────────────────────────────────────
section("10. tailscale serve status (DOORBELL)");
run("tailscale", [`--socket=${SECONDARY_SOCK}`, "serve", "status"]);

section("11. tailscale serve status --json (DOORBELL)");
run("tailscale", [`--socket=${SECONDARY_SOCK}`, "serve", "status", "--json"]);

// ─── 12. Funnel config ───────────────────────────────────────────────────────
section("12. tailscale funnel status (DOORBELL)");
run("tailscale", [`--socket=${SECONDARY_SOCK}`, "funnel", "status"]);

section("13. tailscale funnel status --json (DOORBELL)");
run("tailscale", [`--socket=${SECONDARY_SOCK}`, "funnel", "status", "--json"]);

// ─── 14. Cert status ─────────────────────────────────────────────────────────
section("14. tailscale cert status (DOORBELL)");
run("tailscale", [`--socket=${SECONDARY_SOCK}`, "cert", "--help"], { timeout: 10_000 });

// ─── 15. Local HTTP surface ──────────────────────────────────────────────────
section("15. LOCAL HTTP SURFACE");
await runFetch("local /health", `http://127.0.0.1:${DOORBELL_PORT}/health`);
await runFetch("local /.well-known/oauth-protected-resource",
  `http://127.0.0.1:${DOORBELL_PORT}/.well-known/oauth-protected-resource`);
await runFetch("local /", `http://127.0.0.1:${DOORBELL_PORT}/`);

section("16. Local SSE (raw curl -v)");
run("curl", ["-svN", "--max-time", "3",
  `http://127.0.0.1:${DOORBELL_PORT}/?sessionId=test&agentId=test`]);

// ─── 17. DNS resolution from every angle ────────────────────────────────────
section("17. DNS RESOLUTION");
run("cat", ["/etc/resolv.conf"]);
run("dig", ["+short", DOORBELL_HOST]);
run("dig", ["+short", DOORBELL_HOST, "@1.1.1.1"]);
run("dig", ["+short", DOORBELL_HOST, "@8.8.8.8"]);
run("dig", ["+short", DOORBELL_HOST, "@9.9.9.9"]);
run("dig", ["+short", "estate.tailc9ac71.ts.net"]);
run("dig", ["+short", "tailc9ac71.ts.net"]);
run("dig", ["+short", "controlplane.tailscale.com"]);
run("nslookup", [DOORBELL_HOST]);
run("getent", ["hosts", DOORBELL_HOST]);

// ─── 18. TLS cert probe from outside (public IPs) ───────────────────────────
section("18. TLS CERT PROBE (uses DNS result if any)");
const digRes = run("dig", ["+short", DOORBELL_HOST, "@1.1.1.1"]);
const ip = (digRes.stdout || "").trim().split("\n")[0];
if (ip) {
  emit(`Using IP: ${ip}`);
  run("openssl", ["s_client", "-connect", `${ip}:443`, "-servername", DOORBELL_HOST,
    "-showcerts"], { timeout: 15_000 });
  run("curl", ["-sv", "--max-time", "10", "--resolve", `${DOORBELL_HOST}:443:${ip}`,
    `https://${DOORBELL_HOST}/health`], { timeout: 15_000 });
} else {
  emit("No public IP for doorbell — skipping TLS probe.");
}

// ─── 19. Public HTTPS fetch attempts ────────────────────────────────────────
section("19. PUBLIC HTTPS PROBES");
await runFetch("public /health", `https://${DOORBELL_HOST}/health`);
await runFetch("public /", `https://${DOORBELL_HOST}/`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {},
      clientInfo: { name: "raw-diag", version: "11" } },
  }),
});

// ─── 20. FULL journalctl — no slice, no filter ──────────────────────────────
section("20. JOURNALCTL tailscaled — SINCE BOOT, UNFILTERED");
run("journalctl", ["-u", "tailscaled", "--no-pager", "-l", "--since", "boot"],
  { timeout: 60_000 });

section("21. JOURNALCTL for any systemd unit mentioning funnel/serve/cert");
run("journalctl", ["--no-pager", "-l", "--since", "1 hour ago",
  "-g", "funnel|serve|cert|acme|https|dns"], { timeout: 60_000 });

// ─── 22. Raw localapi dump ──────────────────────────────────────────────────
section("22. LOCALAPI DIRECT DUMPS (via curl on socket)");
for (const path of [
  "/localapi/v0/status",
  "/localapi/v0/prefs",
  "/localapi/v0/serve-config",
  "/localapi/v0/netmap",
  "/localapi/v0/whois?addr=127.0.0.1:1",
  "/localapi/v0/file-targets",
  "/localapi/v0/doctor",
]) {
  emit(`$ curl --unix-socket ${SECONDARY_SOCK} http://local-tailscaled.sock${path}`);
  const r = spawnSync("curl", ["-s", "--unix-socket", SECONDARY_SOCK,
    `http://local-tailscaled.sock${path}`], { encoding: "utf-8", timeout: 20_000,
    maxBuffer: 64 * 1024 * 1024 });
  emit(r.stdout || "");
  if (r.stderr) emit(`stderr: ${r.stderr}`);
  emit("");
}

// ─── 23. tailscale bug-report (best-effort, may need auth) ──────────────────
section("23. tailscale bug-report (may fail if not logged in)");
run("tailscale", [`--socket=${SECONDARY_SOCK}`, "bug-report", "--diagnose"],
  { timeout: 30_000 });

// ─── 24. Doorbell app source dump ───────────────────────────────────────────
section("24. DOORBELL SOURCE STATE (post-patch)");
run("grep", ["-n", 'path === "/"', `${DOORBELL_DIR}/src/index.ts`]);
run("grep", ["-n", 'path === "/"', `${DOORBELL_DIR}/src/oauth.ts`]);
run("grep", ["-n", 'path === "/"', `${DOORBELL_DIR}/src/sse.ts`]);
run("grep", ["-n", "PUBLIC_ISSUER", `${DOORBELL_DIR}/.env`]);

// ─── 25. Flush full log ─────────────────────────────────────────────────────
section("25. COMPLETE");
emit(`Full log written to: ${LOG_PATH}`);
emit(`Total bytes: ${BUF.length}`);

try {
  mkdirSync("/tmp", { recursive: true });
  writeFileSync(LOG_PATH, BUF);
  process.stdout.write(`\n✓ wrote ${BUF.length} bytes to ${LOG_PATH}\n`);
  process.stdout.write(`  view with: less ${LOG_PATH}\n`);
  process.stdout.write(`  or:        cat ${LOG_PATH} | grep -i funnel\n`);
} catch (e) {
  process.stderr.write(`\n✗ failed to write log: ${(e as Error).message}\n`);
}
