---
'@flatkit/engine': patch
'@flatkit/player': patch
'@flatkit/compiler': patch
---

Scratching a fine-grained veil no longer gets slower the more you scratch, and three bounds the last three
releases had left open.

**The scratch cost grew with the cells already cleared.** `erase` re-stamped EVERY cleared cell, blurred,
into a fresh buffer on every frame the set changed -- which is every frame of a stroke. Measured on the
reported shape (880x404 zone, `brush 36` / `grain 8`, so 5610 cells) with the off-screen renderer:

```
                        before      after
scratching, 70 cells    0.43 ms     0.30 ms   per frame
scratching, 520         2.07        0.13
scratching, 2020        1.73        0.22
scratching, 5610        4.23        0.22
idle (any count)        0.02        0.02
```

Four milliseconds a frame, paid exactly while the child is scratching -- the one moment smoothness is felt
-- and growing with the grain they had just been given. The holes are now kept as a persistent mask and
stamped INCREMENTALLY: a frame draws the handful of cells that just fell, not the thousands already there.
Flat instead of linear. (Idle frames were already one blit, and stay so.)

**`revealGrid` is now ONE function**, in the engine, called by the player that ticks the cells and by
`--check` that tells the author how many to declare. Computing it twice is how they drifted the day `grain`
arrived, and the array silently lost every write past its end.

**A `reveal` grid is bounded** (100k cells, never sub-pixel). A `grain` of 0.01 over a full frame asked for
billions of cells -- each one scanned per pointer move and stamped by `erase` -- which an untrusted
`.flatpack` is entitled to try. The grid coarsens instead of freezing the tab. The cap matches `fill`'s own,
so the count `--check` advises is always declarable.

**`arr = fill(n, v)` is charged to the tick budget by what it WRITES.** The budget counts actions, assuming
each costs about the same; this one writes up to a hundred thousand slots, so a `repeat` full of them ran
200k of them under a green ceiling.

**And two silent numbers named.** A `step` of 0 or less is the one option here that does not fall back: the
progress may grow by at most `step` px per frame, so nothing ever advanced -- a drill impossible to
complete, drawing its guide, following the finger, ink empty, `--check` green. A non-positive `tolerance`,
`brush` or `grain` is the milder cousin: silently replaced by the default, so the number written in the
source described nothing. Both are reported now.

