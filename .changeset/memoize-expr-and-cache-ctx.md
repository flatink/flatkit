---
"@flatkit/engine": patch
"@flatkit/player": patch
---

Perf: the `every frame` script interpreter no longer re-parses expressions and rebuilds the evaluation
context on every call (it ran hundreds of times per frame).

- **Memoized expression compilation** (`compileCached`, now shared from `@flatkit/engine/expr`): an
  expression's AST is immutable, so each distinct source is parsed once and reused. `Player.evalNumber` and
  value-function compilation now use it (the channel resolver already did). Kills the per-call re-tokenize +
  re-parse.
- **Per-frame `exprCtx` cache**: the context (named-channel snapshot, function closures, mouse/keys) is
  stable within a frame, so it's built once per frame and only the live variables are refreshed on reuse
  (intra-frame `setVar`s stay visible; value-functions keep priority over same-named vars). Bypassed during a
  handler (`self` set) and for interpolated render contexts; invalidated on input/seek/load.

Net effect on a script-heavy scene (~400 expressions/frame): roughly **1.8× faster** simulation, no behavior
change (verified: intra-frame sequential variable dependencies and named-object references stay correct).
