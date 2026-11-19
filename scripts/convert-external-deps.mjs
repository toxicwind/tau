#!/usr/bin/env bun
import fs from 'node:fs'
import path from 'node:path'

// Locate monorepo root: import.meta.dir is ~/tau/scripts -> parent is ~/tau
const ROOT = path.resolve(import.meta.dir, '..')
const rootPkgPath = path.join(ROOT, 'package.json')

if (!fs.existsSync(rootPkgPath)) {
  console.error(`Root package.json not found at: ${rootPkgPath}`)
  process.exit(1)
}

const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'))
const catalog = rootPkg.workspaces?.catalog || rootPkg.catalog || {}
const catalogs = rootPkg.workspaces?.catalogs || rootPkg.catalogs || {}
const allCatalogs = { default: catalog, ...catalogs }

function convertPackage(pkgPath) {
  const pkgJsonPath = path.join(pkgPath, 'package.json')
  if (!fs.existsSync(pkgJsonPath)) return

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
  const orig = JSON.stringify(pkg, null, 2)

  const depSections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
  for (const depType of depSections) {
    if (!pkg[depType]) continue
    for (const [depName, ver] of Object.entries(pkg[depType])) {
      if (typeof ver !== 'string' || !ver.startsWith('catalog:')) continue

      const parts = ver.split(':')
      const catName = parts[1] || 'default'

      if (ver === 'catalog:' || ver === 'catalog:default') {
        if (allCatalogs.default?.[depName]) {
          pkg[depType][depName] = allCatalogs.default[depName]
        }
      } else {
        const targetCat = allCatalogs[catName]
        if (targetCat?.[depName]) {
          pkg[depType][depName] = targetCat[depName]
        } else if (allCatalogs.default?.[depName]) {
          pkg[depType][depName] = allCatalogs.default[depName]
        }
      }
    }
  }

  if (JSON.stringify(pkg, null, 2) !== orig) {
    fs.writeFileSync(`${pkgJsonPath}.bak`, orig)
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2))
    console.log(`Converted: ${path.relative(ROOT, pkgJsonPath)}`)
  }
}

const rawWorkspaces = rootPkg.workspaces?.packages || rootPkg.workspaces || ['packages/*']
const workspaces = Array.isArray(rawWorkspaces) ? rawWorkspaces : ['packages/*']

for (const pattern of workspaces) {
  const base = pattern.replace(/\/\*.*$/, '')
  const fullBase = path.join(ROOT, base)
  if (!fs.existsSync(fullBase)) continue

  for (const entry of fs.readdirSync(fullBase)) {
    const pkgPath = path.join(fullBase, entry)
    if (fs.existsSync(path.join(pkgPath, 'package.json'))) {
      convertPackage(pkgPath)
    }
  }
}
console.log('Catalog substitution complete.')
