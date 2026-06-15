---
"@flatkit/player": minor
---

Add a semantic `turn` gesture to headless gesture-replay (`flatc --play`):
`{ type: 'turn', target, angle, settle? }` rotates a `turn`/`turnDeg` interactor by `angle`
(signed; degrees for `turnDeg`, radians for `turn`) around its pivot, swept in small sub-steps so
both multi-turn rotation and delta-accumulating `every frame` integration work. `settle` (default 1)
advances the simulation between sub-steps so an `every frame` that integrates the per-step delta sees
each increment. This lets rotary controls (dials, wheels, valves) be driven and asserted in headless
tests, instead of only via `set` on the bound variable.
