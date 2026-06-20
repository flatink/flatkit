---
"@flatkit/types": patch
"@flatkit/engine": patch
"@flatkit/player": patch
"@flatkit/compiler": patch
---

Fix a `flatc --check` false positive: a symbol's own `params` are now known variables in its `expr`.

A symbol can read an exposed `param` (or state param) inside a channel expression -- `expr scaleX "1 - stationnaire"` -- and the runtime and `flatc --preview` resolve it (the param is injected into the instance scope). But the semantic linter did not put those params in the scope's known ids, so it wrongly reported `unknown variable "stationnaire"`. `docLintContext` now adds the current scope's symbol params + state params, resolved from the scope's `editPath` so they are added ONLY to that symbol (a param named in symbol A can't mask a real typo of the same name in symbol B). Monotone-safe: it only adds valid names, so it can only remove false positives -- a genuinely undeclared id is still flagged.
