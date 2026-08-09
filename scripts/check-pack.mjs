#!/usr/bin/env node
// Publishability gate: pack each package, then lint the would-be-published tarball.
//  - publint: package.json well-formedness (exports/files/types) on every package.
//  - attw (--profile esm-only): type-resolution across module systems, ESM-only profile so the
//    intentional "no CJS / no node10" results are not flagged. Skipped for @flatkit/engine, whose
//    `./*` wildcard exports cannot be enumerated by attw (publint still covers it).
// We pack manually (`pnpm pack`) and lint the tarball — publint's own `--pack` mis-detects the PM here.
// Run AFTER `pnpm build` (see the `check:pack` script). Exits non-zero on the first failure.
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'

const PACKAGES = ['types', 'engine', 'player', 'compiler']

/**
 * Every published subpath must answer `require` as well as `import` — pointing at the SAME ESM file.
 * We ship no CJS build (so there is no dual-package hazard: one file, one module instance), but a subpath
 * that declares only `import` makes `require()` fail with `ERR_PACKAGE_PATH_NOT_EXPORTED` — a message
 * saying the subpath "is not defined by exports" when it plainly is. Node ≥ 24 (this repo's floor)
 * requires ESM natively, so the condition costs nothing and removes a dead end nobody could diagnose.
 */
function checkRequireConditions(name) {
  const pkg = JSON.parse(readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), 'utf8'))
  for (const [subpath, cond] of Object.entries(pkg.publishConfig?.exports ?? {})) {
    if (typeof cond !== 'object' || !cond.import) continue
    if (cond.require !== cond.import) {
      console.error(`✗ @flatkit/${name} "${subpath}": exports declare "import" but not a matching "require" — require() of this subpath fails with ERR_PACKAGE_PATH_NOT_EXPORTED`)
      process.exit(1)
    }
  }
}

for (const name of PACKAGES) {
  const cwd = new URL(`../packages/${name}`, import.meta.url).pathname
  process.stdout.write(`\n── @flatkit/${name} ──\n`)
  checkRequireConditions(name)
  const tgz = execFileSync('pnpm', ['pack'], { cwd, encoding: 'utf8' }).trim().split('\n').pop()
  try {
    execFileSync('pnpm', ['exec', 'publint', tgz], { cwd, stdio: 'inherit' })
    if (name !== 'engine') execFileSync('pnpm', ['exec', 'attw', tgz, '--profile', 'esm-only'], { cwd, stdio: 'inherit' })
  } finally {
    rmSync(new URL(`../packages/${name}/${tgz}`, import.meta.url), { force: true })
  }
}
process.stdout.write('\ncheck-pack: all packages publishable ✓\n')
