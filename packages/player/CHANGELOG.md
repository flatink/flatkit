# @flatkit/player

## 0.11.0

### Minor Changes

- 40c09c1: Angle units: degrees for authoring, radians for math — both first-class.

  - **New `rotationDeg` channel binding** — authoring sugar for `rotation = rad(<expr>)`. Write angles in
    degrees where it reads better: `rotationDeg = 45`, `rotationDeg = handAngle`. The `rotation` channel
    stays radians (for `sin`/`cos`/`atan2`/`gesture.angle`).
  - **New `turnDeg` interactor** — the degrees twin of `turn`. `turnDeg a around cx,cy` writes the
    pivot→cursor angle in **degrees** (pairs with `rotationDeg = a`); `turn` writes **radians** (pairs with
    `rotation = a`). `snap <deg>` is authored in degrees on both.
  - **BREAKING — `turn` now writes radians** (was degrees), matching the `rotation` channel and removing the
    footgun where `rotation = <turnVar>` spun ~57× too fast. Migrate: drop a stray `rad()` (`rotation = a`),
    or switch the pair to degrees (`turnDeg` + `rotationDeg = a`).

### Patch Changes

- Updated dependencies [a3abdf8]
- Updated dependencies [40c09c1]
  - @flatkit/engine@0.11.0
  - @flatkit/types@0.11.0

## 0.10.0

### Minor Changes

- Editor static **state preview**: a state-driven symbol now appears in its selected state in the editor,
  not frozen at frame 0.

  A `states {}` value is a static CONFIGURATION (a door posed `open`), not playback. The editor freezes nested
  symbols (their internal timeline does not advance while a parent scope is edited), but a state is exactly the
  kind of frozen-yet-meaningful position that should still show. So when an instance's symbol exposes states,
  its frozen local frame is now the frame of its selected state (call-site value / initial), interpolating for
  a fractional/animated value — instead of always 0.

  - New pure helper `frozenInstanceFrame(sym, inst)` in `@flatkit/engine/params`: the static frame of a frozen
    instance — its selected state's frame if the symbol exposes states, else 0.
  - Threaded through every editor path so render, **selection bounding box** (`@flatkit/engine` `containerBBox`),
    and **hit-test** (`@flatkit/player/hit`) agree: the door is shown, boxed, and clicked in its open shape.
  - Player playback is unchanged (the new branch only applies to the editor's frozen sub-scopes; the live
    player resolves the full local frame, states included, as before).

### Patch Changes

- Updated dependencies []:
  - @flatkit/engine@0.10.0
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
