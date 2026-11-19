#!/usr/bin/env bun
import fs from 'fs'
import path from 'path'

// Bug (confirmed): the original computed
//   path.resolve(import.meta.dir + '/../..')
// import.meta.dir is *already* the directory containing this file
// (Bun's __dirname equivalent), i.e. "<repo>/scripts". Going up TWO
// levels lands one directory ABOVE the actual repo root, so ROOT pointed
// at the parent of the monorepo instead of the monorepo itself. Only one
// ".." is needed to get from "scripts/" back to the repo root.
const ROOT = path.resolve(import.meta.dir + '/..')

const rootPkgPath = path.join(ROOT, 'package.json')
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'))

// Bun's actual rule (see "Catalog vs Catalogs" / Nx's Bun-workspaces notes):
//   - `catalog:` resolves ONLY against the top-level/nested `catalog` field.
//   - `catalog:default` addresses a *named* catalog literally called
//     "default" under `catalogs`. Bun does NOT treat catalogs.default as an
//     alias for the base catalog field.
//   - Definition locations are all-or-nothing: if EITHER `catalog` or
//     `catalogs` exists nested under `workspaces`, Bun ignores the
//     top-level `catalog`/`catalogs` fields entirely rather than merging.
// The original script's `{ default: catalog, ...catalogs }` merge broke
// the first rule: if a real `catalogs.default` existed it would silently
// shadow the base catalog for bare `catalog:` references. Kept separate
// here to match documented behavior exactly.
const hasNestedCatalogDef =
  rootPkg.workspaces?.catalog !== undefined ||
  rootPkg.workspaces?.catalogs !== undefined

const catalog = hasNestedCatalogDef
  ? (rootPkg.workspaces?.catalog || {})
  : (rootPkg.catalog || {})
const catalogs = hasNestedCatalogDef
  ? (rootPkg.workspaces?.catalogs || {})
  : (rootPkg.catalogs || {})

console.log('base catalog keys:', Object.keys(catalog))
console.log('named catalogs:', Object.keys(catalogs))

function resolveCatalogEntry(depName, catalogRef) {
  // catalogRef is everything after "catalog:" -- '' for a bare `catalog:`
  if (catalogRef === '') {
    return catalog[depName]
  }
  const named = catalogs[catalogRef]
  if (named && named[depName] !== undefined) return named[depName]
  // Fall back to the base catalog only as a last resort, and say so --
  // this is a lenient extension beyond Bun's documented behavior, not a
  // guarantee, since Bun itself would error on an unresolved reference.
  if (catalog[depName] !== undefined) {
    console.warn(`  ! "${depName}": catalog:${catalogRef} not found, falling back to base catalog`)
    return catalog[depName]
  }
  return undefined
}

function findWorkspaces() {
  const patterns = rootPkg.workspaces?.packages || rootPkg.workspaces || ['packages/*']
  const list = []
  for (const pat of patterns) {
    const base = pat.replace('/*', '').replace('/**', '')
    const full = path.join(ROOT, base)
    if (!fs.existsSync(full)) continue
    for (const d of fs.readdirSync(full)) {
      const p = path.join(full, d)
      if (fs.existsSync(path.join(p, 'package.json'))) list.push(p)
    }
  }
  return list
}

const workspaceDirs = findWorkspaces()

// Build a name -> absolute directory map so "workspace:*" / "workspace:^" /
// "workspace:~" / "workspace:1.2.3" (the *range* forms of the protocol) can
// be resolved BY THE DEPENDENCY'S PACKAGE NAME, matching how bun/pnpm/yarn
// actually resolve them -- NOT by treating the version text itself as a
// filesystem path. "workspace:./pkg" / "workspace:../pkg" (the *path*
// forms) are the only forms where the text after "workspace:" is really a
// path, and those are left alone below.
const nameToDir = new Map()
for (const dir of workspaceDirs) {
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    if (pj.name) nameToDir.set(pj.name, dir)
  } catch {
    // unreadable/invalid package.json in a workspace dir; skip it
  }
}

function isPathForm(spec) {
  return spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')
}

for (const pkgPath of workspaceDirs) {
  const pjPath = path.join(pkgPath, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pjPath, 'utf8'))
  let changed = false

  for (const depType of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    if (!pkg[depType]) continue

    for (const [name, ver] of Object.entries(pkg[depType])) {
      if (typeof ver !== 'string') continue

      if (ver.startsWith('catalog:')) {
        const catalogRef = ver.slice('catalog:'.length)
        const resolved = resolveCatalogEntry(name, catalogRef)
        if (resolved) {
          console.log(`${path.basename(pkgPath)}: ${name} ${ver} -> ${resolved}`)
          pkg[depType][name] = resolved
          changed = true
        } else {
          console.warn(`  ! could not resolve ${name} ${ver} in ${path.basename(pkgPath)}`)
        }
      }

      if (ver.startsWith('workspace:') || ver.startsWith('file:')) {
        let absTarget
        if (ver.startsWith('file:')) {
          absTarget = path.resolve(pkgPath, ver.slice('file:'.length))
        } else {
          const spec = ver.slice('workspace:'.length)
          if (isPathForm(spec)) {
            // path form: text after "workspace:" really is a relative path
            absTarget = path.resolve(pkgPath, spec)
          } else {
            // range form (*, ^, ~, an exact version) or alias form
            // (name@range): resolve by the dependency's package name
            const aliasMatch = spec.match(/^(.+)@[^@]*$/)
            const lookupName = aliasMatch ? aliasMatch[1] : name
            absTarget = nameToDir.get(lookupName)
            if (!absTarget) {
              console.warn(`  ! no workspace member named "${lookupName}" for ${name}@${ver} in ${path.basename(pkgPath)}`)
              continue
            }
          }
        }

        if (fs.existsSync(path.join(absTarget, 'package.json'))) {
          const targetPkg = JSON.parse(fs.readFileSync(path.join(absTarget, 'package.json'), 'utf8'))
          const resolvedDir = path.join(ROOT, `.resolved-${name.replace('/', '+')}`)
          if (!fs.existsSync(resolvedDir)) {
            fs.mkdirSync(resolvedDir, { recursive: true })
            fs.writeFileSync(path.join(resolvedDir, 'package.json'), JSON.stringify(targetPkg, null, 2))
            for (const dir of ['dist', 'src']) {
              const src = path.join(absTarget, dir)
              const dst = path.join(resolvedDir, dir)
              if (fs.existsSync(src) && !fs.existsSync(dst)) {
                fs.cpSync(src, dst, { recursive: true, dereference: true })
              }
            }
            console.log(`materialized ${resolvedDir}`)
          }
          pkg[depType][name] = `file:${path.relative(pkgPath, resolvedDir)}`
          changed = true
        } else {
          console.warn(`  ! resolved target has no package.json: ${absTarget}`)
        }
      }
    }
  }

  if (changed) {
    fs.writeFileSync(pjPath, JSON.stringify(pkg, null, 2) + '\n')
  }
}
console.log('done - now bun install --linker hoisted')
