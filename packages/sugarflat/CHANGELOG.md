# @flatkit/sugarflat

## 0.3.1

### Patch Changes

- [`eefb7d6`](https://github.com/flatink/flatkit/commit/eefb7d674c624914136d1f251aa246e058b8bc12) Thanks [@kaelhem](https://github.com/kaelhem)! - Make the documentation a test, because three times it promised a form the parser rejected.

  `raw { ... }` on one line (the README wrote it that way), decor in a plain `raw` (the card taught it),
  and now a block written inline (the compound example showed it). Each was found by a consumer rather
  than by us, and the class of defect is always the same: the docs and the code disagree. Every sugar
  example in the README and every escape-hatch form in `sugarCard()` is now desugared and compiled by a
  test - which immediately found two more in our own README: an object id left unprefixed after the
  compound change, and a full-canvas backdrop written as `raw scene` (drawn ON TOP, hiding the activity)
  where it needed `raw scene under`.

  A block written on one line now names the rule and shows the block laid out, instead of reporting
  `unrecognised line`.

## 0.3.0

### Minor Changes

- [`943eef4`](https://github.com/flatink/flatkit/commit/943eef4031006b0090d0c1bbdaf9f7f1191970ba) Thanks [@kaelhem](https://github.com/kaelhem)! - A document may hold several blocks.

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

## 0.2.2

### Patch Changes

- [`e90cf8d`](https://github.com/flatink/flatkit/commit/e90cf8d4e05790ac7cd0fa38fad2d5223e27d17b) Thanks [@kaelhem](https://github.com/kaelhem)! - Put top-level `raw { ... }` content where its statements are legal.

  `var` (like `asset`, `use`, `def`) is a HEADER declaration and a parse error after `scene`, and a `raw`
  block written below the gesture landed exactly there: the documented example in the README compiled to
  an error. `object` and `fn` are accepted on either side, so the header position is the only one where
  all of it works - everything top-level now goes before the expansion, wherever the author wrote it.
  Moving an `object` up changes nothing, since behavior binds by name and not by position.

  Also: the one-line form no longer carries the spaces that hugged its braces into the output.

## 0.2.1

### Patch Changes

- Updated dependencies [[`3d3e34b`](https://github.com/flatink/flatkit/commit/3d3e34b9b37e59068992d422924d112c573ce832)]:
  - @flatkit/compiler@0.26.0

## 0.2.0

### Minor Changes

- [`c87c115`](https://github.com/flatink/flatkit/commit/c87c1158af4ccedd0a8c6139a4bdafa9beaa10f8) Thanks [@kaelhem](https://github.com/kaelhem)! - Fix the escape hatch, and give the host what the gesture parsed.

  - **`raw { ... }` beside a gesture was dropped in SILENCE.** Only the block's body was read; everything
    outside it - before or after - never travelled. Since a gesture emits no appearance by design, the
    escape hatch is the only route to an activity that is not a greybox, and it was closed: an author
    wrote decor, the expansion compiled, `checkProgram` said ok, and nothing was there. Anything written
    beside the block now travels with it, `raw` or plain FlatInk.
  - **New `raw scene { ... }`** splices verbatim INSIDE the generated scene. A program may only have one
    `scene` block, so this is the one place decor can go, and no hatch reached it.
  - **A second gesture block raises `MultipleGesturesError`** instead of being quietly ignored. Each
    gesture emits its own scene, so two cannot be merged; say so rather than drop one.
  - **`desugar()` returns `meta`**: the prompt the gesture parsed, and the labels behind the payload
    indices (`{ item = 2 }` is `meta.items[2]`). `place` parsed its prompt and threw it away, so the one
    text a host must display was recoverable only by re-parsing the block - a second parser waiting to
    drift. All three gestures now also write the prompt into the expansion as a comment.
  - **Footprints are in the reference a model is prompted with.** Each `summary` states the size of what
    it places, and the new `sugarCard()` assembles grammar, canvas and footprints in one pasteable block.
    Measured: a prompt without the numbers produced overlapping hitboxes in 4 of 10 activities, 0 of 10
    with them. The sizes were public all along; nothing said to go and read them.

## 0.1.1

### Patch Changes

- Updated dependencies [[`c60b730`](https://github.com/flatink/flatkit/commit/c60b7302466c7643824335a28b0f9c1743cc3604)]:
  - @flatkit/compiler@0.25.0
