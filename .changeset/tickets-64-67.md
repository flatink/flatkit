---
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/compiler": minor
---

Fixes and checks from flatink/flatink#64 #65 #66 #67.

Bugs: `at frame` runs for every whole frame the playhead crossed, not only the one it landed on; a plain
`flatc` compile with an error exits 1 (the pack is still written); `else` may open the line after the `}`
(its body used to run unconditionally); a var array reads each cell as a constant expression
(`[PI / 2, 1]`); compact SVG arc flags (`a10 10 0 0120 0`); `text("id")` of a bound text sends the
displayed value; `pause` in `when loaded` holds against `autoplay`; `shake` is 4 degrees, not 4 radians;
`ease bounce` no longer crashes the render.

Stricter parsing (each used to compile and lose content or draw the default): a required asset kind
(file-type words such as `png` or `mp3` stand for it), two numbers after `timeline`, known easings,
filters, `blend`, `cap`, `join`, text `align`, pose `spin`, 3/4/6/8-digit colours, `clip` only on a group
or an instance, a solid `background`, symbols only in a `.flat`, `spring` / `smooth` with their own slots
and a required `stiffness` / `k`.

New `--check` diagnostics: wrong argument counts, unknown procedure calls, an unknown package, two
interactors on one object, `when dropped on` with nothing draggable, an `at frame` that never runs,
`sound` of an undeclared asset, `text()` of a missing text, a `fn` or `var` hidden by a built-in, an
object name matching several items, no more false "never used" for a variable read by `each`.

Decided: a script `pause` holds the playhead only (like Flash's `stop()`): `every frame`, `clock` and
springs go on, `--play` follows, and the host's `play()` no longer undoes it (its `pause()` still freezes
the player). A `repeat i from A to B` variable is the loop's own. `repeat 3 {` without `times` carries
its `--fix` repair. `self` in a handler stays in scene space (documented).
