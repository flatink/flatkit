---
'@flatkit/types': patch
'@flatkit/engine': patch
'@flatkit/player': patch
'@flatkit/compiler': patch
---

The `link` thread idiom is in the prompts, as a program that compiles.

`link` returns the end point and the target index; it does NOT draw the thread, and nobody writes anything
but `rotation = angle(...)` / `scaleX = dist(...) / <drawn length>`. Those two lines were in the guide and
in none of the six embedded prompts -- so every integrator rediscovered them. `flatink-core` and
`role-coder` now carry a complete worked program (compiled by `prompts.test.ts`), and `flatink-lite` the
two lines.
