---
"@flatkit/sugarflat": minor
---

A document may hold several blocks.

Composing gestures was never a matter of concatenating their output: a program has exactly one `scene`,
one header and one behavior half, so two whole programs cannot be merged after the fact. A gesture now
returns PARTS - its `var` lines, its layers, its behavior - and the assembly puts them in the three
places the format has. `MultipleGesturesError` is gone.

Two decisions the assembly makes, both testable rather than promised:

- **Names are prefixed by the block's name, ALWAYS**, including when a document holds one block
  (`words_TNouns`, `coins_C0`). Prefixing only on collision would mean the same source compiles to
  different names depending on whether a sibling exists, so a skin written against one block would break
  the day a second arrived. Every id is now in `meta[].objects`, so nothing has to be guessed.
- **`completed` belongs to the DOCUMENT.** Each block emits `part` with its own index when its portion is
  finished; `completed` fires once, when every block is done. With a single block the two coincide, which
  is what `completed` always meant. Payloads carry `{ block = i, item = j }`, so a host can tell two
  blocks apart without depending on what a theme drew.

BREAKING: `meta` is now an array, one entry per block, in document order. Object ids and variables carry
the block prefix. Two blocks with the same name raise `DuplicateBlockError`.
