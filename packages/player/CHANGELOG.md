# @flatkit/player

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
