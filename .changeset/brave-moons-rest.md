---
"@flatkit/sugarflat": patch
---

Put top-level `raw { ... }` content where its statements are legal.

`var` (like `asset`, `use`, `def`) is a HEADER declaration and a parse error after `scene`, and a `raw`
block written below the gesture landed exactly there: the documented example in the README compiled to
an error. `object` and `fn` are accepted on either side, so the header position is the only one where
all of it works - everything top-level now goes before the expansion, wherever the author wrote it.
Moving an `object` up changes nothing, since behavior binds by name and not by position.

Also: the one-line form no longer carries the spaces that hugged its braces into the output.
