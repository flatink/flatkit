---
"@flatkit/types": minor
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/compiler": minor
---

Symbol COLOR params can now drive gradient STOPS and a TINT, not only a solid `fill <param>`.

Recolorable generic effects (halos, glows, gradients) live in gradients and tints, but a `param color` could only feed a solid fill -- inside a `radial(...)`/`linear(...)` stop or a `tint`, the color was a baked hex and the param was dead. This generalizes the existing `fill <param>` to every place a color is accepted.

- DSL: a gradient stop accepts a param ref with an optional alpha override -- `radial(0.5, 0.5, 0.5, 0:teinte@0.8, 1:teinte@0)` -- next to literal `0:#ffe9a8cc` stops; and `tint <param> <amount>` binds a tint hue to a param. The alpha is needed because a color param is a 6-digit hue (a halo wants "same hue, alpha fading 0.8 -> 0"). Round-trips through `flatFormat`.
- Model: `Stop` gains `param?` + `alpha?`, `Tint` gains `param?` -- a unified "color ref (hex | param + alpha)". A new `resolveColorRef` is the single primitive behind solid fill, gradient stops and tint.
- Player: stops and tint resolve per instance against the same `colorParams` scope as `fill <param>`; the tint is resolved to a concrete color before the off-screen composite, so the filter-composite cache busts when the param changes.
- Engine: the merge key (`paintKey`) distinguishes a param stop from a literal one (no wrong merges); stop/tint interpolation carries the param binding.

Backward compatible: a stop/tint with no param is an ordinary literal -- every existing hex gradient and tint renders pixel-for-pixel as before. The `@` character is now a token (the stop alpha marker); it was previously ignored, and no `.flat` source used it.
