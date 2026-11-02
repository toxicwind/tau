const tryPort = async (p:number) => {
  try {
    const s = Bun.serve({
      port: p,
      async fetch(req){
        const u=new URL(req.url);
        if(u.pathname==="/api/audit"){
          const backend=u.searchParams.get("backend")||"CUTLASS";
          const proc=Bun.spawn(["python","moe_real_audit.py"],{env:{...process.env,TRTLLM_MOE_BACKEND:backend},stdout:"pipe"});
          const out=await new Response(proc.stdout).text(); await proc.exited;
          return new Response(JSON.stringify({backend,output:out}),{headers:{"Content-Type":"application/json"}});
        }
        return new Response(`<html><body style="background:#0a0a0a;color:#0f0;font-family:monospace;padding:20px"><h2>3090 MoE Audit :${p}</h2><button onclick="run('CUTLASS')">CUTLASS</button> <button onclick="run('TRITON')">TRITON</button><pre id=o></pre><script>async function run(b){o.textContent='running '+b+'...';const r=await fetch('/api/audit?backend='+b);const j=await r.json();o.textContent=j.output;}run('CUTLASS')</script></body></html>`,{headers:{"Content-Type":"text/html"}});
      }
    });
    console.log(`listening https://awrawr-pc:${s.port}/`);
  } catch(e){
    console.log(`port ${p} in use, trying ${p+1}`); await tryPort(p+1);
  }
};
tryPort(25212);
