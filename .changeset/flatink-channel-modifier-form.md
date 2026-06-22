---
"@flatkit/types": patch
"@flatkit/engine": patch
"@flatkit/player": patch
"@flatkit/compiler": patch
---

Scene-side authoring for stateful channel modifiers: a `.flatink` `object` block can now declare a
`spring` / `smooth` channel, not just a `.flat` symbol. The target is an ordinary (unquoted) FlatInk
expression; block form for the params:

  object "Hero" {
    spring rotation = crochetX { stiffness 0.08 damping 0.86 }
    smooth opacity = lit { k 0.18 }
  }

For a one-off spring on a scene object when the feel is not baked into a `.flat` symbol. Front-end only --
a new `modifier` DSL unit (parse, print round-trip, compile to the item's `modifiers`, `flatc --check`
lints the target and slots); the runtime (engine resolution, player advance, per-instance state) is the
same code that already drives the `.flat` form. `rotate`/`rotationDeg` sugar like the rest. Additive.
