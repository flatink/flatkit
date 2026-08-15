---
'@flatkit/engine': patch
'@flatkit/compiler': patch
---

A `let` at the top of a program declares a document variable, instead of evaporating.

Reported as half an hour lost on a first contact with the language, and the wording was the smallest part
of it. Measured on 0.35.0: `let n = 5` at the top level of a `.flatink` **passed `--check`**, and at run
time `n` read **0** -- `doc.variables` was empty. The declaration parsed, satisfied the scene scope's lint
(so nothing complained where it was written), and was dropped on the way into the document. A binding in an
`object` block -- another scope -- then reported `unknown variable "n"`, pointing at the reader rather than
at the declaration that had vanished.

Both spellings now mean the same thing at the top level of a program: the header's `var` and a top-level
`let` land in `doc.variables`, readable from every scope, bindings included. `var` wins a name declared
twice (a host seeds those, and a stray `let` must not override them), and printing emits one canonical
spelling -- `var` -- so a round-trip stays stable. Inside a scope, `let` is still local to it, and a
declaration inside an `object` block is still refused outright.

Two hints corrected, since both sent a reader in a circle:

- `unknown variable "x"` advised declaring it with `let`, which is precisely what does not carry across
  scopes. It names `var x = 0`, at the top level, now.
- `languageCard()` documented `let` and never mentioned `var` -- the one form a host-generated program
  uses -- and its example hid the rule behind a variable auto-declared by assignment. Both fixed: the
  example now READS its state from a channel binding, which is the case that fails when the declaration is
  wrong.
