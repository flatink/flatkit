#!/usr/bin/env node
// flatc binary entry point.
//  DEV (workspace): tsx is installed and `@flatkit/*` resolve to TypeScript source → register tsx and
//  run the source directly (no build needed for `pnpm flatc …`).
//  PUBLISHED: tsx is not a dependency (and no `src/` is shipped) → fall back to the compiled
//  `dist/cli/flatc.js`, where `@flatkit/*` resolve to their published JS.
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

let run
try {
  const { register } = await import('tsx/esm/api') // throws in a published install (tsx absent)
  register()
  ;({ run } = await import(join(here, '../src/cli/flatc.ts'))) // throws if src/ was not shipped
} catch {
  ({ run } = await import(join(here, '../dist/cli/flatc.js')))
}

const code = await run(process.argv) // `--render` is async (SVG decode + raster)
// In --watch mode, `fs.watch` keeps the process alive: do not exit (otherwise we kill the watcher).
if (!process.argv.includes('--watch')) process.exit(code)
