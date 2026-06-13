# @flatkit/player

## 0.5.0

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.5.0
  - @flatkit/engine@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies []:
  - @flatkit/engine@0.4.0
  - @flatkit/types@0.4.0

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
  - @flatkit/types@0.3.0

## 0.2.0

### Minor Changes

- Add a self-contained browser bundle: `@flatkit/player/browser` (`dist/browser.js`) is a single
  ESM file with `@flatkit/engine`/`@flatkit/types` inlined and no bare imports — droppable straight
  into a `<script type="module">` or a static site, no bundler required. The library entry points
  (`.`, `./debug`, `./render`, `./hit`) are unchanged.

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.2.0
  - @flatkit/engine@0.2.0
