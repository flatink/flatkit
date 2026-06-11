import { defineConfig } from 'tsup'

// All engine modules are published as subpaths (@flatkit/engine/expr, …) — they are imported by the
// player and the compiler, and by advanced consumers. Build each as its own entry; `splitting` shares
// common chunks so there is no duplication. `@flatkit/types` stays external (a real dependency).
export default defineConfig({
  entry: ['src/*.ts', '!src/*.test.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: true,
  sourcemap: true,
})
