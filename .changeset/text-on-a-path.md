---
"@flatkit/types": minor
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/compiler": minor
---

feat: text on a path (`text … along …`)

Lay text along a curve — banners, badges, ribbons, dials (the FlatInk analogue of SVG `textPath`).

- **`along "<id>"`** follows a named shape's outline (`circle`/`rect`/`ellipse`/`path … as "<id>"`); a closed
  named shape anchors the run **upright over the top** by default. **`along path "<d>"`** takes inline SVG
  path data instead (baked literally).
- **`start <0..1>`** / **`align`** anchor the run; **`side over|under`** puts it outside/inside;
  **`spacing <px>`** tracks the glyphs (negative allowed). Closed paths wrap; open paths drop overflow.
- **Animate** by quoting the value: `start "time * 0.1"` (marquee), `spacing "sin(time) * 4"` (eased
  tracking) — same expression scope as `bind`.
- **Shapes are now nameable** with `as "<id>"`, and `flatc --check` warns when a run overflows its path.
