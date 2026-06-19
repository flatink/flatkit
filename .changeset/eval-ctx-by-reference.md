---
"@flatkit/engine": patch
---

perf(engine): stop rebuilding the eval context per channel-expr item (~4.7× on heavy scenes)

`applyExprChannels` rebuilt the **entire** eval context (`{ ...opts.ctx, ...spaceConversions }` — every
variable + every named object's channels) for **each channel-expression item, each frame**; `.flat`
instances multiply it. Now a tiny per-item **overlay** (space conversions + time/frame) is built once per
layer and reused (only `self`/`value` swap per item), and the scene context (`opts.ctx`) is consulted **by
reference** in the evaluator (`evalExpr`/`resolveName`, like `MATH_CTX` already was) instead of being
copied. Measured on a heavy "carrefour" scene: **77.9 → 16.6 ms/frame (~13 → ~60 fps)**, render
**byte-identical** (60 sim steps). No render-path change, no visual-regression risk.
