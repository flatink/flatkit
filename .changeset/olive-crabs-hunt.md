---
'@flatkit/types': patch
'@flatkit/engine': patch
'@flatkit/player': patch
'@flatkit/compiler': patch
---

`when <condition>` and `at x y` now name the rule they broke.

Both come from a day of real use writing a rule-driven activity.

`when biomasse > 55 { … }` is the reflex of anyone expressing a system, and FlatInk has no conditional
`when`. Listing the accepted events left the author to infer that, and the line-level recovery then
reported the body as two MORE errors. It now states the rule once, swallows the block, and gives the
`every frame` + flag idiom -- guarded, because the block runs 60 times a second and an unguarded `send`
fires sixty events. The idiom inside the message is parsed by a test, so it cannot teach a form the parser
rejects.

`at 12 -16` (a space where the comma goes, the reflex of anyone who has written SVG) said `"," expected,
"-16" found` -- accurate about the token, silent about `at`. It now shows both spellings.

The guide gains the paragraph, and the three references the one-liner.
