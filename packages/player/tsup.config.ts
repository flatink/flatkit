import { defineConfig } from 'tsup'

// Two outputs:
//  1. The LIBRARY build (`.`, `./debug`, `./render`, `./hit`): code-split ESM with
//     `@flatkit/engine` / `@flatkit/types` left EXTERNAL — the consumer's bundler resolves them.
//  2. A self-contained BROWSER bundle (`./browser` → dist/browser.js): a single ESM file with
//     engine+types INLINED and no bare imports, droppable straight into a `<script type="module">`
//     or a static site (no bundler needed). This is the player's primary "embed me" use case.
export default defineConfig([
  {
    entry: ['src/index.ts', 'src/debug.ts', 'src/drawScene.ts', 'src/hit.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    splitting: true,
    sourcemap: true,
  },
  {
    entry: { browser: 'src/index.ts' },
    format: ['esm'],
    noExternal: [/@flatkit\/.*/], // inline the workspace deps → zero bare imports
    splitting: false, // one file
    dts: false,
    sourcemap: false,
    minify: true,
    clean: false, // keep the library build above
  },
])
