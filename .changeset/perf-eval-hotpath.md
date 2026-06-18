---
"@flatkit/engine": patch
"@flatkit/player": patch
---

Perf pass on the player's hot eval/resolve path (profiled: object construction dominated ~47% of CPU on a
script-heavy scene; it's now negligible). No behavior change — verified against the existing suite plus new
intra-frame correctness tests (sequential var deps, loop + setIndex + array read-back, named refs).

- **`exprScope` no longer copies `MATH_CTX`** (~30 entries) into the context on every evaluation. `evalNode`
  resolves math names from `MATH_CTX` by reference (math still takes priority over a same-named variable),
  keeping the own-property-only sandbox. This was the single biggest allocation in the eval loop.
- **`Player.evalNumber` evaluates against the per-frame context directly** — no `exprScope` copy per
  statement. `time`/`frame`/`clock` are baked onto the cached context (reserved names, never shadowed).
- **Variable write-through (`setVarLive`)**: every `setVar` updates the cached context in O(1), so the
  per-frame context cache no longer re-copies all variables on every eval (it was O(vars × evals/frame)).
  Covers the every-frame interpreter, loop variables, procedures, and interactor outputs; arrays mutate in
  place through the shared reference.
- **`applyExprChannels` builds the eval context once per item** and only swaps `value` per channel, instead
  of an `exprScope` copy per channel (helps cel/expression-heavy and instance-heavy scenes).
- **Cel pose resolution uses an id→item map** instead of a linear `find` per pose (O(items×poses) → O(1)).
- **Render/hit layer structure in one pass** (`layerStructure`): the hidden-id set and the mask/guide parent
  maps are built with a single `byId` map and a single loop, instead of three separate walks per traversal.
- **Opaque regions skip the per-region `ctx.save()/restore()`** (only needed to scope `globalAlpha` when the
  region is semi-transparent) — paintRegion sets its own styles and draws with an explicit Path2D.

A new `pnpm bench` (`packages/player/bench/render.bench.mts`) measures ms/frame for a representative heavy
scene, as a relative regression check.
