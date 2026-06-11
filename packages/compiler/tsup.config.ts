import { defineConfig } from 'tsup'

// The library entry + the CLI. `render.ts` is its own entry because flatc loads it via dynamic import
// (the heavy skia path is opt-in). `@flatkit/*` and `skia-canvas` stay external (deps / optional peer).
export default defineConfig({
  entry: ['src/index.ts', 'src/cli/flatc.ts', 'src/cli/render.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: true,
  sourcemap: true,
})
