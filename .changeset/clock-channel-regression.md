---
"@flatkit/engine": patch
---

fix(engine): channel expressions read the monotone `clock` again (regression in 0.16.1)

The 0.16.1 eval-context optimization built the per-layer overlay without `clock`, so `exprScope` fell back
to `clock = time`. Because the overlay wins over the by-reference scene context in name resolution, a
channel expression like `rotation = sin(clock * 2)` read the loop-wrapped `time` instead of the monotone
`clock` — making ambient motion jump on every timeline loop (the exact thing `clock` exists to avoid). The
overlay now threads the real `clock` from the scene context. Guarded by a test.
