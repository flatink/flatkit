#!/usr/bin/env node
// flatc binary entry point: registers tsx (to run the TypeScript compiler as-is -- relative imports
// without extensions, workspace packages), then launches the CLI.
import { register } from 'tsx/esm/api'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

register()
const here = dirname(fileURLToPath(import.meta.url))
const { run } = await import(join(here, '../src/cli/flatc.ts'))
const code = await run(process.argv) // `--render` is async (SVG decode + raster)
// In --watch mode, `fs.watch` keeps the process alive: do not exit (otherwise we kill the watcher).
if (!process.argv.includes('--watch')) process.exit(code)
