---
"@flatkit/engine": patch
---

Fix: behavior (`fn`, `every frame`, `object`, `label`) placed BEFORE the `scene { … }` block is now parsed
instead of silently dropped — and, critically, no longer makes the composition parser bail and discard the
WHOLE scene (it produced `layers: []`, a blank render). The behavior region is now the entire program
outside the `scene { … }` block (header and tail alike), with the scene block and the single-line header
directives masked out. A value-function called from an `every frame` script (`fn dbl(n) = n*2` →
`d = dbl(a)`) consequently returns the right value regardless of where the `fn` is declared, where it used
to return 0. Programs that already keep behavior after the scene block are unaffected.
