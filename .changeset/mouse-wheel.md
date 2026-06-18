---
"@flatkit/player": minor
---

feat(player): mouse-wheel scroll via `mouse.wheel` (+ a `wheel` headless gesture)

The player now listens to the wheel and exposes **`mouse.wheel`**: the wheel delta accumulated this frame
(reset each tick, like `mouse.dx/dy`). Read it in an `every frame` accumulator —
`off = clamp(off + mouse.wheel, 0, max)` — the same idiom as finger/handle scroll. The wheel is consumed
(`preventDefault`) **only when the scene references `mouse.wheel`**, so scenes that ignore it let the page
scroll normally over the canvas (zero regression). A new `{ "type": "wheel", "dy": N }` headless gesture
(`flatc --play --script`) drives it for tests.
