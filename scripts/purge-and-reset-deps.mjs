#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');

// 1. Recursively find and remove all .resolved-* directories
function removeResolvedDirs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.resolved-')) {
        console.log(`Deleting resolved shim: ${fullPath}`);
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else if (entry.name !== 'node_modules' && entry.name !== '.git') {
        removeResolvedDirs(fullPath);
      }
    }
  }
}
removeResolvedDirs(ROOT);

// 2. Remove stale lockfiles
const lockfile = path.join(ROOT, 'bun.lock');
if (fs.existsSync(lockfile)) {
  console.log('Removing stale bun.lock');
  fs.rmSync(lockfile, { force: true });
}

// 3. Normalize all package.json files across packages/*
const packagesDir = path.join(ROOT, 'packages');
const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

for (const pkgName of fs.readdirSync(packagesDir)) {
  const pkgJsonPath = path.join(packagesDir, pkgName, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) continue;

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  let mutated = false;

  for (const field of depFields) {
    if (!pkg[field]) continue;
    for (const [dep, spec] of Object.entries(pkg[field])) {
      if (typeof spec === 'string' && (spec.includes('.resolved-') || spec.startsWith('file:'))) {
        // If it targets an internal @oh-my-pi or workspace package, reset to workspace:*
        if (dep.startsWith('@oh-my-pi/')) {
          console.log(`[${pkgName}] Resetting ${dep}: ${spec} -> workspace:*`);
          pkg[field][dep] = 'workspace:*';
          mutated = true;
        }
      }
    }
  }

  if (mutated) {
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');
  }
}

console.log('Dep purge and workspace normalization complete.');
