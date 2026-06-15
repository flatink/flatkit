---
"@flatkit/engine": patch
---

Parameterized-symbol expansion no longer swallows a closing `}` that shares the instance's line. An
`instance "Name"(args) … } }` — the braces closing its layer/scene on the same line — now compiles;
before it failed with a misleading `"{" expected, "}" found`. The instance's trailing attributes now stop
at the first enclosing-block `}` (brace depth 0) or newline instead of blindly consuming to end-of-line.
