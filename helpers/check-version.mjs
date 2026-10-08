import fs from 'fs'

const p = 'packages/coding-agent/src/generated/version.json'
if (!fs.existsSync(p)) { console.error(`missing ${p} run version:gen`); process.exit(1) }
const v = JSON.parse(fs.readFileSync(p, 'utf8'))

// The fork stamp MUST live in semver BUILD METADATA (`+sovereign.tau.<sha>`),
// never in a prerelease tag. `18.8.4-sovereign.tau.abc` is a prerelease, and
// `^18.8.4` refuses to match a prerelease, so a `catalog:` range would fail to
// resolve. Build metadata is ignored in range comparison, so `^18.8.4` matches
// our version while the string stays distinguishable from upstream's plain
// `18.8.4`.
const SEMVER = /^(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/
const m = SEMVER.exec(v.canonical)
if (!m) throw new Error(`canonical must be semver, got ${v.canonical}`)
if (m[2]) throw new Error(`canonical must not be a prerelease: ${v.canonical}`)
if (!m[3]?.startsWith('sovereign.tau.')) throw new Error('canonical build metadata must start sovereign.tau.')
if (v.npm !== `${m[1]}+${m[3]}`) throw new Error(`npm (${v.npm}) must equal ${m[1]}+${m[3]}`)

console.log(`version ok: ${v.canonical} npm:${v.npm}`)
