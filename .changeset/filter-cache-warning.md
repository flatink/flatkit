---
'@flatkit/compiler': minor
'@flatkit/player': minor
---

`--check` now warns when a `filter` sits under a transform that never stops moving.

Isolating a filter costs an off-screen canvas, a CSS filter and a blit. The player pays that once and
keeps the baked bitmap, keyed on the item's screen placement -- that cache is the whole reason a scene
can afford glows at all. Bind a transform channel to a *periodic* `clock` motion on the filtered item
or on any ancestor, and the key never repeats: the composition is re-baked every frame, forever.

Measured on a generated activity: a garland swaying on `dy = 3 * sin(clock * 0.55)` with six glowing
lanterns hanging from it. The lanterns were innocent -- their own motion settles -- but the sway above
them re-baked all six glows on every frame. Nothing looked wrong; the drag simply stuttered, and the
cost was invisible in the source, split across a `filter` on one line and a parent's `dy` fifty lines
away. `drawScene.ts` had documented the hazard in a comment since the cache landed; nothing checked
for it.

The rule is narrow on purpose. Only a **periodic** wrapper (`sin`, `cos`, `mod`) counts, because only
those provably never settle. `rotation = shake(bad, clock)` is `bad ? sin(t*40)*4 : 0` -- exactly 0 at
rest, and every draggable object carries one -- and a `clamp` decay is constant past its delay. Both
pay the composition once and hit the cache forever after; flagging them would have fired the warning
on scenes that were perfectly fine. `opacity` is likewise ignored: it is applied at blit time and is
deliberately absent from the cache signature, so a pure fade reuses the bitmap.

**And the cache the warning talks about now covers leaves.** `paintLeaf` isolated a filtered shape
off-screen exactly like a container, but passed no cache slot -- so `circle ... filter glow`, the shape a
decorated scene is full of, re-composited on EVERY frame whether or not anything moved: 360 content draws
over 60 frames, where a filtered group standing still drew 0. It now takes the same slot (and
`filterCacheSlot` still refuses to cache what may change: a bound text, a shape with an animated `draw`).

**The cache is also keyed per instance, not per item id.** A symbol's items are the same objects for every
instance of it, so eight lanterns from one symbol shared one entry and thrashed it -- measured at 480
content draws over 60 frames where 8 was the answer. Now 0 in the steady state, one entry each. Bounded:
256 baked composites per document, past which a scene keeps drawing the slow way rather than growing
without a ceiling.

Two corrections to the rule itself, both measured: the busting channels are DERIVED from the pose channels
(minus `opacity`, plus the offsets) instead of being retyped -- a hand-kept copy of a list the player owns
is exactly how `--check` came to size a `reveal` grid on the brush while the engine used the grain -- and
every ever-growing instant counts, so `sin(time * 2)` and `sin(frame / 10)` are caught alongside `clock`.

