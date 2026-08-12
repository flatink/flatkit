---
'@flatkit/types': minor
'@flatkit/engine': minor
'@flatkit/player': minor
'@flatkit/compiler': minor
---

`arr = fill(n, v)`, a `turn` gesture that can name where it presses, and `--check` sizing a `reveal` grid
the way the engine does.

**`--check` measured a `reveal` grid on the BRUSH while the player used the GRAIN** (regression from
0.33.0, where the two were separated). Following the advice declared an array far too short, every write
past its end was dropped in silence, the fraction climbed normally, and the array stayed at zero -- so a
restored session came back with an untouched veil, `--check` green. Measured on an 880x404 zone with
`brush 36` / `grain 8`: the advice said 300 cells where the engine made 5610. It now sizes on the grain,
brush as the fallback, and names which one it measured with.

**`arr = fill(<count>, <value>)`** -- `fill` was only recognised at a declaration, so blanking a grid meant
one `arr[i] = ...` line per cell (five thousand of them, on a scratch grid). Both arguments are ordinary
expressions, evaluated when the action runs. It is the ONE array-valued assignment: expressions are scalar,
so `fill` is still not a function you can call inside one.

Writing a `reveal`'s `cells` array WHOLE now re-seats the coverage behind it, so `grid = fill(n, 0)` really
is "start this activity over" -- without that, the array would read zero while the interactor still held
the cells, and the next grab would put them all back. (An ELEMENT write, `grid[i] = 0`, stays cosmetic on
purpose: the gesture itself makes thousands of them.)

**`{ "type": "turn", "target", "angle", "from": [x, y] }`** -- the semantic gesture presses the object
where the engine finds it, which is whatever is TOPMOST there; two clock hands overlapping at noon
therefore both go to the one on top. `from` says where the finger lands. (Low-level `down`/`move`/`up`
already drove rotation interactors and picked the target under the press point -- the trap is that a move
staying collinear with the pivot writes the angle that was already there, so the object looks stuck. Both
facts are in the tooling doc now, with a test each.)
