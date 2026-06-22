---
"@flatkit/types": patch
"@flatkit/engine": patch
"@flatkit/player": patch
"@flatkit/compiler": patch
---

Stateful channel modifiers (`spring` / `smooth`): a `.flat` symbol channel can now INTEGRATE over time
toward a target instead of recomputing purely each frame, so an asset carries its own reactive "feel"
(a crane cable that swings and settles, a needle that eases to its value) with no scene code.

Authoring (on any poseable item in a `.flat`):
  group "Suspente" spring rotation "crochetX" stiffness 0.08 damping 0.86 { ... }
  group "Aiguille" smooth rotationDeg "valeur * 270" k 0.18 { ... }

The target is an ordinary expression; expressions stay pure (no hidden state) -- the modifier holds the
state. State is per INSTANCE (two cranes swing independently, even when the spring is on a group inside the
symbol). It advances at a fixed 60 Hz step, independent of onEnterFrame/input, so an asset animates with zero
scene behavior; on random access (timeline scrub, --render, contact sheet) the channel snaps to its target
(the rest pose). The integrator is bounded (params clamped) -- it cannot diverge. `flatc --check` lints the
target expression (a typo surfaces as "unknown variable") and flags out-of-range spring damping. Purely
additive: documents without modifiers are unchanged.
