import { defineConfig } from 'tsup'

// Entries: the standard player (`@flatkit/player`), the authoring/CI tools (`./debug`), and the
// curated toolkits (`./render` = drawing, `./hit` = hit-testing) for canvas tools built on the player.
// `splitting` shares common code. `@flatkit/engine` and `@flatkit/types` stay external.
export default defineConfig({
  entry: ['src/index.ts', 'src/debug.ts', 'src/drawScene.ts', 'src/hit.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: true,
  sourcemap: true,
})
