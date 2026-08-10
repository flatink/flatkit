# @flatkit/sugarflat

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
