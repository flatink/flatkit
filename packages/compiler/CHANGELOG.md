# @flatkit/compiler

## 0.16.1

### Patch Changes

- Updated dependencies [[`6c386b0`](https://github.com/zwykstudio/flatkit/commit/6c386b09b941cd6d53cb32d7aa1a419f971d9434)]:
  - @flatkit/engine@0.16.1
  - @flatkit/player@0.16.1
  - @flatkit/types@0.16.1

## 0.16.0

### Patch Changes

- Updated dependencies [[`70f46c9`](https://github.com/zwykstudio/flatkit/commit/70f46c949f21099833f70b27428374917a947112)]:
  - @flatkit/player@0.16.0
  - @flatkit/types@0.16.0
  - @flatkit/engine@0.16.0

## 0.15.2

### Patch Changes

- Updated dependencies [[`2d23d0b`](https://github.com/zwykstudio/flatkit/commit/2d23d0bfab98a02f79af4dd03e360c84bee91318)]:
  - @flatkit/player@0.15.2
  - @flatkit/types@0.15.2
  - @flatkit/engine@0.15.2

## 0.15.1

### Patch Changes

- Updated dependencies [[`deb96f0`](https://github.com/zwykstudio/flatkit/commit/deb96f01d596fa8a082366021adcb415e85a706c)]:
  - @flatkit/player@0.15.1
  - @flatkit/types@0.15.1
  - @flatkit/engine@0.15.1

## 0.15.0

### Minor Changes

- [`fc226cc`](https://github.com/zwykstudio/flatkit/commit/fc226ccaa2853fb1e6441a1943eabf9ba1abd009) Thanks [@kaelhem](https://github.com/kaelhem)! - feat: text on a path (`text … along …`)

  Lay text along a curve — banners, badges, ribbons, dials (the FlatInk analogue of SVG `textPath`).

  - **`along "<id>"`** follows a named shape's outline (`circle`/`rect`/`ellipse`/`path … as "<id>"`); a closed
    named shape anchors the run **upright over the top** by default. **`along path "<d>"`** takes inline SVG
    path data instead (baked literally).
  - **`start <0..1>`** / **`align`** anchor the run; **`side over|under`** puts it outside/inside;
    **`spacing <px>`** tracks the glyphs (negative allowed). Closed paths wrap; open paths drop overflow.
  - **Animate** by quoting the value: `start "time * 0.1"` (marquee), `spacing "sin(time) * 4"` (eased
    tracking) — same expression scope as `bind`.
  - **Shapes are now nameable** with `as "<id>"`, and `flatc --check` warns when a run overflows its path.

### Patch Changes

- Updated dependencies [[`fc226cc`](https://github.com/zwykstudio/flatkit/commit/fc226ccaa2853fb1e6441a1943eabf9ba1abd009)]:
  - @flatkit/types@0.15.0
  - @flatkit/engine@0.15.0
  - @flatkit/player@0.15.0

## 0.14.5

### Patch Changes

- Updated dependencies [[`eb612eb`](https://github.com/zwykstudio/flatkit/commit/eb612eb3c5e6712b40c6b104a450b23b8c75e2ea)]:
  - @flatkit/engine@0.14.5
  - @flatkit/player@0.14.5
  - @flatkit/types@0.14.5

## 0.14.4

### Patch Changes

- Updated dependencies [[`0aca995`](https://github.com/zwykstudio/flatkit/commit/0aca99524deb94299915d6ac9cee2d0650fc2890), [`0aca995`](https://github.com/zwykstudio/flatkit/commit/0aca99524deb94299915d6ac9cee2d0650fc2890)]:
  - @flatkit/engine@0.14.4
  - @flatkit/player@0.14.4
  - @flatkit/types@0.14.4

## 0.14.3

### Patch Changes

- Updated dependencies [[`1bb1ca3`](https://github.com/zwykstudio/flatkit/commit/1bb1ca3b6d5c82c19a1a9d6b172d799895170f06)]:
  - @flatkit/player@0.14.3
  - @flatkit/types@0.14.3
  - @flatkit/engine@0.14.3

## 0.14.2

### Patch Changes

- [`4c1744f`](https://github.com/zwykstudio/flatkit/commit/4c1744f6644426f93124c2a9d27b4974889898e1) Thanks [@kaelhem](https://github.com/kaelhem)! - Fix: `flatc --render` no longer crashes with `DOMMatrix is not defined` on scenes that contain a `mask`
  layer. The mask/clip path builder does `new DOMMatrix([...])` (a browser global absent under Node); the
  headless render entry now injects skia-canvas's `DOMMatrix` export as a global alongside `Path2D`. `--check`
  and flatpack compilation were unaffected — only the PNG render path. Also: `flatc --render` prints the full
  stack on failure when `FLATC_DEBUG` is set, to ease diagnosing such headless-only errors.
- Updated dependencies []:
  - @flatkit/types@0.14.2
  - @flatkit/engine@0.14.2
  - @flatkit/player@0.14.2

## 0.14.1

### Patch Changes

- Updated dependencies [[`bd0fdfb`](https://github.com/zwykstudio/flatkit/commit/bd0fdfb92aa159be0841c3fd1a591a084c3c59e5)]:
  - @flatkit/engine@0.14.1
  - @flatkit/player@0.14.1
  - @flatkit/types@0.14.1

## 0.14.0

### Minor Changes

- [`5dd00af`](https://github.com/zwykstudio/flatkit/commit/5dd00aff5be3a3c495d863642cab71586db3cdb3) Thanks [@kaelhem](https://github.com/kaelhem)! - Two more "silent at runtime" footguns from the field, plus a new monotone clock:

  - **`clock` — a monotone elapsed-seconds reserved name** (never wraps), alongside `time`. `time = frame/fps`
    resets to 0 every `durationFrames` (the timeline loops), so `sin(time * f)` jumps on each loop — and a
    `.flatink` with no `timeline` defaults to 60 frames (2.5 s @24fps). Use `clock` for free-running ambient
    motion: `sin(clock * f)` never jumps. (Friction V, fix c.)
  - **`flatc --check` warns when a channel expression uses `time` under a short looping timeline**
    (`durationFrames ≤ 120`) — points at the loop reset and suggests `clock` / a longer `timeline`. (Friction
    V, fix b.)
  - **`flatc --check` now also surfaces dropped parse errors in SCENE scripts** (`every frame`, timeline
    blocks), not just `object` blocks — e.g. two statements on one line (`{ a = 1  b = 2 }`), which used to
    pass silently with only a "variable never used" warning. (Friction U; completes the behavior-diagnostics
    coverage added previously for `object` blocks.)

### Patch Changes

- Updated dependencies [[`5dd00af`](https://github.com/zwykstudio/flatkit/commit/5dd00aff5be3a3c495d863642cab71586db3cdb3)]:
  - @flatkit/engine@0.14.0
  - @flatkit/player@0.14.0
  - @flatkit/types@0.14.0

## 0.13.0

### Minor Changes

- [`7cc0ece`](https://github.com/zwykstudio/flatkit/commit/7cc0ece3c04b7f270757efbe34550d5094340f3d) Thanks [@kaelhem](https://github.com/kaelhem)! - DSL footgun fixes (three "accepted at --check, silently no-op at runtime" traps reported from the field):

  - **`scale` is now authoring sugar** for `scaleX = e` + `scaleY = e` (uniform scale), both at top level and inside `each` blocks — mirroring the `.flat` pose format. Before, `object "X" { scale = k }` parsed but was dropped, so the object never scaled.
  - **A bare `text "…" as "id"` leaf is addressable by `object "id"`.** The text `as` id (the namespace `text("id")` reads) was disjoint from the `object` name namespace (= the text content), so `object "id" { opacity = 0 }` silently no-op'd. `object` now resolves an explicit text id too.
  - **`flatc --check` surfaces behavior parse errors inside `object` blocks** (unknown channels, malformed statements) instead of dropping them. These never reached the Doc-based linter, so typos like `scaleZ = 1` or `opacty = 0` passed silently; they now error with the `object "name"` scope and line.

### Patch Changes

- Updated dependencies [[`7cc0ece`](https://github.com/zwykstudio/flatkit/commit/7cc0ece3c04b7f270757efbe34550d5094340f3d)]:
  - @flatkit/engine@0.13.0
  - @flatkit/player@0.13.0
  - @flatkit/types@0.13.0

## 0.12.1

### Patch Changes

- [`8bf8505`](https://github.com/zwykstudio/flatkit/commit/8bf85052dcf153859b62a2fbc24b56c5f8b790ae) Thanks [@kaelhem](https://github.com/kaelhem)! - Clearer lint diagnostic for the [#1](https://github.com/zwykstudio/flatkit/issues/1) footgun — two statements on one line. FlatInk ends a statement at the
  newline, so a second `channel = …` crammed onto the same line gets swallowed into the first expression.
  `flatc --check` now reports "two statements on one line — put each on its own line" instead of the cryptic
  "invalid expression: unexpected character =". (Comparisons `==`/`<=`/`>=`/`!=` are not mistaken for it.)
- Updated dependencies []:
  - @flatkit/types@0.12.1
  - @flatkit/engine@0.12.1
  - @flatkit/player@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies [[`eeecbce`](https://github.com/zwykstudio/flatkit/commit/eeecbceb50cca47f99e3ad1599cfa39b65acfce5)]:
  - @flatkit/player@0.12.0
  - @flatkit/types@0.12.0
  - @flatkit/engine@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [a3abdf8]
- Updated dependencies [40c09c1]
- Updated dependencies [40c09c1]
  - @flatkit/engine@0.11.0
  - @flatkit/player@0.11.0
  - @flatkit/types@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies []:
  - @flatkit/engine@0.10.0
  - @flatkit/player@0.10.0
  - @flatkit/types@0.10.0

## 0.9.0

### Minor Changes

- **`cel … hold { }`** — compile-time keyframe sugar. A `hold` cel carries the previous cel's poses forward
  for every container it doesn't itself mention, so a static/unchanged container persists without re-typing
  it on every keyframe:

  ```
  cel 0  tween { pose "Base" at 0,0   pose "Ring" scale 1 }
  cel 30 hold tween { pose "Ring" scale 4 }   # Base carried automatically
  cel 60 hold       { pose "Ring" scale 1 }
  ```

  It's a pure rewrite (the compiler expands it to full cels; `spin`/`turns` are dropped on carry since a
  carried pose is a HOLD), so the runtime is unchanged and the default — an omitted container is removed,
  i.e. a symbol _exits_ by no longer being posed — still holds. Opt-in per cel.

  Docs: a "Presence across cels" section in the Animating a symbol guide (a cel is a full snapshot; static
  elements belong on their own cel-less layer; `cel hold` avoids repetition).

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.9.0
  - @flatkit/engine@0.9.0
  - @flatkit/player@0.9.0

## 0.8.0

### Minor Changes

- Symbol params, clipping & CLI ergonomics:

  - **`stroke <param>`**: a `color` param can now bind a stroke, not just a fill (`path "…" nofill stroke edge 2`).
    New `Region.strokeParam`, resolved per instance at render — strokes are re-themable like fills.
  - **Free symbol section order**: `timeline`, `params`, and `states` blocks are accepted in **any order**
    before the layers (previously `params`/`states` before `timeline` gave a misleading "layer expected" error).
  - **`clip` on a container**: `group`/`instance` accept `clip <x> <y> <w> <h>` — a rectangular clip in local
    coords (new `Group.clip`/`Instance.clip`, `ClipRect` type). Cuts content outside the rect (e.g. the "feet"
    of an emerging shape) without a dedicated mask layer. Render-only (hit-test/bbox ignore it).
  - **`flatc --preview/--render --scale auto`**: picks the resolution factor from the content size — enlarges
    small/thin assets so fine filaments stay legible, leaves large assets at 1×.

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.8.0
  - @flatkit/engine@0.8.0
  - @flatkit/player@0.8.0

## 0.7.0

### Minor Changes

- Exposed typed **params** on `.flat` symbols — a symbol's public interface (restyle/tune without touching
  internals, e.g. by a small model).

  - New `params { <type> <name> = <default> [range <min> <max>] ["doc"] … }` block on a symbol. `<type>` is
    `color`, `number`, or `bool`.
  - **`color` params** feed a fill: `fill <param>` (new `Region.fillParam`), resolved per instance at render.
  - **`number`/`bool` params** become variables in the symbol's expressions (`expr y "sin(time)*wave"`,
    `"flag ? 1 : 0"`).
  - Set at the instance call-site — `instance "Boat" { hull = #1a5, wave = 1.5 }` (new `Instance.params`) —
    in `flatc --preview --set hull=#1a5,wave=1.5`, or (number/bool) at runtime via `Name.param = value`.
  - New pure module `@flatkit/engine/params` (`resolveInstanceParams`): declared defaults + call-site values,
    with state initials, into a per-instance `{ numeric, color }` scope (runtime overrides layered on top).
  - Docs: "Exposed parameters" section in the Animating a symbol guide.

  Note: param values referenced in a symbol's expressions are not yet added to the linter's known-identifier
  set (a future editor/lint refinement); color params are call-site/preview/default only (no live runtime
  color change yet).

- Exposed **named states** on `.flat` symbols (first slice of the symbol "public interface").

  - New `states <param> { <name> at <frame> … [initial <name>] [transition <n> [ease <e>]] }` block on a
    symbol. It declares an exposed param whose value selects a named state, anchored to a frame of the
    symbol's timeline.
  - The param **drives the symbol's local playhead**: `door = closed`/`0` → the closed frame, `door = open`/`1`
    → the open frame, `door = 0.5` → the authored in-between (so animating the variable plays the transition).
    States live inside the ordinary variable/expression system — no bespoke runtime.
  - `flatc --preview --set param=value` selects a state (by name or number) and bakes it into the preview,
    for both the `.flatpack` and `--render` output.
  - **Per-instance state from a program**: new `Name.param = value` action (`setParam`) addresses an instance
    by name and sets its exposed state (a state name or an expression). The player animates the declared
    `transition` automatically, and each instance keeps its own independent state.
  - New pure module `@flatkit/engine/states` (`stateFrame`, `stateValueOf`, `initialStateValue`).
  - Docs: "Named states" section (incl. `set Name.param = state`) in the Animating a symbol guide.

  Next: the broader typed `params {}` interface (colors/numbers/toggles, `fill hull`), and reading another
  object's state back by name in expressions.

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.7.0
  - @flatkit/engine@0.7.0
  - @flatkit/player@0.7.0

## 0.6.0

### Minor Changes

- Animation authoring ergonomics for `.flat` symbols:

  - **`pose` rotate/scale in human units**: `pose "G" rotate <deg> [scale <s> | scaleX <sx> scaleY <sy>]` —
    degrees and multipliers, resolved **around the group's pivot** at render time. No more hand-written
    `matrix(cosθ, sinθ, …)` in radians. An explicit `rotate` tween interpolates linearly in degrees, so
    `rotate 0 → 360` is a full turn (not a decomposed no-op).
  - **Patch semantics for partial poses**: a pose only overrides the channels it states; position, rotation,
    scale, opacity, tint and filters it omits are inherited from the body's resting pose. `pose "G" opacity 0.5`
    now keeps the body's place instead of snapping to `0,0`.
  - **`expr` angle helpers**: `rad(deg)`, `deg(rad)`, `turns(n)` for the radians-based `rotation` channel.
  - **`flatc --preview --bbox all` (new default)**: auto-sizes the stage to the union of bounds over every
    frame (sub-timelines unfrozen), so drifting/rotating/growing motion is never clipped. `--bbox frame0`
    restores the old frame-0 measure.
  - **Docs**: new "Animating a symbol (.flat)" guide; clearer `fill none` → `nofill` error.

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.6.0
  - @flatkit/engine@0.6.0
  - @flatkit/player@0.6.0

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
