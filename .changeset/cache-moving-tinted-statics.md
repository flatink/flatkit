---
"@flatkit/types": patch
"@flatkit/engine": patch
"@flatkit/compiler": patch
"@flatkit/player": patch
---

fix(player): cache filtered composites of moving/tinted statics; treat stateful modifiers as non-static

The filtered/tinted composite cache now keys on the item's own RESOLVED pose, not just the screen
transform, via a new `isContentStatic` check that ignores the item's own channel drivers (they only
move/scale/fade it) while still requiring its CONTENT subtree to be static. A tinted or filtered
instance driven by a channel expression -- e.g. `each`-bound bricks -- reuses its baked composite
whenever its pose holds still, instead of re-isolating off-screen every frame. Its own pose is folded
into the cache signature (an expression-driven move busts the cache; a momentarily-still pose keeps
HITting), and `opacity` is applied at blit so a pure fade reuses the bitmap.

Also fixes a latent staleness bug: a subtree carrying a stateful modifier (`smooth`/`spring`) but no
expression was wrongly treated as render-static, so a child's spring would freeze inside a cached
composite. Modifiers now mark a subtree non-static (zero cost for scenes that use none). And the
per-frame `cssFilterString` is computed once per filtered item instead of twice on the bake path.

No DSL or API change; scenes without tint/filters are unaffected.
