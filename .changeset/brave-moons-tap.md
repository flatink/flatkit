---
'@flatkit/types': patch
'@flatkit/engine': patch
'@flatkit/player': patch
'@flatkit/compiler': patch
---

Per-item constructs at the program level were dropped in silence too -- now an error.

The mirror of the fix in 0.29.1. A `when clicked`, a channel binding (`opacity = 0.5`) or an interactor
(`drag a, b`) written OUTSIDE any `object` block belongs to an item, and there is no item there:
`unitsToTimeline` keeps only the scene-wide kinds and drops the rest. `--check` passed, and the only
signal was a "never used" warning about the variable the dropped handler wrote -- which points at the
wrong thing entirely. The message now names the construct and says to wrap it in `object "Name" { … }`.
