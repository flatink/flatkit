---
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/compiler": minor
---

Three leftovers of the review pass.

- **A syntax error points at its line in the author's file.** It was off by the number of `def` lines and parameterized symbols above it (they were cut out of the text before parsing; they are now blanked), it pointed inside a rebuilt text for an error in the program's own `symbol`, and `flatc` printed no line at all: it now prints `flatc: <file>:<line>:<col>: compile error: ...`. A parameterized symbol can be used inside the program's own plain symbol (it failed on `(`).
- **A loop or a parameterized symbol no longer moves the lines below it.** Unfolding put one item per line, so a scene `repeat` of ten pushed every line after it down - an error further down, in the scene or in an `object` block, was reported up to tens of lines too low. The unfolded text now keeps the line count of the source (items are separated by a break that is not a line): an error after the loop is at its own line, an error inside it at the line of the `repeat`. The same for a parameterized symbol unfolded at its call, and for `each` and `match` blocks: the behaviour parser treats that break as the end of a statement, and drops the mechanical repair of a diagnostic that falls on unfolded code (its range would not be the author's text).
- **`printProgram` keeps a matrix**: its linear part is written with 6 decimals and its translation with 4 (two decimals turned `rotate 45` into 0.71, a couple of pixels away from the pivot at each round trip).
- **Rendering after a script paints once.** `player.withoutPainting(f)` runs `f` with painting suspended and leaves the picture dirty for the next `render()`; the renderer uses it while it replays a gesture script (200 moves and a `scratch` painted the scene 828 times, for one picture at the end).
