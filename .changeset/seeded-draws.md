---
'@flatkit/player': minor
'@flatkit/compiler': minor
'@flatkit/sugarflat': minor
---

`random()` can be reproduced, and sugar gestures can shuffle.

- **`seed` option of the player.** `random()` (in `[0, 1[`, now documented) draws from a seeded generator
  when the host passes `seed`, and from `Math.random` otherwise. `load()` starts the sequence again.
- **A headless replay is always seeded.** `flatc --play` and `playHeadless` use seed `1`, so the same
  script gives the same result twice and an `expect` can assert on a draw; `--seed N` picks another.
  `flatc --render --steps` is seeded too.
- **sugarflat: `shuffle`.** A `shuffle` line in a `place`, `compose` or `steps` block swaps the places of
  the elements the learner picks from when the activity loads. Targets stay put, and the order of a
  `steps` sequence is unchanged. `meta[].shuffle` reports it.
- A semantic gesture by name (`tap`, `drag`) aims at where the object stands now: it used to read a
  per-frame snapshot that a `when loaded` could have made stale.
