---
"@flatkit/types": minor
"@flatkit/engine": minor
"@flatkit/compiler": minor
"@flatkit/player": minor
---

feat: additive position offsets `dx`/`dy` (`pos = at + (dx, dy)`)

New binding-only channels `dx` and `dy` shift an object's resolved position in parent space,
on top of its declared `at X,Y` (and any absolute `x`/`y` channel). The natural offset idiom
`object "G" { dx = 30*sin(time) }` now oscillates AROUND the anchor instead of deserting to the
origin -- no need to re-inject the base (`x = 620 + ...`). Absolute `x`/`y` still REPLACE `at`
(unchanged); `dx`/`dy` add on top when both are bound (`pos = x + dx`). Offsets are stateless and
binding-only: no keyframe, `spring`, or `smooth` form. Zero change for any scene that does not use
them. Discoverable in the `flatc` manifest/language card and documented in dsl-gotchas /
behavior-and-interactions.
