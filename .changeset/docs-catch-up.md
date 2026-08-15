---
'@flatkit/compiler': patch
---

The docs catch up with what the renderer actually does.

`filter` performance was described on the state of things before 0.35.0: "cached per group carrying the
filter". A filtered SHAPE is cached too now (it was not, and re-composited every frame, moving or not), the
cache is per INSTANCE (eight lanterns from one symbol used to share one entry), what defeats it is a
periodic `clock`/`time` motion on the item or an ancestor -- with the numbers, and the `--check` warning
that names it -- and a document keeps at most 256 baked composites.

`--check`'s coverage list in the tooling guide had drifted three releases behind: it now includes the
silent-nothing checks shipped since (a `draw` with no `stroke`, a `reveal ... cells` array whose length
does not match the grid, a `step` of 0 that makes a trace impossible to finish, `both ends` without `step`,
a non-positive `tolerance`/`brush`/`grain`, and the filter-cache warning).
