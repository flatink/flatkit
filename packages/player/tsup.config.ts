import { defineConfig } from 'tsup'

// Two entries: the standard player (`@flatkit/player`) and the authoring/CI tools
// (`@flatkit/player/debug`). `splitting` shares the common code between them. `@flatkit/engine` and
// `@flatkit/types` stay external (real dependencies) — the published player code is its own.
export default defineConfig({
  entry: ['src/index.ts', 'src/debug.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: true,
  sourcemap: true,
})
