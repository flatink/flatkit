#!/usr/bin/env node
// Publishability gate: pack each package, then lint the would-be-published tarball.
//  - publint: package.json well-formedness (exports/files/types) on every package.
//  - attw (--profile esm-only): type-resolution across module systems, ESM-only profile so the
//    intentional "no CJS / no node10" results are not flagged. Skipped for @flatkit/engine, whose
//    `./*` wildcard exports cannot be enumerated by attw (publint still covers it).
// We pack manually (`pnpm pack`) and lint the tarball — publint's own `--pack` mis-detects the PM here.
// Run AFTER `pnpm build` (see the `check:pack` script). Exits non-zero on the first failure.
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const PACKAGES = ['types', 'engine', 'player', 'compiler']

for (const name of PACKAGES) {
  const cwd = new URL(`../packages/${name}`, import.meta.url).pathname
  process.stdout.write(`\n── @flatkit/${name} ──\n`)
  const tgz = execFileSync('pnpm', ['pack'], { cwd, encoding: 'utf8' }).trim().split('\n').pop()
  try {
    execFileSync('pnpm', ['exec', 'publint', tgz], { cwd, stdio: 'inherit' })
    if (name !== 'engine') execFileSync('pnpm', ['exec', 'attw', tgz, '--profile', 'esm-only'], { cwd, stdio: 'inherit' })
  } finally {
    rmSync(new URL(`../packages/${name}/${tgz}`, import.meta.url), { force: true })
  }
}
process.stdout.write('\ncheck-pack: all packages publishable ✓\n')
