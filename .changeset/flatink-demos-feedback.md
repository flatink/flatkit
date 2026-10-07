---
"@flatkit/engine": minor
"@flatkit/compiler": minor
---

Five reports from flatink, found writing eight demos. A `def` whose value is a quoted text is inserted as
written (`def P = "M20 20 L280 180"`, then `path "$(P)"` several times); a `path` whose data yields nothing
is a compile error instead of an empty shape, and data that is only partly readable is a `--check` warning.
Every parser error carries its file, line and column (eleven were plain errors: `"join" belongs to stroke`
came with no position). A package function called from a scene expression (`draw "easeInOut(...)"`, a
`bind`, an `expr`, a spring target) or from a library symbol imports its package, as a call in behavior code
already did: the stroke was drawn whole, its function unresolved. `--check` warns on `each "Name"` when no
symbol has that name (it walks instances of a symbol, so it bound nothing), and on a stroked shape inside a
group ENLARGED along one axis: a stroke stretches with its group, round caps included, and `stroke ... fixed`
is the way out.
