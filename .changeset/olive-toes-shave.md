---
'@flatkit/types': minor
'@flatkit/engine': minor
'@flatkit/player': minor
'@flatkit/compiler': minor
---

The compiler's root entry no longer drags the CLI into a browser bundle.

**Breaking, in one symbol: `run` is no longer exported from `@flatkit/compiler`.** It is the CLI entry
point, it lives in a module that imports `fs`/`path` at the top, and re-exporting it put Node builtins in
the root's chunk graph. Importing ANY symbol from the root then failed a browser build at NAME RESOLUTION
(`"extname" is not exported by "__vite-browser-external"`) -- before tree-shaking could drop the unused
`run`, and marking the package external does not help when the code is really in the graph.

The README promised the opposite ("the player stays tiny and never pulls it in"). It held for
`@flatkit/player`; it did not for anyone needing a helper only the root exported -- `languageCard`,
`drawingCard`, `docToManifest`, the three functions whose entire job is to describe the language to a model
in a service or a browser.

`flatc` is unaffected: the CLI ships as a `bin`, which imports `./cli/flatc` directly. If you imported
`run` as a library, import it from the source/dist path or shell out to the binary.

Guarded, not promised: `check-pack` now walks the built chunk graph of `@flatkit/compiler`'s `.`,
`./analysis` and `./compile` (and `@flatkit/sugarflat`'s root) and fails the release if any Node builtin is
reachable from them.
