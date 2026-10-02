---
'@flatkit/engine': patch
'@flatkit/compiler': patch
'@flatkit/player': patch
'@flatkit/sugarflat': patch
---

Fifteen reports from a team writing real activities, most of one family: the program compiled, `--check`
passed, and the behavior was simply not there.

**Language**
- Several `every frame` (or `when loaded`) blocks all run, in source order. Only the last one used to.
- `var z = 10 / 3` is evaluated like a `def` (a constant expression). It used to keep the `10` and drop the
  rest of the line. An initialiser that is not a constant is now an error.
- `size` is read anywhere in the header. After an `asset` line it was skipped and the scene stayed 800x600.
- Scientific notation (`1.5e2`, `2.7e-06`) is accepted in an expression, as it already was in a `var`.
- In a `.flat`, `expr rotationDeg "a"` is the degree twin of `expr rotation`, and an unknown channel name is
  a compile error. It used to compile and animate nothing.

**Checks**
- New warning: a variable (or a function parameter) hidden by a math function, a constant, a reserved name
  or a value function of the same name -- `var angle = 40` read 0 under `use "gesture"`.
- A variable read only inside a value function (`fn f() = G + 1`) is no longer reported "never used".
- "overlapping hitboxes" fires only when both zones are drop targets.

**Player**
- Writing a state it is already heading to no longer restarts its transition. Mirroring a variable into a
  state from `every frame` froze an `easeInOut` transition at its origin.
- A zero-length stroked subpath draws its cap (a disc for `round`, a square for `square`), as SVG does.
  Current Chrome follows the Canvas spec and drew nothing, so the "dot" idiom vanished.
- Word-wrap never breaks at a no-break space (U+00A0, U+202F, U+2007).
- A `sound` action is a silent no-op where there is no WebAudio, instead of a crash.

**flatc**
- `--play` and `--render` take the `.flat` libraries passed as arguments, like `--check` and the compile.
- `--play`: audio is off, and `tap` accepts a point (`"x"`, `"y"`) as well as a `"target"`.

**sugarflat**
- `place`: labels that fold to the same identifier (`-1` / `+1`, `< 1` / `= 1` / `> 1`) each get their own
  object -- the first keeps the plain name, the next ones take `_2`, `_3`. Two targets with the SAME label
  are an error.
