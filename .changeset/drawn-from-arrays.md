---
'@flatkit/types': minor
'@flatkit/engine': minor
'@flatkit/compiler': minor
'@flatkit/player': minor
---

`polyline <xs> <ys> [count <n|"expr">] [closed]`: a shape whose points are two array variables, read every
frame. A trajectory, a curve as it is computed, a polygon the learner deforms -- what used to take hundreds
of small groups shown one by one. The segments are straight; fill, stroke, `opacity`, `draw` and `nohit`
are those of any shape. The arrays stay the truth (replayable, restorable), and a line that no longer
changes is no longer repainted. `flatc --check` reports a name that is not a declared array.
