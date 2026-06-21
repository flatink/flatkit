---
"@flatkit/types": patch
"@flatkit/engine": patch
"@flatkit/player": patch
"@flatkit/compiler": patch
---

`flatc --check` now flags a `color` param used as a paint that the symbol doesn't declare.

A gradient stop (`0:teinte@0.8`), a `tint <param> <amount>`, or a `fill`/`stroke <param>` that references an undeclared (or mistyped) color param silently falls back to the literal hex at render -- a "dead recolor": the asset looks fine but the picker does nothing. The lint now walks each symbol's paints and warns on a color-param reference the owning symbol doesn't declare, scoped to that symbol (a `teinte` declared in symbol A doesn't silence the same name in symbol B). Non-blocking (a warning), so it can only surface a latent bug, never break a build. Complements the earlier "the lint knows a symbol's params in its expr" fix.
