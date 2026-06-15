---
"@flatkit/player": minor
---

Angle units: degrees for authoring, radians for math — both first-class.

- **New `rotationDeg` channel binding** — authoring sugar for `rotation = rad(<expr>)`. Write angles in
  degrees where it reads better: `rotationDeg = 45`, `rotationDeg = handAngle`. The `rotation` channel
  stays radians (for `sin`/`cos`/`atan2`/`gesture.angle`).
- **New `turnDeg` interactor** — the degrees twin of `turn`. `turnDeg a around cx,cy` writes the
  pivot→cursor angle in **degrees** (pairs with `rotationDeg = a`); `turn` writes **radians** (pairs with
  `rotation = a`). `snap <deg>` is authored in degrees on both.
- **BREAKING — `turn` now writes radians** (was degrees), matching the `rotation` channel and removing the
  footgun where `rotation = <turnVar>` spun ~57× too fast. Migrate: drop a stray `rad()` (`rotation = a`),
  or switch the pair to degrees (`turnDeg` + `rotationDeg = a`).
