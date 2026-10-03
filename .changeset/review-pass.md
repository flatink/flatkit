---
"@flatkit/types": minor
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/compiler": minor
"@flatkit/sugarflat": patch
---

What a performance, quality and security pass over the 0.36-0.39 changes found, each reproduced before being fixed. Measured on four consumer repositories: no `--check` exit code changes on 789 files, 145 of 145 replay tests of one, 127 of 128 gesture scripts of another with identical output (the last differs in variables only).

**Errors that used to be silent** - a program that relied on them now fails to compile, with a message that says why:

- A `repeat` bound that is not a constant (a param, a variable) unfolded zero times; it is now an error naming the bound. A program's `def` now reaches a `repeat` in the program's own plain `symbol`. More than 5000 iterations in all, or more than 4 MB of unfolded source, is an error instead of a silent cut or a server running out of memory (a 14 KB library took 18 s and 3 GB). The `repeat` head is found by a linear scan (a regex backtracked for 12 s on 120 KB of comment).
- A `var` initialiser is read to the end of its statement: `var a = 3 == 3` gave 3, `var a = 4 garbage` gave 4. Several `var`s on one line still work.
- On a declaration line, a channel spelled `rotate` (`expr rotate "45"`, `spring rotate "a"`) is an error: it meant radians, next to `rotate <n>` in degrees. Write `rotation` or `rotationDeg`.

**Player**

- `random()` draws from two seeded streams, one for the logic and one for the picture: painting and hit-testing shifted the numbers the logic drew, so `--play` and `--render --script` disagreed on the same seed.
- On-demand painting settles: a number the picture reads repaints only when it has moved by more than 1e-4 since it was last painted (an exponential decay repainted for a minute after each trigger). The pointer repaints only when the picture reads the mouse; a playing scene is painted once per frame while dragging.
- `setParam` and `Inst.p = <number>` read the number directly (each distinct value was compiled and cached for good); `Inst.flag = true` now works; the expression cache has a ceiling.
- A crafted document's `contentParam: "constructor"` or non-string `content` no longer crashes the renderer.

**flatc and the replay**

- One budget per replay: 100 000 simulation steps in all, a `turn` of at most 10 000 sub-moves, at most 200 `shot`s; a `scratch` steps the simulation on its press and release only (it was 45x slower on a scene with `every frame`). A gesture that cannot be replayed is one line on stderr. A replayed target follows the rule of names (a text named by its content yields to a group).
- A rendered picture is at most 40 million pixels, scale included.
- `--check`: "did you mean" skips names that cannot be a typo (22 s on long names); a value function's parameter named `value` or `time` is no longer reported as hidden; path extents no longer overflow the stack on huge paths; `--since` counts lines once per file.

**sugarflat**: in `place`, an item picked and then dragged home is no longer sent back by a later tap on another target; Tab goes through the blocks in their order (each block owns a range of focus ranks).
