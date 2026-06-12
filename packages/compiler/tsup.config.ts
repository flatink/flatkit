import { defineConfig } from 'tsup'

// Entries: the library index, the curated subpaths (`./compile` lean compile API, `./analysis`
// static-analysis tooling), and the CLI. `render.ts` is its own entry because flatc loads it via
// dynamic import (heavy skia path opt-in). `@flatkit/*` and `skia-canvas` stay external.
export default defineConfig({
  entry: ['src/index.ts', 'src/compile.ts', 'src/analysis.ts', 'src/cli/flatc.ts', 'src/cli/render.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: true,
  sourcemap: true,
})
