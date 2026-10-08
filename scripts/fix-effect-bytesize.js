#!/usr/bin/env node
import fs from 'fs'
import { execSync } from 'child_process'

function patchFile(file) {
  try {
    let src = fs.readFileSync(file, 'utf8')
    let orig = src
    // nuke ALL previous shims + bad import, no matter how many
    src = src.split('\n').filter(l => !l.includes('const ByteSize = { bytes:')).join('\n')
    src = src.replace(/import \* as ByteSize from "effect\/ByteSize";\n?/g, '')
    // add exactly one at top
    src = 'const ByteSize = { bytes: (n) => Number(n) };\n' + src.ltrimStart()
    if (src !== orig) {
      fs.writeFileSync(file, src)
      console.log('patched', file)
    }
  } catch {}
}

try {
  const cmd = 'find /home/toxic /home/toxic/tau -type f -path "*platform-node-shared/dist/NodeFileSystem.js" 2>/dev/null'
  const files = execSync(cmd, {encoding:'utf8'}).trim().split('\n').filter(Boolean)
  for (const f of [...new Set(files)]) patchFile(f)
} catch {}
