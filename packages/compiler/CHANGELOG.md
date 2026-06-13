# @flatkit/compiler

## 0.5.0

### Minor Changes

- `flatc --preview <library.flat>`: wrap a single symbol from a `.flat` library into a minimal, playable `Doc` — a single instance centered on a stage auto-sized to the symbol's bounds — without hand-authoring a wrapper `.flatink`. Outputs a `.flatpack` to drop in the player (default) or a PNG with `--render`. `--symbol NAME` selects the symbol (default: the first; others are listed), `--pad N` sets the padding (default 24px); with `--render` the usual `--frame` / `--scale` / `--at` / `--steps` apply, and the symbol's own (possibly nested) timeline plays as the root frame advances.

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.5.0
  - @flatkit/engine@0.5.0
  - @flatkit/player@0.5.0

## 0.4.0

### Minor Changes

- Font family alias for headless `--render`: `asset "id" "font.woff2" font "Quicksand"` registers the embedded face under the declared family instead of the file's intrinsic name-table family. Fixes variable-font static exports whose name table is wrong (skia would otherwise read them as `… Thin/Light` and fall back). Browsers are unaffected (they bind families via `FontFace`); the alias only steers `flatc --render`.

### Patch Changes

- Updated dependencies []:
  - @flatkit/engine@0.4.0
  - @flatkit/types@0.4.0
  - @flatkit/player@0.4.0

## 0.3.0

### Minor Changes

- Embedded fonts now render in `flatc --render`, and text supports a `stroke` (outline).

  - **`--render` registers embedded fonts**: any `asset "id" "font.woff2" font` is materialized and
    registered with skia (by its intrinsic family name) before capture, so headless PNGs use the authored
    face instead of a host fallback. `.woff2/.woff/.ttf/.otf` supported; registered families are logged to
    stderr.
  - **Text stroke**: `text "…" color #fff stroke <paint> <width> [cap …] [join …] [miter n] [dash a,b]`
    outlines the glyphs (solid or gradient paint), drawn behind the fill so the fill keeps its full weight.
    Same grammar as path/region strokes; round-trips through the `.flat`/`.flatink` DSL.

### Patch Changes

- Updated dependencies []:
  - @flatkit/engine@0.3.0
  - @flatkit/player@0.3.0
  - @flatkit/types@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @flatkit/player@0.2.0
  - @flatkit/types@0.2.0
  - @flatkit/engine@0.2.0
