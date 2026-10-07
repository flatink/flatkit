---
"@flatkit/engine": minor
---

Containers of an animated layer stack in the order the layer declares them, at every frame. The order of the `pose`s inside a cel used to decide it, so a `cel N hold` that moved one piece sent every carried piece in front of it, and posing a shadow last drew it over its character. A cel lists what moves, in any order; to change which piece is in front over time, use separate layers. Visible change for a scene whose poses were not listed in declaration order.
