---
'@flatkit/types': patch
'@flatkit/engine': patch
'@flatkit/player': patch
'@flatkit/compiler': patch
---

Interactor options are one per LINE, and the error now says so.

`dragX cx { confine to Rail  snap 26 }` on a single line failed with `end of line expected` at a column,
which names nothing. Four reference listings (flatink-core, flatink-lite, role-coder, behavior-and-interactions)
separated the options with a decorative middle dot, so that is exactly what a reader -- or a model prompted
with them -- writes. The listings now show the one-per-line form, and a run-on line names the rule.
