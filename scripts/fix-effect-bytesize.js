#!/usr/bin/env node
import fs from 'fs'
import { execSync } from 'child_process'

function patchFile(file) {
  let src = fs.readFileSync(file, 'utf8')
  if (src.includes('const ByteSize = { bytes:')) return
  src = src.replace(/import \* as ByteSize from "effect\/ByteSize";\n?/, '')
  src = 'const ByteSize = { bytes: (n) => Number(n) };\n' + src
  fs.writeFileSync(file, src)
  console.log('patched', file)
}

try {
  const files = execSync('find . -type f -path "*platform-node-shared/dist/NodeFileSystem.js" 2>/dev/null', {encoding:'utf8'}).trim().split('\n').filter(Boolean)
  const globalFiles = execSync('find /home/toxic -type f -path "*platform-node-shared/dist/NodeFileSystem.js" 2>/dev/null | head -20', {encoding:'utf8'}).trim().split('\n').filter(Boolean)
  const all = [...new Set([...files, ...globalFiles])]
  for (const f of all) if (f && fs.existsSync(f)) patchFile(f)
} catch {}
