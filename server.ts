import { spawn } from "bun";

const PORT = 25215;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/run") {
      const proc = spawn(["python", "moe_disparate_proof.py"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(proc.stdout).text();
      const err = await new Response(proc.stderr).text();
      await proc.exited;

      return new Response(JSON.stringify({ status: "success", output: output || err }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/sass") {
      // Find latest Triton compiled SM86 cubin
      const findProc = spawn(["bash", "-c", "find ~/.triton/cache -name '*.cubin' | head -n 1"], { stdout: "pipe" });
      const cubinPath = (await new Response(findProc.stdout).text()).trim();
      
      let sass = "No cubin found in cache.";
      if (cubinPath) {
        const disProc = spawn(["cuobjdump", "-sass", cubinPath], { stdout: "pipe" });
        sass = await new Response(disProc.stdout).text();
      }

      return new Response(JSON.stringify({ cubin: cubinPath, sass_head: sass.split("\n").slice(0, 80).join("\n") }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(`<!DOCTYPE html>
<html>
<head>
  <title>SM86 MoE Architectural Disparity Console</title>
  <style>
    body { background: #0c0d10; color: #33ff77; font-family: monospace; padding: 24px; }
    h1 { color: #fff; border-bottom: 2px solid #33ff77; padding-bottom: 8px; }
    button { background: #1a221f; color: #33ff77; border: 1px solid #33ff77; padding: 8px 16px; cursor: pointer; font-size: 14px; margin-right: 8px; }
    button:hover { background: #33ff77; color: #000; }
    pre { background: #111417; border: 1px solid #222; padding: 16px; border-radius: 4px; overflow-x: auto; max-height: 500px; }
  </style>
</head>
<body>
  <h1>SM86 MoE Telemetry Console (:25215)</h1>
  <p>GA102 6MB L2 Cache Thrashing & CUTLASS Wave-Quantization Verification</p>
  <button onclick="runAudit()">Run Microarchitectural Audit</button>
  <button onclick="dumpSass()">Dump Compiled SM86 SASS</button>
  <h3>Kernel Telemetry</h3>
  <pre id="output">Click a button to execute...</pre>

  <script>
    async function runAudit() {
      document.getElementById('output').textContent = "Executing Python microbenchmark...";
      const res = await fetch('/api/run');
      const data = await res.json();
      document.getElementById('output').textContent = data.output;
    }
    async function dumpSass() {
      document.getElementById('output').textContent = "Extracting SASS from ~/.triton/cache...";
      const res = await fetch('/api/sass');
      const data = await res.json();
      document.getElementById('output').textContent = "CUBIN: " + data.cubin + "\n\n" + data.sass_head;
    }
  </script>
</body>
</html>`, {
      headers: { "Content-Type": "text/html" },
    });
  }
});

console.log(`[BUN] Disparity Server online at http://localhost:${PORT}/`);
