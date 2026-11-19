#!/usr/bin/env bun
// scripts/repair-links.mjs
//
// Scans EVERY package.json in the repo (not just the directories matched by
// the root `workspaces.packages` glob -- a package that got moved/renamed
// out of that glob is exactly the failure mode this fixes) for `file:` and
// `workspace:<path>` dependency specifiers that no longer resolve to a real
// directory, then repairs them by locating the target package anywhere in
// the repo by its `package.json` "name" field.
//
// Usage:
//   bun scripts/repair-links.mjs                # dry run: report only
//   bun scripts/repair-links.mjs --apply         # rewrite the broken ones
//   bun scripts/repair-links.mjs --apply --root /path/to/repo

import fs from 'fs'
import path from 'path'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const rootFlagIdx = args.indexOf('--root')
const ROOT = path.resolve(
  rootFlagIdx !== -1 ? args[rootFlagIdx + 1] : path.resolve(import.meta.dir, '..')
)

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'target', 'dist', 'build',
  '.turbo', '.next', '.cache', '.resolved-cache',
])

// 1. Walk the WHOLE repo tree collecting every package.json -- deliberately
//    broader than the declared workspaces glob, since a moved/renamed
//    package is exactly what we're hunting for.
function walk(dir, out) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue // don't chase symlink loops
    if (entry.name.startsWith('.resolved-')) continue
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else if (entry.isFile() && entry.name === 'package.json') {
      out.push(full)
    }
  }
}

const allPkgJsonPaths = []
walk(ROOT, allPkgJsonPaths)
console.log(`scanned ${allPkgJsonPaths.length} package.json files under ${ROOT}`)

// 2. Repo-wide name -> directory index, first match wins (duplicates are
//    flagged rather than silently resolved, since picking the wrong one of
//    two same-named packages would be worse than doing nothing).
const nameToDir = new Map()
const dupes = new Map()
for (const pjPath of allPkgJsonPaths) {
  let pj
  try {
    pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'))
  } catch {
    console.warn(`  ! unreadable/invalid JSON, skipping: ${path.relative(ROOT, pjPath)}`)
    continue
  }
  if (!pj.name) continue
  const dir = path.dirname(pjPath)
  if (nameToDir.has(pj.name)) {
    if (!dupes.has(pj.name)) dupes.set(pj.name, [nameToDir.get(pj.name)])
    dupes.get(pj.name).push(dir)
    continue
  }
  nameToDir.set(pj.name, dir)
}
for (const [name, dirs] of dupes) {
  console.warn(`\n  ! "${name}" has package.json in multiple places -- kept the first, check the rest manually:`)
  for (const d of dirs) console.warn(`      ${path.relative(ROOT, d)}`)
}

// 3. Check every file:/workspace:<path-form> dependency in every
//    package.json for whether it actually resolves.
//
//    file: is ALWAYS a path (dot-prefixed or bare) per npm/yarn/pnpm/bun
//    semantics -- that's the form that broke here ("file:coding-agent").
//    workspace: has range forms (*, ^, ~, exact version) and alias forms
//    (name@range) that are NOT paths and resolve by dependency name
//    instead; only ./, ../, and / prefixed workspace: specifiers are
//    genuine paths, so only those are checked here.
let brokenCount = 0
let fixedCount = 0
let unresolvableCount = 0

for (const pjPath of allPkgJsonPaths) {
  const pkgDir = path.dirname(pjPath)
  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(pjPath, 'utf8'))
  } catch {
    continue
  }
  let changed = false

  for (const depType of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    if (!pkg[depType]) continue
    for (const [depName, ver] of Object.entries(pkg[depType])) {
      if (typeof ver !== 'string') continue

      let spec = null
      if (ver.startsWith('file:')) {
        spec = ver.slice('file:'.length)
      } else if (ver.startsWith('workspace:')) {
        const w = ver.slice('workspace:'.length)
        if (w.startsWith('./') || w.startsWith('../') || w.startsWith('/')) spec = w
        else continue // range form or alias form -- resolved by name elsewhere, not a path
      } else {
        continue
      }

      const absTarget = path.resolve(pkgDir, spec)
      if (fs.existsSync(path.join(absTarget, 'package.json'))) continue // fine

      brokenCount++
      console.log(`\nBROKEN: ${path.relative(ROOT, pjPath)}`)
      console.log(`  "${depName}": "${ver}"`)
      console.log(`  -> resolves to ${path.relative(ROOT, absTarget)} (missing)`)

      const correctDir = nameToDir.get(depName)
      if (!correctDir) {
        unresolvableCount++
        console.log(`  ! no package named "${depName}" found anywhere under ${path.relative(ROOT, ROOT) || '.'} -- can't auto-repair, fix by hand`)
        continue
      }

      const newRelSpec = path.relative(pkgDir, correctDir) || '.'
      const newVer = ver.startsWith('file:') ? `file:${newRelSpec}` : `workspace:${newRelSpec}`
      console.log(`  -> found "${depName}" at ${path.relative(ROOT, correctDir)}`)
      console.log(`  -> ${APPLY ? 'rewriting' : 'would rewrite'} to: "${depName}": "${newVer}"`)

      if (APPLY) {
        pkg[depType][depName] = newVer
        changed = true
        fixedCount++
      }
    }
  }

  if (changed) {
    fs.writeFileSync(pjPath, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`  \u2713 wrote ${path.relative(ROOT, pjPath)}`)
  }
}

console.log(`\n--- summary ---`)
console.log(`broken references found : ${brokenCount}`)
console.log(`auto-repaired           : ${fixedCount}`)
console.log(`unresolvable (by hand)  : ${unresolvableCount}`)
if (!APPLY && brokenCount > 0) {
  console.log(`\nDry run only -- re-run with --apply to write these fixes, then \`bun install\` again.`)
}
if (brokenCount === 0) {
  console.log(`no broken file:/workspace: path links found.`)
}
