import { defineConfig } from 'tsup'

// A single library entry. `@flatkit/compiler` stays external: the sugar DEPENDS on the language, and
// never the other way round -- that direction is what keeps the language free of authoring opinions.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
})
