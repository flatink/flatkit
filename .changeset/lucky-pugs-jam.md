---
'@flatkit/types': minor
'@flatkit/engine': minor
'@flatkit/player': minor
'@flatkit/compiler': minor
---

Diagnostics carry their repair, and `flatc --fix` applies it.

Some errors have exactly ONE possible repair -- a separator the author left out -- and the parser already
computed it in order to print it in the message. That information was thrown away in a string. It is now a
`fix` on the diagnostic: a `TextEdit` replacing a range, present only when the repair is the single
possible reading of the text.

Four slips today, all a missing separator: `at 12 -16` (the comma), `#` used as a comment (`//`, and only
when the rest of the line holds no brace -- otherwise it would comment out the closing one), two
statements on one line, and a run-on interactor block. Anything needing a DECISION -- an unknown event
name, a `when <condition>`, a binding at the program level that must name its object -- is reported and
left alone.

`flatc --fix` iterates (repairing one error unmasks the next: a run-on interactor line swallows the
statements under it) and writes only if the error count strictly drops, reverting otherwise. It also runs
when the source does not parse AT ALL, which is where a mechanical repair earns its keep.

`applyFixes(src, diagnostics)` is exported so the same repairs apply in a service, with no subprocess: a
missing comma should not cost a whole regeneration.

Along the way the flat parser gained POSITIONS. Every syntax error used to be reported at 1:1 -- accurate
about the token, useless about where to look. `FlatSyntaxError` carries line, column, and sometimes the
fix.
