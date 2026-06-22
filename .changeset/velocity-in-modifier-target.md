---
"@flatkit/types": patch
"@flatkit/engine": patch
"@flatkit/player": patch
"@flatkit/compiler": patch
---

`velocity()` in a modifier target: react to a value's MOVEMENT, not just its value. Inside a `spring`/`smooth`
target, `velocity(x)` is the per-second rate of change of `x` -- 0 at rest, non-zero only while x moves -- so a
pendulum on a moving pivot (a crane cable that swings when the trolley moves, then hangs vertical) needs no scene
code:

  group "Suspente" spring rotation "rad(-velocity(crochetX) * 40)" stiffness 0.06 damping 0.22 { ... }

At rest velocity = 0 -> target 0 -> vertical automatically; on a scrub / --render it is also 0 -> snaps to rest
(consistent with the random-access semantics). Composable in any target.

Design (extends the stateful-modifier work): `velocity()` is NOT a pure stdlib function -- it is resolved by the
player's stateful advance pass (the previous value lives in the binding's per-(instance, channel) state, one slot
per velocity() occurrence), so expressions stay pure (expr.ts unchanged: velocity is injected into the eval
context) and it is per-instance correct. Valid ONLY inside a modifier target; `flatc --check` knows it there and
flags it as misuse elsewhere. Per-second delta (fixed 60 Hz step) -> deterministic, readable gains. Additive.
