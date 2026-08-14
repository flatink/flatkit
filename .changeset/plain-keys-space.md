---
'@flatkit/engine': patch
---

`object"R"` parses like `object "R"` -- the space between a keyword and its literal is nowhere significant.

It already was not, everywhere else: the grammar is tokenized, so `layer"L"`, `text"Hi"`, `font"sans-serif"`
and `send"win"` all parse. The one exception was `object`, whose block splitter is a regex over the source
and demanded a space -- making `object"R"` the only spelling in the language that failed.

The asymmetry is invisible until something reads DSL BY PATTERN, and then it costs: a consumer merging
generated fragments guarded against them emitting events with a regex on `send\s+"..."`. It let `send"..."`
straight through, one character from the rule it enforced.

Both spellings round-trip to the canonical one-space form, which is what `flatc` prints.

Deciding what a fragment is allowed to DO is still not a job for a pattern, and the docs now say where to
look instead: `manifestEvents(doc)` returns every event any action emits -- procedures, `if`/`repeat` bodies
and timeline hooks included -- so it also catches the case no regex can see, a fragment that never writes
`send` and calls a function that does.
