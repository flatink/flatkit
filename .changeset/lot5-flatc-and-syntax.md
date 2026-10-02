---
"@flatkit/types": minor
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/compiler": minor
---

Nine reports from a crew writing real activities: four places where the language refused something it accepts one block away, five in `flatc`.

**Language**

- **`repeat`, `def` and `$()` in a `.flat` library** (flatink/flatink#15). `repeat i from 0 to 8 { circle $(i*20) 0 6 fill #333 }` inside a symbol's layer is unfolded when the library is read, as in a program's scene. It was refused with `"layer" expected, "repeat" found`.
- **A plain `symbol "X" { ... }` in the program** (flatink/flatink#27). The block a `.flat` holds (its own timeline, cels, states, params) can be written in the `.flatink`, before or after the scene, and instanced without parens. On a name both declare, the program's symbol wins over the library's. No dummy parameter needed any more. `parseProgram` now fills `Program.symbols`, and `splitLocalSymbols` is exported.
- **`rotate` / `scale` / `scaleX` / `scaleY` where an item is declared** (flatink/flatink#28): `group "G" at 100,100 pivot 20,0 rotate 45 scale 2 { ... }`, on a group, an instance, a text or an image. Degrees and multipliers, as in a `pose`; they turn around the pivot, which stays where `at` put it. Baked into the matrix. Not combinable with `align`.
- **A table written in place: `[a, b, c][i]`** (flatink/flatink#29). Elements and index are expressions, only the element picked is evaluated, and it indexes as an array variable does. A table that is not indexed is an error that says so.

**`flatc`**

- **BEHAVIOR CHANGE - `--play`: a pointer event takes a frame** (flatink/flatink#16). Each press, move and release of a replayed gesture is followed by one simulation step, so a rule written in `every frame` sees the drag. `--settle N` sets that number for a script, and `"settle": N` on a gesture sets it for that one; `playHeadless` takes `settle` too. `--settle 0` is exactly the replay of before. Measured on the replays of two consumers (127 scripts, 145 tests): the `send`s never change, variables that move with time do, and 5 of them fail - four `expect` a value that decays every frame, read right after a tap, and one releases a fling "one frame after the move" with a `wait` that is now one frame too many. Those need `"settle": 0` on the gesture, or the `wait` removed.
- **`--play`, gesture `turn`** (flatink/flatink#17). `angle` is the value the gesture ENDS at (the docs said "by"). Without `from`, the press goes to the object's position, then to the centre of its drawn box. A press that does not grab the target is now reported (a `warnings` entry in the result, a line on stderr) naming what is grabbed there instead; it used to turn another object, or none, in silence. It is not a failure: a script may be proving that a locked object does not respond.
- **`--preview` measures the symbol as it is drawn** (flatink/flatink#21): its `expr` channels evaluated with its params, the `--set` values included. A bar stretched by `expr scaleX "long"` was framed on its base shape and came out cropped. `containerBBox` and `containerBBoxUnion` take a `scoped` argument.
- **`--preview --frame N` on a symbol with `states`** says that it has no effect and what to write instead (flatink/flatink#23).
- **`--render --script`** (flatink/flatink#38) replays a gesture script, as `--play` does, and renders the state it reaches. A `{ "type": "shot", "name": "x" }` gesture writes `<out>.x.png` at that point; a failed `expect` exits non-zero. It was accepted and ignored. From code: `createRenderer(doc, { interactive: true })`, then `play(gestures)` and `capture()`; `renderDocToPng` takes `script`. `@flatkit/player/debug` exports `createReplayer`, and the player has `grabTargetAt(point)`.
