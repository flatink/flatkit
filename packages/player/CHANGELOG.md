# @flatkit/player

## 0.16.3

### Patch Changes

- [`c32026c`](https://github.com/zwykstudio/flatkit/commit/c32026ca3e3bad35612c3e06b127a99b89850636) Thanks [@kaelhem](https://github.com/kaelhem)! - fix(player): two pointer-input edge cases (from the security/quality review)

  - **Wheel while paused.** The `mouse.wheel` delta banked while the player is PAUSED is now discarded on
    `play()`, so scrolling a paused scene no longer applies as a sudden jump on resume (it accumulated with
    nothing integrating it).
  - **Pointer capture.** `onPointerUp`/`onPointerCancel` now always release the pointer capture (guarded by
    `hasPointerCapture`), including when a click-only press turned into a drag — previously the explicit
    release was skipped on that path (the browser auto-released, but the state was inconsistent).

- Updated dependencies []:
  - @flatkit/types@0.16.3
  - @flatkit/engine@0.16.3

## 0.16.2

### Patch Changes

- Updated dependencies [[`ecc39a2`](https://github.com/zwykstudio/flatkit/commit/ecc39a2c3b7d8354e5e8b11bc964566958fee45d)]:
  - @flatkit/engine@0.16.2
  - @flatkit/types@0.16.2

## 0.16.1

### Patch Changes

- Updated dependencies [[`6c386b0`](https://github.com/zwykstudio/flatkit/commit/6c386b09b941cd6d53cb32d7aa1a419f971d9434)]:
  - @flatkit/engine@0.16.1
  - @flatkit/types@0.16.1

## 0.16.0

### Minor Changes

- [`70f46c9`](https://github.com/zwykstudio/flatkit/commit/70f46c949f21099833f70b27428374917a947112) Thanks [@kaelhem](https://github.com/kaelhem)! - feat(player): mouse-wheel scroll via `mouse.wheel` (+ a `wheel` headless gesture)

  The player now listens to the wheel and exposes **`mouse.wheel`**: the wheel delta accumulated this frame
  (reset each tick, like `mouse.dx/dy`). Read it in an `every frame` accumulator —
  `off = clamp(off + mouse.wheel, 0, max)` — the same idiom as finger/handle scroll. The wheel is consumed
  (`preventDefault`) **only when the scene references `mouse.wheel`**, so scenes that ignore it let the page
  scroll normally over the canvas (zero regression). A new `{ "type": "wheel", "dy": N }` headless gesture
  (`flatc --play --script`) drives it for tests.

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.16.0
  - @flatkit/engine@0.16.0

## 0.15.2

### Patch Changes

- [`2d23d0b`](https://github.com/zwykstudio/flatkit/commit/2d23d0bfab98a02f79af4dd03e360c84bee91318) Thanks [@kaelhem](https://github.com/kaelhem)! - fix(player): defer `click` to release with a movement threshold (tap vs drag)

  `when clicked` fired on pointer-**down**, so a drag that _started_ on a clickable element also fired its
  `click` — you couldn't have "tap to pick" and "drag to scroll" on the same element. `click` is now deferred
  to pointer-**up** and fires only if the pointer stayed within a small tolerance (`TAP_TOL`, 6 px) — a tap; a
  press that travels past it is a **drag** and emits no `click`. A tappable and a draggable behavior can now
  coexist on the same element with no phantom click.

- Updated dependencies []:
  - @flatkit/types@0.15.2
  - @flatkit/engine@0.15.2

## 0.15.1

### Patch Changes

- [`deb96f0`](https://github.com/zwykstudio/flatkit/commit/deb96f01d596fa8a082366021adcb415e85a706c) Thanks [@kaelhem](https://github.com/kaelhem)! - fix(player): sync `mouse.x/y` on pointer-down/up so press/click/release handlers read the real pointer

  `mouse.*` was refreshed only on `pointermove`, so on the **first touch** (no hover precedes a touch) a
  `when pressed` / `when clicked` / `when released` handler saw a **stale** `mouse` (0,0) — breaking
  grab-anchor capture and relative finger-drag. `onPointerDown`/`onPointerUp` now sync `mouse.x/y` to the
  event point before firing handlers, which enables **relative drag / finger-scroll** (`anchor = mouse.x` on
  press, `mouse.x - anchor` on drag) and a release-based **tap-vs-drag** check. Desktop was unaffected (the
  preceding hover masked it).

- Updated dependencies []:
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

## 0.14.5

### Patch Changes

- [`eb612eb`](https://github.com/zwykstudio/flatkit/commit/eb612eb3c5e6712b40c6b104a450b23b8c75e2ea) Thanks [@kaelhem](https://github.com/kaelhem)! - Perf pass on the player's hot eval/resolve path (profiled: object construction dominated ~47% of CPU on a
  script-heavy scene; it's now negligible). No behavior change — verified against the existing suite plus new
  intra-frame correctness tests (sequential var deps, loop + setIndex + array read-back, named refs).

  - **`exprScope` no longer copies `MATH_CTX`** (~30 entries) into the context on every evaluation. `evalNode`
    resolves math names from `MATH_CTX` by reference (math still takes priority over a same-named variable),
    keeping the own-property-only sandbox. This was the single biggest allocation in the eval loop.
  - **`Player.evalNumber` evaluates against the per-frame context directly** — no `exprScope` copy per
    statement. `time`/`frame`/`clock` are baked onto the cached context (reserved names, never shadowed).
  - **Variable write-through (`setVarLive`)**: every `setVar` updates the cached context in O(1), so the
    per-frame context cache no longer re-copies all variables on every eval (it was O(vars × evals/frame)).
    Covers the every-frame interpreter, loop variables, procedures, and interactor outputs; arrays mutate in
    place through the shared reference.
  - **`applyExprChannels` builds the eval context once per item** and only swaps `value` per channel, instead
    of an `exprScope` copy per channel (helps cel/expression-heavy and instance-heavy scenes).
  - **Cel pose resolution uses an id→item map** instead of a linear `find` per pose (O(items×poses) → O(1)).
  - **Render/hit layer structure in one pass** (`layerStructure`): the hidden-id set and the mask/guide parent
    maps are built with a single `byId` map and a single loop, instead of three separate walks per traversal.
  - **Opaque regions skip the per-region `ctx.save()/restore()`** (only needed to scope `globalAlpha` when the
    region is semi-transparent) — paintRegion sets its own styles and draws with an explicit Path2D.

  A new `pnpm bench` (`packages/player/bench/render.bench.mts`) measures ms/frame for a representative heavy
  scene, as a relative regression check.

- Updated dependencies [[`eb612eb`](https://github.com/zwykstudio/flatkit/commit/eb612eb3c5e6712b40c6b104a450b23b8c75e2ea)]:
  - @flatkit/engine@0.14.5
  - @flatkit/types@0.14.5

## 0.14.4

### Patch Changes

- [`0aca995`](https://github.com/zwykstudio/flatkit/commit/0aca99524deb94299915d6ac9cee2d0650fc2890) Thanks [@kaelhem](https://github.com/kaelhem)! - Perf: the `every frame` script interpreter no longer re-parses expressions and rebuilds the evaluation
  context on every call (it ran hundreds of times per frame).

  - **Memoized expression compilation** (`compileCached`, now shared from `@flatkit/engine/expr`): an
    expression's AST is immutable, so each distinct source is parsed once and reused. `Player.evalNumber` and
    value-function compilation now use it (the channel resolver already did). Kills the per-call re-tokenize +
    re-parse.
  - **Per-frame `exprCtx` cache**: the context (named-channel snapshot, function closures, mouse/keys) is
    stable within a frame, so it's built once per frame and only the live variables are refreshed on reuse
    (intra-frame `setVar`s stay visible; value-functions keep priority over same-named vars). Bypassed during a
    handler (`self` set) and for interpolated render contexts; invalidated on input/seek/load.

  Net effect on a script-heavy scene (~400 expressions/frame): roughly **1.8× faster** simulation, no behavior
  change (verified: intra-frame sequential variable dependencies and named-object references stay correct).

- Updated dependencies [[`0aca995`](https://github.com/zwykstudio/flatkit/commit/0aca99524deb94299915d6ac9cee2d0650fc2890), [`0aca995`](https://github.com/zwykstudio/flatkit/commit/0aca99524deb94299915d6ac9cee2d0650fc2890)]:
  - @flatkit/engine@0.14.4
  - @flatkit/types@0.14.4

## 0.14.3

### Patch Changes

- [`1bb1ca3`](https://github.com/zwykstudio/flatkit/commit/1bb1ca3b6d5c82c19a1a9d6b172d799895170f06) Thanks [@kaelhem](https://github.com/kaelhem)! - Perf: a container/leaf whose resolved `opacity` is `<= 0.01` is now skipped at render — its whole subtree
  is pruned (no draw, no child expression eval), mirroring the hit-test predicate (which already lets
  `opacity <= 0.01` click through). Previously only an opacity of EXACTLY `0` was skipped, so the common
  gating idiom `opacity = phase == X ? 1 : 0` cost nothing when off-phase reached exactly 0, but a value
  SMOOTHED toward ~0 (e.g. 0.005) still drew and evaluated the entire hidden subtree every frame. Scenes that
  stack several phases gated this way (a card with many off-phase layers) get a large speedup with no authoring
  change, and draw/hit stay aligned (an alpha≈0 item was already non-interactive; now it's also free to render).
- Updated dependencies []:
  - @flatkit/types@0.14.3
  - @flatkit/engine@0.14.3

## 0.14.2

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.14.2
  - @flatkit/engine@0.14.2

## 0.14.1

### Patch Changes

- Updated dependencies [[`bd0fdfb`](https://github.com/zwykstudio/flatkit/commit/bd0fdfb92aa159be0841c3fd1a591a084c3c59e5)]:
  - @flatkit/engine@0.14.1
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
  - @flatkit/types@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [[`7cc0ece`](https://github.com/zwykstudio/flatkit/commit/7cc0ece3c04b7f270757efbe34550d5094340f3d)]:
  - @flatkit/engine@0.13.0
  - @flatkit/types@0.13.0

## 0.12.1

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.12.1
  - @flatkit/engine@0.12.1

## 0.12.0

### Minor Changes

- [`eeecbce`](https://github.com/zwykstudio/flatkit/commit/eeecbceb50cca47f99e3ad1599cfa39b65acfce5) Thanks [@kaelhem](https://github.com/kaelhem)! - Add a semantic `turn` gesture to headless gesture-replay (`flatc --play`):
  `{ type: 'turn', target, angle, settle? }` rotates a `turn`/`turnDeg` interactor by `angle`
  (signed; degrees for `turnDeg`, radians for `turn`) around its pivot, swept in small sub-steps so
  both multi-turn rotation and delta-accumulating `every frame` integration work. `settle` (default 1)
  advances the simulation between sub-steps so an `every frame` that integrates the per-step delta sees
  each increment. This lets rotary controls (dials, wheels, valves) be driven and asserted in headless
  tests, instead of only via `set` on the bound variable.

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.12.0
  - @flatkit/engine@0.12.0

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
