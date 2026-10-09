---
'@flatkit/compiler': patch
'@flatkit/engine': patch
'@flatkit/player': patch
---

Nine defects of the code found while checking the guides against it.

- An object that follows a `guide layer` reads where it is drawn: `Boat.x` / `Boat.y`, its rotation under `orient`, and `self` in its handlers gave the straight line between its two poses while the boat was drawn on the curve. A gesture script now presses it there too.
- A text written `as "<id>"` is an object like another: a variable set by its handlers or its `drag` was "unknown" to every other block, a `--play` gesture could not name it, and `match` over such texts failed to check. `text(it)` in a `match` therefore has a clean form: the items are the texts themselves.
- A statement written on the `object "X" { ... }` line itself reported its column counted from the brace, so `flatc --fix` could not split a run-on line there; and `feedback lift` on that line was not recognised.
- `arr[i] = v` on a name that is not an array is a warning (the write was dropped at run time, in silence), with the declaration to write.
- A state name inside an expression (`Door.door = score > 5 ? open : closed`) is a warning: the name is only read when it is the whole value, and was read as 0.
- `spring dx "..."` / `smooth dy "..."` in a `.flat` is a compile error, as in an `object` block: it compiled and moved nothing.
- Three warnings said `1:1`: `draw` on a shape with no stroke, a filter under a transform that never settles, and the same-direction-contours warning when two paths start alike (it now names its path as far as it takes to tell it from the others, and lands on it).
- The hint of a missing `text("id")` wrote `as` after `at`, which does not compile.

Measured before shipping: none of the new diagnostics fires on the 1197 `.flat` / `.flatink` sources of the consumer repos.
