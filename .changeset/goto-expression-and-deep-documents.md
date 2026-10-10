---
'@flatkit/engine': minor
'@flatkit/compiler': minor
'@flatkit/player': minor
'@flatkit/types': minor
---

`go to frame <expression>`, and a compiled document that nests too deep is said so.

Reported by Moiki: a generated activity held a 690-line function that only chose where to jump -- `if mes == 0 { go to frame 5160 } else if mes == 1 { go to frame 5221.364 } ...`, 343 branches -- because `go to frame` took a literal and nothing else. An `else if` compiles to an `else` holding the next `if`, two levels per branch: the compiled document was 223 levels deep, and the host's database (MongoDB, 180 levels) refused to store it.

- **`go to frame` takes an expression**, read when the action runs: `go to frame T[mes]`, `go to frame start + i * 60`, with `and play` / `and pause` as before. A jump among many is a table. Rewritten that way, the reported program goes from 1498 lines to 825 and its document from 223 levels to 18. A value that is not a number moves nothing. In the model the action carries `expr` beside `frame` (then 0, what a player older than 0.50 jumps to); a literal compiles exactly as before.
- **`--check` warns when the compiled document nests more than 100 levels** and names where: `fn sauter`, `object "X", when clicked`, a group. Measured on the 1135 programs of the consumer repos: all sit at 60 or under but the three that hold that generated chain.
- **Blocks nested more than 256 deep are one compile error.** A chain of two thousand `else if` used to end `flatc` on a stack overflow, with a JavaScript trace for a message.
- **The other nestings have a limit and a message too**: an expression nested more than 200 deep (parentheses, indexes, stacked `-` / `!`) and groups nested more than 256 deep. Each ended on "Maximum call stack size exceeded", as the text of a diagnostic or, for a long run of `-`, as a crash of the compiler. Real programs are far from it: measured on 1197 sources, parentheses nest 11 deep at most and braces 16.

The host guide says to store a `.flatpack` as a file (a string, a blob) rather than as a tree in a document database.

Cost, measured on the published builds against 0.49.0 on the two largest consumer programs (interleaved runs): check, compile and 600 simulation steps are within noise of each other.
