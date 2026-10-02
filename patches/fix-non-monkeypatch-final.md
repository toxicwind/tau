// 1. env.ts - proper type, not proxy returning ""
export const $env: Record<string,string|undefined> = Bun.env;
export const $envRequired = (k:string) => {
  const v = Bun.env[k];
  if (v===undefined) throw new Error(`missing env ${k}`);
  return v;
};

// 2. procmgr.ts - no lie
function buildSpawnEnv(shell:string): Record<string,string> {
  const raw = {
   ...filterChildShellEnv(Bun.env),
    SHELL: shell, GIT_EDITOR:"true", GPG_TTY:"not a tty",
    TAUCODE:"1", CLAUDECODE:"1",
   ...(noCI?{}:{CI:"true"})
  };
  return Object.fromEntries(
    Object.entries(raw).filter(([,v]): v is string => typeof v==='string')
  );
}

// 3. discovery files - validate, don't cast
function asStringRecord(v:unknown): Record<string,string>|undefined {
  if (!v || typeof v!=='object' || Array.isArray(v)) return undefined;
  const out: Record<string,string> = {};
  for (const [k,val] of Object.entries(v as Record<string,unknown>)) {
    if (typeof val==='string') out[k]=val;
  }
  return Object.keys(out).length? out : undefined;
}
// use it:
env: asStringRecord(expanded.env)
headers: asStringRecord(expanded.headers)

// 4. dirs.ts empty catches - keep fallback, log only when PI_DEBUG
} catch (e) {
  if (Bun.env.PI_DEBUG) console.debug("[dirs] realpath fallback", inputPath, e);
  return resolvedPath;
}

// 5. google-gemini-cli.ts - abortable, not just smaller
const controller = new AbortController();
const timeout = setTimeout(()=>controller.abort(), DEFAULT_FIRST_EVENT_TIMEOUT_MS);
try {
  await streamWithSignal({ signal: controller.signal });
} finally { clearTimeout(timeout); }
