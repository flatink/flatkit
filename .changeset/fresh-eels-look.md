---
'@flatkit/types': patch
'@flatkit/engine': patch
'@flatkit/player': patch
'@flatkit/compiler': patch
---

"never used" now reads the Doc, not a text rebuilt from it — 20 false warnings became 5 true ones.

The dead-global pass counted a variable's occurrences in the text `scopeProgram` rebuilds from the Doc.
That text only carries the `object` blocks of items at the ROOT of a scope, so on a composed program whose
draggables live inside element groups most of them were simply absent: measured on a 210-line generated
activity, 3 blocks out of 11 survived the round-trip, and every variable read only in the other 8 came back
"never used". Twenty warnings, all false, on a program where nothing was wrong.

It now walks the Doc itself (`forEachExpression` / `forEachAction`, which descend the whole tree and the
symbols), plus the modifier targets and the interactor slots. That last one was the reported case: an
interactor writes through named SLOTS and guards itself with `enabled`, and neither is an expression the
walkers see — so `drag x, y { enabled over == 0 }` never counted as reading `over`.

On the reported program: 20 warnings -> 5, and those 5 are genuine (each name appears exactly once in the
source, its own declaration).
