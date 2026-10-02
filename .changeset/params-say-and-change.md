---
'@flatkit/types': minor
'@flatkit/engine': minor
'@flatkit/compiler': minor
'@flatkit/player': minor
---

Symbol params: a `text` type, colors and texts written at runtime, and `--check` reads what an instance
is given.

- **`text` params.** `params { text libelle = "OK" }`, drawn inside the symbol with `text libelle at ...`
  (the bare name instead of a quoted string). A reusable button carries its own label, set per instance
  with `{ libelle = "Valider" }`.
- **Colors and texts change at runtime.** `Inst.fond = #33aa33` and `Inst.libelle = "Bravo"` repaint the
  instance. The right-hand side is a literal (a color, a quoted text); a color assignment used to
  compile and do nothing.
- **`--check` checks instance params and states.** A param the symbol does not declare (with the name it
  probably meant), a value of the wrong type, a number outside its `range`, a state that does not exist,
  at the call site and in an assignment; and an assignment whose target is no instance of the scene.
