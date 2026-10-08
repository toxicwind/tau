#!/usr/bin/env node
import fs from 'fs'
import { execSync } from 'child_process'
function patch(f){
  let s=fs.readFileSync(f,'utf8')
  if(!s.includes('effect/ByteSize') && !s.includes('const ByteSize = { bytes:')) return
  s=s.split('\n').filter(l=>!l.includes('const ByteSize = { bytes:')).join('\n')
  s=s.replace(/import \* as ByteSize from "effect\/ByteSize";\n?/g,'')
  s='const ByteSize = { bytes: (n) => Number(n) };\n'+s.trimStart()
  fs.writeFileSync(f,s)
  console.log('patched',f)
}
try{
  const cmd=`grep -Rl "effect/ByteSize" /home/toxic/tau/node_modules/@smthrs /home/toxic/tau/node_modules/@effect --include="*.js" 2>/dev/null || true`
  execSync(cmd,{encoding:'utf8'}).split('\n').filter(Boolean).forEach(patch)
}catch{}
