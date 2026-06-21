---
"@flatkit/types": patch
"@flatkit/engine": patch
"@flatkit/player": patch
"@flatkit/compiler": patch
---

FlatInk now tolerates several statements on one line: `a = 1  b = 2` parses as two
statements instead of erroring with "two statements on one line". The parser splits
at the boundary of a second assignment/binding (the #1 LLM footgun) in action bodies
and channel bindings, so lint and compile both accept it. Single-expression slots
(e.g. a `send` payload) still reject a stray `=`. The language card now states the
one-statement-per-line rule explicitly to steer generators toward the canonical form.
