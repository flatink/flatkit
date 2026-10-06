---
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/compiler": minor
---

flatink/flatink#20: `stroke ... fixed` keeps a shape's stroke width in scene units whatever its own scale (a
rail stretched by `scaleX = 4` no longer gets thick sides). flatink/flatink#32: a bound text takes several
values, one per `{}` slot (`bind "a", "b"`; new optional `Text.bindMore`). flatink/flatink#68: an instance's
params and states read by name (`R.bras`, live value, else call site, else default); `--check` warns on a
field an object does not have (`B.zoom`, `mouse.down`), places Doc-level warnings on the line of their
subject instead of 1:1, and no longer warns about `time` on a motion that loops seamlessly.
