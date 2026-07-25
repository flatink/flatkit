---
"@flatkit/compiler": minor
---

`--check`: flag the three SILENT DROPS of a cel layer. Such a layer draws only the current cel's
`matter` and the containers that cel poses, so a bare shape left in the layer, a `pose "X"` naming no
roster item, and a roster item no cel ever poses all render an empty frame with no signal. They are now
warnings (non-blocking), scoped to the owning symbol. Also documents frame-by-frame authoring (a
`matter { … }` per cel, held until the next one, `morph` to tween the shape) in the docs and the agent
prompts, where the block syntax was missing entirely.
