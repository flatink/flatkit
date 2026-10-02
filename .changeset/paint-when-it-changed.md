---
'@flatkit/engine': patch
'@flatkit/player': minor
---

The player paints less, and a component costs what it draws.

Measured on a scene of 40 component instances and 300 named objects (`packages/player/bench/components.bench.mts`,
one sim step + its render): 3.3 ms per frame before, 0.43 ms after; with 40 param writes per frame, 127 ms
before, 0.40 ms after.

- **A param write no longer paints.** `Inst.param = ...` ended in a full synchronous render, so N writes in
  an `every frame` drew the scene N + 1 times. Whoever runs the actions (the tick, a sim step, a pointer
  handler) paints once when they are done.
- **A picture that did not change is not repainted.** While it plays, the player paints a frame only when
  something the picture reads has changed: a variable, a param or a state, a settling spring, the pointer,
  a key, an image or a font that finished loading. A scene at rest costs no paint. A scene that reads
  `time`, `clock`, `frame` or `random()`, or whose keyframes play with the playhead, is painted every frame
  as before. A host that changes what is drawn behind the player's back calls `player.render()`.
- **An instance scope is chained, not copied.** Entering an instance merged its params into a copy of the
  whole scene context (every variable, every named object), per instance and per walk. `childScope` (new,
  `@flatkit/engine/expr`) links the params to the parent scope instead.
- **A spring in a library the scene does not use costs nothing.** The modifier pass was switched on by any
  symbol of the document; it now looks at what the scene can reach.
- **New option `maxPixelRatio`.** Caps the device pixel ratio the canvas is sized with: on a 3x phone, `2`
  trades a little sharpness for a much cheaper frame. No cap by default.
