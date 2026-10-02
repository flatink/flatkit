---
"@flatkit/types": minor
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/compiler": minor
---

Three questions from people writing real activities, answered in the docs, with one addition to the language.

- **`DT`, the simulation step** (flatink/flatink#34). A new constant: the duration of one `every frame` run, in seconds, 1/60. `every frame` has always been a fixed 60 Hz step whatever the `timeline` fps and whatever the display; the language now names it, so an integration is `v = v + a * DT` instead of a `dt` measured from `clock` in every activity. (In a browser `clock` follows real time once per display, so two steps run in the same display read the same `clock`: a measured `dt` is the display's duration, then 0.) `--check` reports a variable named `DT` as hidden by the constant. `SIM_HZ` is exported by `@flatkit/engine/expr`.
- **How a frame runs** (flatink/flatink#33 #34): a new section of `docs/behavior-and-interactions.md`. Handlers run when their event arrives, before the next step; then the 60 Hz steps (the scene's `every frame`, the active symbols', then `at frame` scripts); then the picture, where channel bindings are read. It says what a handler sees of a value derived in `every frame`, and what happens when the display stalls: at most 0.25 s counted and 30 steps run per display, the rest dropped, so the simulation slows down and never jumps.
- **Determinism** (flatink/flatink#36): a new section of `docs/expressions-and-stdlib.md`. Which built-in functions give the same bits on every engine (the operators, `sqrt`, `floor`, `round`, `mod`, `clamp`, `lerp`...) and which ECMAScript leaves to the implementation (`sin`, `cos`, `pow`, `exp`, `log`, `hypot`...); how `%`, `round` and `random()` behave for someone writing a replica in another language.

Each statement of those two sections is pinned by a test next to the code, and a test fails when a built-in function is added without being classified.
