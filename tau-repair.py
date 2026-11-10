#!/usr/bin/env python3
"""Dry-run by default; --apply writes (with .bak-repair-<ts> backups). Prints status codes only, never secrets."""
import os, re, shutil, sys, time, urllib.request, urllib.error
from pathlib import Path
T = Path.home() / ".tau"
ENV, CFG, KEYF = (T / ".env").resolve(), (T / "config.yml").resolve(), T / "flock.key"
APPLY = "--apply" in sys.argv
URL = "http://127.0.0.1:25193/v1/models"

def code(key):
    r = urllib.request.Request(URL, headers={"Authorization": f"Bearer {key}"})
    try: return urllib.request.urlopen(r, timeout=8).status
    except urllib.error.HTTPError as e: return e.code
    except Exception as e: return f"ERR:{type(e).__name__}"

def backup(p):
    b = p.with_name(p.name + f".bak-repair-{int(time.time())}"); shutil.copy2(p, b); return b

env_lines, cfg_lines = ENV.read_text().splitlines(), CFG.read_text().splitlines()

def envval(name):
    for l in env_lines:
        m = re.match(rf"^\s*(?:export\s+)?{name}\s*=\s*[\"']?([^\"'\n#]*)", l)
        if m: return m.group(1).strip()
    return ""

# config.yml: providers.openai-compatible.apiKey (value may wrap onto token-only lines)
ki = kend = None; cfg_key = ""; kind = ""
ci = next((i for i, l in enumerate(cfg_lines) if l.strip() == "openai-compatible:"), None)
if ci is not None:
    ind = len(cfg_lines[ci]) - len(cfg_lines[ci].lstrip())
    for j in range(ci + 1, len(cfg_lines)):
        l = cfg_lines[j]
        if l.strip() and len(l) - len(l.lstrip()) <= ind: break
        if re.match(r"^\s+apiKey:", l):
            ki, kind = j, l[:len(l) - len(l.lstrip())]
            cfg_key = l.split(":", 1)[1].strip().strip("'\""); kend = j + 1
            while kend < len(cfg_lines) and re.fullmatch(r"\s*[A-Za-z0-9._\-]+\s*", cfg_lines[kend]):
                cfg_key += cfg_lines[kend].strip(); kend += 1
            break

cands = {"flock.key file": KEYF.read_text().strip() if KEYF.exists() else "",
         "shell FLOCK_API_KEY": os.environ.get("FLOCK_API_KEY", ""),
         ".env FLOCK_API_KEY": envval("FLOCK_API_KEY"),
         ".env SCOUT_API_KEY": envval("SCOUT_API_KEY"),
         "config.yml openai-compatible.apiKey": cfg_key}
res = {k: (code(v) if v else "empty") for k, v in cands.items()}
print("== flock (25193) status per credential source")
for k, v in res.items(): print(f"  {k:38} → {v}")
good = next((cands[k] for k in ("flock.key file", "shell FLOCK_API_KEY") if res[k] == 200), "")

junk = next((i for i, l in enumerate(env_lines) if "OMNIROUTE 401 PROXY ERROR FIX" in l), None)
print("\n== .env damage")
print("  agent junk block:", f"line {junk + 1}" if junk is not None else "absent")
print("  OMNIROUTE_GATEWAY_KEY:", "present" if envval("OMNIROUTE_GATEWAY_KEY") else "MISSING (agent deleted it; restore from your scrollback or git)")

new_env = env_lines[:junk] if junk is not None else env_lines[:]
new_env = [l for l in new_env if not re.match(r"^\s*export\s+(OPENROUTER|PROXY)_API_KEY", l)]
if good:
    for n in ("FLOCK_API_KEY", "SCOUT_API_KEY"):
        new_env = [f'{n}="{good}"' if re.match(rf"^\s*{n}\s*=", l) else l for l in new_env]
new_cfg = cfg_lines[:]
if good and ki is not None and res["config.yml openai-compatible.apiKey"] != 200:
    new_cfg[ki:kend] = [f"{kind}apiKey: {good}"]

print("\n== plan")
print("  .env   :", "rewrite (junk removed, flock/scout keys set)" if new_env != env_lines else "no change")
print("  config :", "replace openai-compatible.apiKey" if new_cfg != cfg_lines else "no change")
if not good: print("  !! no working key found; nothing key-related will change")
if not APPLY: print("\n(dry run) re-run with --apply to write"); sys.exit(0)
if new_env != env_lines: print("  backup:", backup(ENV)); ENV.write_text("\n".join(new_env) + "\n")
if new_cfg != cfg_lines: print("  backup:", backup(CFG)); CFG.write_text("\n".join(new_cfg) + "\n")
print("done — restart tau so it re-reads the environment")
