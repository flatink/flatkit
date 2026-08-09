---
"@flatkit/compiler": minor
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/types": minor
---

Close the five frictions found integrating 0.23, and answer the sugar-layer RFC.

- **`--check` catches the silent `time` -> `pulse` trap.** `pulse`/`shake` ride the monotone `clock`, so
  an instant captured with the pre-0.23 idiom (`doneAt = time`) is compared against an axis it never
  shares: the ramp never fires, and nothing on screen or at `--check` said so. The link is static and is
  now named, whatever the timeline length. Touches every codebase migrated from 0.21.
- **New `checkProgram(src)`** - the whole `--check` pass as a function, source in, diagnostics out, no
  subprocess. The compiled Doc cannot express two error classes (a text that is not FlatInk compiles to an
  empty Doc; an `object` block that binds to nothing leaves no trace), so the API used to return a weaker
  verdict than the CLI on the same file. The CLI now calls the same function, so they cannot drift.
- **New `drawingCard()`** beside `languageCard()` - the composition half of the reference (shapes, paints,
  filters, text, clipping, and the word order that breaks most often), which the behavior card never
  covered. Its examples are compiled by a test, so a copied reference cannot drift. `llmContext(doc)` now
  includes it; pass `{ drawing: false }` to opt out.
- **The agent prompts ship in the package** (`prompts/`): a full language reference, a condensed one, and
  one file per role (asset creator, motion designer, coder). They were gitignored and absent from the
  tarball, which forced integrators to copy the grammar by hand.
- **Layout warnings descend into groups** and measure in world coordinates - most of a real scene lives
  inside a group, and none of it was checked before. Wrapped text is now measured too (more lines than the
  box is tall, or a word too wide to break), and anything positioned at runtime is skipped, along with
  everything nested under it.
- **The manifest carries the binding contract**: per object, the events the logic handles, whether it is
  dragged or a drop zone, the channels the logic drives, and the state it reads (parsed, not grepped);
  plus `manifestEvents(doc)` for what the program emits. No coordinates cross that boundary, so a second
  skin can honour the same logic with a different composition.
- **A stroke option written out of order names the rule**: `stroke #888 2 nofill dash 6,5` reported
  `"layer" expected, "dash" found`, which reads as if `dash` did not exist. It now says that
  `cap`/`join`/`miter`/`dash` belong to the stroke and must follow it directly.
- **An `instance` resolving to no symbol is no longer silent.** The unresolved marker travelled all the
  way into the `.flatpack`, the instance drew nothing, and `--check` said `check passed`. Measured on a
  real corpus: 96 such references across 14 of 58 activities passed as green. Now a warning that names the
  missing symbols - a warning, not an error, because compiling a program on its own and supplying its
  libraries later is a legitimate workflow.
- **Every published subpath answers `require` as well as `import`.** They pointed only at `import`, so
  `require("@flatkit/compiler/compile")` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` - a message claiming
  the subpath is not defined by `exports` when it plainly is. The condition points at the SAME ESM file:
  no CJS build, so no dual-package hazard (one file, one module instance), and Node >= 24 (this package's
  floor) requires ESM natively. `check:pack` now fails if a subpath loses its `require`.
