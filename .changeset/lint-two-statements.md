---
"@flatkit/compiler": patch
---

Clearer lint diagnostic for the #1 footgun — two statements on one line. FlatInk ends a statement at the
newline, so a second `channel = …` crammed onto the same line gets swallowed into the first expression.
`flatc --check` now reports "two statements on one line — put each on its own line" instead of the cryptic
"invalid expression: unexpected character =". (Comparisons `==`/`<=`/`>=`/`!=` are not mistaken for it.)
