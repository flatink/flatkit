---
"@flatkit/sugarflat": minor
---

flatink/flatink#39: controls, a new kind of block. A control is an input, not a task: it writes
`<name>_value`, sends `change` with `{ block, value }` when the value moves, has no end (`meta[].control`,
empty `doneVar`) and does not hold back the document's `completed`. `stepper <name> { min max [step] [start]
minus at x,y  plus at x,y  [counter at x,y] }`: a step at the press, then a repeat while held (after 0.4 s,
every 0.12 s); Enter or Space on the focused button steps once. `slider <name> { min max [step] [start]
rail x,y to x,y  [minus at x,y  plus at x,y]  [counter at x,y] }`: a handle on a horizontal or vertical
rail, set by a press or a drag, `change` sent once at the release; the optional ends are its keyboard way in.
