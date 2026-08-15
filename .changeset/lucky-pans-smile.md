---
'@flatkit/engine': patch
'@flatkit/player': patch
---

perf(player,engine): stop rebuilding, every frame, what never changes

A frame profile of a 200-instance scene said the renderer's biggest single cost was smoothing and
re-creating the SAME geometry it had already built the frame before. Nothing here changes what is drawn.

- Region outlines are memoized. `pathToBezier` (the Catmull-Rom pass) and the `Path2D` a region strokes and
  fills are now kept on the path they came from, on the invariant the flattening cache already relies on:
  geometry never changes in place (a morph or a `bind` yields a NEW path). That scene was building 601
  `Path2D` objects and issuing 4806 native path calls PER FRAME; it now issues none.
- Arc-length flattening is memoized too, per subpath and tolerance. It is what `samplePathAt` /
  `projectToPath` walk, several times per POINTER MOVE while a child draws a `trace` -- and what
  `makePathSampler` re-walks once per frame per text-on-path.
- The context matrix is read only when it is needed. `scaleOf` and a leaf's screen box exist to size an
  isolation buffer; an item with neither a tint nor a filter -- most of them -- no longer measures itself or
  allocates a DOMMatrix to ask the scale (420 reads per frame down to 18).
- A solid fill measures no geometry: `paintStyle` takes its bbox lazily, so the bounding box a gradient
  needs is not computed for every plain-coloured region of every frame.
- Per-container garbage: `renderLayers` allocated three empty Maps per call (once per container per frame),
  and `layerStructure` built an id map and climbed ancestors for stacks that declare no `parent` -- where a
  mask, a guide, and a hidden ancestor are all impossible by construction.
- The pointer path: handlers and interactors are indexed by target instead of re-scanned (and re-filtered
  into a fresh array) for every item of every hit chain on every move; `self` and its parent space now come
  from ONE scene walk that stops at the object instead of two that each resolve the whole scene; a `trace`
  target's world path is measured once per document rather than on every write of its progress.
- Load: the three questions asked of the document (does it read the wheel / the pointer / which keys) share
  one serialization instead of stringifying the whole `.flatpack` three times.

Measured on a 200-instance, 30-symbol scene, baseline and candidate interleaved: 67% less time per rendered
frame (same on a real canvas backend), 59% per simulated frame, 62% per pointer move of a `trace`.
