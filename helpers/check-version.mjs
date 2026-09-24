import fs from 'fs'
const p = 'packages/coding-agent/src/generated/version.json'
if (!fs.existsSync(p)) { console.error(`missing ${p} run version:gen`); process.exit(1) }
const v = JSON.parse(fs.readFileSync(p,'utf8'))
if (!v.canonical.startsWith('tau/main-')) throw new Error('canonical must start tau/main-')
if (!v.canonical.includes('-sovereign-tau-')) throw new Error('must contain -sovereign-tau-')
console.log(`version ok: ${v.canonical} npm:${v.npm}`)
