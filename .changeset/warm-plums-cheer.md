---
"@flatkit/compiler": minor
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/types": minor
---

Cels are not symbol-only, and nothing said so.

A layer inside a program's `scene { ... }` takes cels, riding the program's own timeline - keyframes with
easing, fractional frames, composing with `dx`/`dy` bindings. It has always worked. But every example in
every doc and every prompt wraps them in a `symbol`, and two of the prompts said "(in a symbol)" in the
heading.

Measured consequence: a deck generator concluded they were unavailable and hand-compiles every entrance
as `clamp((time - t0) / dur, 0, 1)`, per channel, per element - 3330 occurrences across 40 decks, 139 in
a single 783-line file. A keyframe engine, retyped in arithmetic, because the reference implied the real
one was out of reach.

- The animation guide is retitled and carries a worked program-scene example: three staggered entrances
  with `hold`, plus an ambient binding riding on top.
- The prompts say it, and their example compiles like the rest.
- **New warning**: an item posed at one cel, absent from the next, then posed again LATER blinked out and
  back. A cel is a full snapshot, so that is the model working - and a FINAL absence is how an exit is
  written, which stays silent. But a staggered entrance needs `hold` on every cel, and forgetting it made
  elements vanish mid-run with nothing to say so.
