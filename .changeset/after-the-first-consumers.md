---
'@flatkit/engine': patch
'@flatkit/compiler': minor
'@flatkit/player': minor
---

Four things reported by the first two consumers to move to 0.36.

- **Rendering in Node: a large opaque shape no longer wipes what is behind it.** skia-canvas 3.x discards
  everything drawn so far when a fill "covers the canvas", and decides it from the path's local bounds,
  before the context transform. A shape much larger than the canvas and offset by its group -- covering
  only part of the frame -- wiped the background: more than half of the picture came out transparent
  (`flatc --render`, any host rendering frames with skia-canvas). Plain rectangles and polygons had the
  defect before 0.36; rounded rectangles gained it when their sides became straight. The player now fills
  such a path in device space. Browsers were never concerned; skia-canvas 4 no longer needs it.
- **`player.setParam(instance, param, value)` is public.** A host drives an instance's exposed params:
  a number, a boolean, a state by name, a color, and a text given as it is (no quoting, no escaping). It
  returns `false`, and changes nothing, for an unknown instance, an undeclared param or a value of the
  wrong kind.
- **`polyPath` draws straight sides**, as its name says. It returned bare anchors, read as free-hand
  material: rounded at gentle turns and exported with `smooth`.
- **`flatc --since <version>`**: a one-shot report of what the given sources draw differently from that
  version, with `file:line`. Recorded so far: the paths of lines that 0.35 rounded and 0.36 draws
  straight, with how far each moves, so an author decides once where `smooth` belongs.
