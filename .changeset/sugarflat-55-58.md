---
"@flatkit/sugarflat": minor
---

flatink/flatink#55 #56 #57 #58: `compose` takes decimal values (rounded to the places written, so 0.1 + 0.2
reaches 0.3), chip labels (`chip 200 "2 EUR" at x,y`), a block `unit`, and an opt-in `counter at x,y` showing
the running total (a new `counter` theme role; a theme that predates it draws nothing). A `place` target
takes `size w,h` (or `targets size w,h` for the block); `Theme.draw` receives the size as an optional third
argument. GREYBOX labels are 20 px at least, in the same footprints. A `steps` card tapped ahead of its turn
now sends `incorrect` (`{ block, item }`); nothing else moves.
