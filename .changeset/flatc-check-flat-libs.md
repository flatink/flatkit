---
"@flatkit/types": patch
"@flatkit/engine": patch
"@flatkit/player": patch
"@flatkit/compiler": patch
---

`flatc --check <library>.flat` now lints an asset library (per-symbol), instead of choking on it as a scene.

`--check` always routed through the program parser, so a `.flat` lib (symbols/params/layers, not a scene) failed with a cascade of `[scene] unexpected statement "symbol"`; the only way to lint an asset was to compile a preview and call the API by hand. A `.flat` first positional is now detected (like `--preview` does) and parsed with `parseFlatLib`, its symbols merged into an empty-scene Doc, and run through the SAME `lintDoc`, so every existing check (params-in-`expr`, undeclared color param in a paint, unknown functions/objects) applies for free, with the identical `[scope] line:col: level: msg` format and exit code (non-zero on error, warnings non-blocking). Several `.flat` can be passed and are merged (`flatc a.flat b.flat --check`), and `--watch` works. The program path (`flatc x.flatink --check`, with `.flat` libs as args) is unchanged.
