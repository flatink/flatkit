---
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/compiler": minor
---

Three leftovers of the review pass.

- **A syntax error points at its line in the author's file.** It was off by the number of `def` lines and parameterized symbols above it (they were cut out of the text before parsing; they are now blanked), it pointed inside a rebuilt text for an error in the program's own `symbol`, and `flatc` printed no line at all: it now prints `flatc: <file>:<line>:<col>: compile error: ...`. A parameterized symbol can be used inside the program's own plain symbol (it failed on `(`).
- **`printProgram` keeps a matrix**: its linear part is written with 6 decimals and its translation with 4 (two decimals turned `rotate 45` into 0.71, a couple of pixels away from the pivot at each round trip).
- **Rendering after a script paints once.** `player.withoutPainting(f)` runs `f` with painting suspended and leaves the picture dirty for the next `render()`; the renderer uses it while it replays a gesture script (200 moves and a `scratch` painted the scene 828 times, for one picture at the end).
