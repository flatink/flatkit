---
"@flatkit/compiler": minor
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/types": minor
---

Warn when a program never declares `size`.

The line is REQUIRED by the format, and the compiler silently defaulted it to 800x600 - so a document
laid out for one canvas was drawn on another, with everything past the edge clipped away and nothing to
say so. Measured cost of that silence: a generator omitted the line across its entire corpus for months,
undetected. A warning rather than an error, because checking a fragment on its own is legitimate.
