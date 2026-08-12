---
'@flatkit/types': minor
'@flatkit/engine': minor
'@flatkit/player': minor
'@flatkit/compiler': minor
---

`draw`: a stroke drawn by ARC LENGTH, and `reveal ... erase`: a veil the runtime rubs out.

**`draw <to> [from <start>]` on a shape** sets how much of its outline is stroked, as a fraction of the
path's arc length. A quoted value is an expression re-evaluated per frame, so ink appears behind a finger:

```
path "M60 300C220 120 340 480 500 300" nofill stroke #2255ff 18 cap round draw "progress" nohit
```

The measure is the one `samplePathAt` / `projectToPath` walk -- so a `trace` interactor's progress on the
same path data puts the ink exactly where the finger is (a `scaleX`-driven mask ties it to screen x, which
on a steep slope drifted by two stroke widths on the reported template). `from` opens a window (comet
trail). Subpaths are traversed in order, the first drawn whole before the next starts. It trims the STROKE
only: fill, gradient box, bbox and hit shape stay those of the whole path. `flatc --check` reports a `draw`
on a shape with no `stroke`, which would animate nothing.

**`reveal <p> { brush <px> erase }`** makes the runtime rub the grabbed object out where it was scratched:
a scratch card is a grey rectangle and nothing else -- no grid of tiles to author, no per-cell artwork. One
disc per cleared cell, so what disappears is exactly what the fraction counts. A `mask` layer cannot do
this (its matter is an even-odd clip path, where two overlapping stamps cancel instead of accumulating),
and nothing in the language creates a stamp at the pointer.

**`reveal <p> { cells <array> }`** hands out the grid behind the fraction -- WHERE it was scratched
(`cells[row * cols + col] = 1`, `cols = ceil(zone_width / brush)` over the object's world bbox) -- for a
scene that must react to the uncovered area rather than just show it. `--check` states the grid's exact
geometry and the `fill(N, 0)` to declare whenever the array's length disagrees.

**A `reveal` target is now grabbable over its whole ZONE**, whatever its content currently looks like. A
veil whose cells were faded to `opacity 0` stopped being hittable, so the scratching worked on the first
stroke and then stalled on the cleared area -- invisible in a static render, visible only in a replayed
`down/move/up` script.

**A variable read only by a LEAF is no longer reported "never used"**: a dynamic text's `bind`, a
text-on-path's animated `start`/`spacing`, a shape's `draw`. They read variables every frame but carry no
channel and no action, so the dead-global pass -- which walked only those two -- called them dead.
