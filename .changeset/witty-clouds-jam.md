---
"@flatkit/sugarflat": patch
---

Make the documentation a test, because three times it promised a form the parser rejected.

`raw { ... }` on one line (the README wrote it that way), decor in a plain `raw` (the card taught it),
and now a block written inline (the compound example showed it). Each was found by a consumer rather
than by us, and the class of defect is always the same: the docs and the code disagree. Every sugar
example in the README and every escape-hatch form in `sugarCard()` is now desugared and compiled by a
test - which immediately found two more in our own README: an object id left unprefixed after the
compound change, and a full-canvas backdrop written as `raw scene` (drawn ON TOP, hiding the activity)
where it needed `raw scene under`.

A block written on one line now names the rule and shows the block laid out, instead of reporting
`unrecognised line`.
