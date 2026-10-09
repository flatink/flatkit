---
'@flatkit/engine': minor
---

A symbol name declared twice is a compile error. Two `symbol "X" { ... }` in one program, or in one `.flat` library, used to compile without a word: the pack carried both, the instances went to the last one declared, and the first was drawn nowhere. The second declaration is now refused, with the line of the first (`symbol "X" is already declared at line 3`), and `flatc --check` / `checkProgram` report it at its position. The same goes for two parameterized `symbol "X"(...)` templates. What does not change: a symbol written in the program still wins over a library symbol of the same name, and a template may share its name with a plain symbol. Measured before refusing: none of the 1106 `.flat` / `.flatink` sources of the consumer repos declares a name twice.
