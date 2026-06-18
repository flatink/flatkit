# @flatkit/engine

## 0.15.2

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.15.2

## 0.15.1

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.15.1

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

- Updated dependencies []:
  - @flatkit/types@0.14.5

## 0.14.4

### Patch Changes

- [`0aca995`](https://github.com/zwykstudio/flatkit/commit/0aca99524deb94299915d6ac9cee2d0650fc2890) Thanks [@kaelhem](https://github.com/kaelhem)! - Fix: behavior (`fn`, `every frame`, `object`, `label`) placed BEFORE the `scene { … }` block is now parsed
  instead of silently dropped — and, critically, no longer makes the composition parser bail and discard the
  WHOLE scene (it produced `layers: []`, a blank render). The behavior region is now the entire program
  outside the `scene { … }` block (header and tail alike), with the scene block and the single-line header
  directives masked out. A value-function called from an `every frame` script (`fn dbl(n) = n*2` →
  `d = dbl(a)`) consequently returns the right value regardless of where the `fn` is declared, where it used
  to return 0. Programs that already keep behavior after the scene block are unaffected.

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

- Updated dependencies []:
  - @flatkit/types@0.14.4

## 0.14.3

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.14.3

## 0.14.2

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.14.2

## 0.14.1

### Patch Changes

- [`bd0fdfb`](https://github.com/zwykstudio/flatkit/commit/bd0fdfb92aa159be0841c3fd1a591a084c3c59e5) Thanks [@kaelhem](https://github.com/kaelhem)! - Fix: `object` channel expressions (`scaleX`/`scaleY`/`rotation`) now transform around the group's declared
  **`pivot`**, consistent with cel poses — instead of always around the local origin `(0,0)`. Before, a group
  `at 0,0 pivot 376,246` driven by `object { scaleX = s }` shrank toward the top-left corner and `rotation`
  swung it in an arc; now it scales/spins **in place** around the pivot. With no `pivot` (default `{0,0}`) the
  behavior is byte-identical to before (origin-based). When a pivot is set, the `x`/`y` channels position the
  pivot (the object's anchor). (Friction X.)
- Updated dependencies []:
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

- Updated dependencies []:
  - @flatkit/types@0.14.0

## 0.13.0

### Minor Changes

- [`7cc0ece`](https://github.com/zwykstudio/flatkit/commit/7cc0ece3c04b7f270757efbe34550d5094340f3d) Thanks [@kaelhem](https://github.com/kaelhem)! - DSL footgun fixes (three "accepted at --check, silently no-op at runtime" traps reported from the field):

  - **`scale` is now authoring sugar** for `scaleX = e` + `scaleY = e` (uniform scale), both at top level and inside `each` blocks — mirroring the `.flat` pose format. Before, `object "X" { scale = k }` parsed but was dropped, so the object never scaled.
  - **A bare `text "…" as "id"` leaf is addressable by `object "id"`.** The text `as` id (the namespace `text("id")` reads) was disjoint from the `object` name namespace (= the text content), so `object "id" { opacity = 0 }` silently no-op'd. `object` now resolves an explicit text id too.
  - **`flatc --check` surfaces behavior parse errors inside `object` blocks** (unknown channels, malformed statements) instead of dropping them. These never reached the Doc-based linter, so typos like `scaleZ = 1` or `opacty = 0` passed silently; they now error with the `object "name"` scope and line.

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.13.0

## 0.12.1

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.12.0

## 0.11.0

### Patch Changes

- a3abdf8: `use "feedback"` gains `pulse(since, dur)` — a linear `1→0` ramp over `dur` seconds since the instant
  `since`, for readable timed feedback (a message/flash that fades over a duration you state, instead of a
  too-fast multiplicative decay). Stateless: the author captures the instant in a handler
  (`var shown = -999` + `when wrong { shown = time }`) and binds `opacity = pulse(shown, 4)`.
- 40c09c1: Parameterized-symbol expansion no longer swallows a closing `}` that shares the instance's line. An
  `instance "Name"(args) … } }` — the braces closing its layer/scene on the same line — now compiles;
  before it failed with a misleading `"{" expected, "}" found`. The instance's trailing attributes now stop
  at the first enclosing-block `}` (brace depth 0) or newline instead of blindly consuming to end-of-line.
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

## 0.5.0

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.5.0

## 0.4.0

### Minor Changes

- Font family alias for headless `--render`: `asset "id" "font.woff2" font "Quicksand"` registers the embedded face under the declared family instead of the file's intrinsic name-table family. Fixes variable-font static exports whose name table is wrong (skia would otherwise read them as `… Thin/Light` and fall back). Browsers are unaffected (they bind families via `FontFace`); the alias only steers `flatc --render`.

### Patch Changes

- Updated dependencies []:
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
  - @flatkit/types@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.2.0
