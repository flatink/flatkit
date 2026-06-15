---
"@flatkit/engine": patch
---

`use "feedback"` gains `pulse(since, dur)` — a linear `1→0` ramp over `dur` seconds since the instant
`since`, for readable timed feedback (a message/flash that fades over a duration you state, instead of a
too-fast multiplicative decay). Stateless: the author captures the instant in a handler
(`var shown = -999` + `when wrong { shown = time }`) and binds `opacity = pulse(shown, 4)`.
