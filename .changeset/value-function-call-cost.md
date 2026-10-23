---
'@flatkit/player': patch
---

A call to a value function no longer copies the whole expression context.

Reported from a tower-defense mini-game (flatink/flatink#71): `fn f(a) = …` and the `feedback` package's `pulse()` copied every variable of the program before setting their params, on every call. With about 250 variables and 150 `pulse()` calls per step, two thirds of the time went into that copy, and the frame cost x5.5 the same frame written inline.

- **A call now sets its params alone**, over the scene's context read by reference. Its cost no longer grows with the number of variables in the program.
- Measured headless on that shape (250 variables, 150 `pulse()` per step): 7.4 ms a step before, 0.074 ms after; the same body written inline takes 0.048 ms.
- Nothing else changes: a param still shadows a variable of the same name, and a function still sees the variables, the clock and the other functions.
