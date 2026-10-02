---
"@flatkit/player": patch
"@flatkit/engine": patch
"@flatkit/compiler": patch
---

What the consumers of 0.37 reported.

- **Node rendering: a large shape filled with a GRADIENT no longer wipes what is behind it.** The guard against the skia-canvas 3 shortcut (a fill whose local bounds contain the canvas discards everything drawn before) covered solid fills only; a gradient sky larger than the frame, moved by its group, still came out half transparent. Linear and radial gradients are now covered. Browsers were never concerned.
- **skia-canvas 4 is accepted** (peer range `^3.0.8 || ^4.0.0-rc7`). Version 4 fixes the shortcut above by itself. It sets text one device pixel lower than version 3 (shapes are identical), so do not mix frames of the two in one video.
- **`pathToPolygons` gives the vertices alone for a path of lines.** The zero-length handle that marks such a path as straight made its first edge a "curve", subdivided into some twenty-five aligned points.
- **`flatc --since 0.35` also lists an open line that moves by 2 units or more**, however little that is of its length. A horizon across the whole frame bent by 3.9 units and 0.4% of its size, and only `--all` showed it.
- **Docs and prompts**: `dsl-gotchas.md`, `flatink-core.md`, `flatink-lite.md` and `role-asset-creator.md` now say that a path of lines is drawn straight, that `smooth` after the path data gives the curve, and that `--check` is silent under 12 points. `polyline` is in the two references and the gotchas page.
