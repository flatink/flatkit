---
"@flatkit/types": minor
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/compiler": minor
---

`nonzero` on a shape fills it by the SVG / Canvas default rule: `path "M... Z M... Z" nonzero fill #461fbf`. Two contours that run the same way add up where they overlap, where the even-odd rule (still the default, so a nested contour still cuts a hole) leaves a hole: the stem and the arms of a letter in a logo taken from an SVG. The touch area follows the picture, and so does a mask made of the shape. `flatc --check` warns about a filled path whose same-way contours overlap and names the word; a nested contour, the ring idiom, is left alone.
