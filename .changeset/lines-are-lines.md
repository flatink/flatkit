---
'@flatkit/engine': minor
'@flatkit/compiler': minor
---

In a `path`, a line is a line -- and `smooth` says when it is not.

A path made only of `L` / `H` / `V` used to be read as free-hand material: every vertex turning by less
than 60 degrees was rounded, so a hexagon or an octagon written by hand came out soft. It is now drawn
with straight sides, as its data says.

- **`path "..." smooth`** (right after the path data) reads the path as free-hand material instead: what
  the editor's brush produces, and what a curve sampled as many small `L` steps wants. The export writes
  the word by itself for material, so nothing changes for a document drawn in the editor.
- **BEHAVIOR CHANGE** for a text source recompiled: a path of lines with gentle turns loses its rounding
  unless it says `smooth`. Compiled `.flatpack` documents are not affected (the rule is the parser's).
- **`flatc --check`** points at a long run of points (12 or more, mostly gentle turns, no curve) that
  does not say `smooth`: very likely material or a sampled curve written before the word existed.
- `parsePathData(d, { smooth: true })` is the same switch for a caller of the engine.
