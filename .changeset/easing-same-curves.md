---
"@flatkit/engine": minor
---

**Breaking (visible):** the `easing` package's `easeIn(t)`, `easeOut(t)` and `easeInOut(t)` are now the
keyframe curves of the same name (cubic, as `cel ... tween ease easeInOut`); they were quadratic. One name
gave two curves: a trail drawn with `draw "easeInOut(t)"` under an object tweened with `ease easeInOut`
drifted by some fifty pixels. A scene that calls these three functions moves a little differently at the
start and the end of the ramp; `smooth(t)` is unchanged.
