---
'@flatkit/types': patch
'@flatkit/engine': patch
'@flatkit/player': patch
'@flatkit/compiler': patch
---

A seeded document brings its gestures back with it, and `setVar` is the write it always claimed to be.

`doc.variables` is how a host restores an activity where a reader left it, and it carried everything that
IS a variable. The state a gesture keeps BESIDE them did not come back: a continuous `trace`'s progress was
cleared on load and only re-seated by a write, so a restored trace said "three quarters done", drew its ink
to three quarters, and sent the finger back to the start on the first touch. A `reveal`'s scratched grid
was worse off -- nothing could read it back at all, so a reader who had scratched half an image returned to
find it intact.

Both now re-seat themselves on the seed, once per `load()` (and at construction), before the first paint:

- a continuous `trace` resumes at its own progress variable -- ink, pen-tip marker and finger together;
- a `reveal ... { cells <array> }` grid is rebuilt from the array it writes, `erase` included, with the
  fraction recomputed from the cells. One format, both directions: seed the array you saved and the veil
  comes back scratched where it was.

And the public `setVar` now takes the SAME path as an assignment written in the scene. The two used to
differ, and the difference was invisible from outside: the variable moved, the stroke was inked to the new
value, and only the pen-tip marker stayed at the start. A host restoring a trace by rewriting its variable
after construction hit exactly that.
