# @flatkit/player

## 0.19.4

### Patch Changes

- [`3481147`](https://github.com/zwykstudio/flatkit/commit/34811472904012c35136957681d41c12ac5540d8) Thanks [@kaelhem](https://github.com/kaelhem)! - `flatc --check <library>.flat` now lints an asset library (per-symbol), instead of choking on it as a scene.

  `--check` always routed through the program parser, so a `.flat` lib (symbols/params/layers, not a scene) failed with a cascade of `[scene] unexpected statement "symbol"`; the only way to lint an asset was to compile a preview and call the API by hand. A `.flat` first positional is now detected (like `--preview` does) and parsed with `parseFlatLib`, its symbols merged into an empty-scene Doc, and run through the SAME `lintDoc`, so every existing check (params-in-`expr`, undeclared color param in a paint, unknown functions/objects) applies for free, with the identical `[scope] line:col: level: msg` format and exit code (non-zero on error, warnings non-blocking). Several `.flat` can be passed and are merged (`flatc a.flat b.flat --check`), and `--watch` works. The program path (`flatc x.flatink --check`, with `.flat` libs as args) is unchanged.

- Updated dependencies [[`3481147`](https://github.com/zwykstudio/flatkit/commit/34811472904012c35136957681d41c12ac5540d8)]:
  - @flatkit/types@0.19.4
  - @flatkit/engine@0.19.4

## 0.19.3

### Patch Changes

- [`1d13505`](https://github.com/zwykstudio/flatkit/commit/1d13505b4e9c9354136fb188d493e23af24957bb) Thanks [@kaelhem](https://github.com/kaelhem)! - `flatc --check` now flags a `color` param used as a paint that the symbol doesn't declare.

  A gradient stop (`0:teinte@0.8`), a `tint <param> <amount>`, or a `fill`/`stroke <param>` that references an undeclared (or mistyped) color param silently falls back to the literal hex at render -- a "dead recolor": the asset looks fine but the picker does nothing. The lint now walks each symbol's paints and warns on a color-param reference the owning symbol doesn't declare, scoped to that symbol (a `teinte` declared in symbol A doesn't silence the same name in symbol B). Non-blocking (a warning), so it can only surface a latent bug, never break a build. Complements the earlier "the lint knows a symbol's params in its expr" fix.

- Updated dependencies [[`1d13505`](https://github.com/zwykstudio/flatkit/commit/1d13505b4e9c9354136fb188d493e23af24957bb)]:
  - @flatkit/types@0.19.3
  - @flatkit/engine@0.19.3

## 0.19.2

### Patch Changes

- [`bcb9eed`](https://github.com/zwykstudio/flatkit/commit/bcb9eede3f20ee4cc2bda52e788013289bafb711) Thanks [@kaelhem](https://github.com/kaelhem)! - Harden the renderer against a crafted gradient in an untrusted `.flatpack` (security pass).

  The player renders untrusted `.flatpack` JSON and `sanitizeDoc` does not validate paint stops, so a crafted gradient could CRASH the render: a stop `param: "__proto__"` made the per-instance color lookup return `Object.prototype`, which the color helpers (`splitAlpha`/`withAlpha`) then threw on; a non-string color or a non-finite `offset`/`alpha` (e.g. `offset: "x"` -> NaN) made `addColorStop` throw. `resolveColorRef` now uses an OWN string value only (a prototype hit or non-string falls back to the literal hex) and ignores a non-finite alpha; the stop loop clamps a non-finite offset. A malformed gradient now degrades to a valid color instead of throwing. No effect on well-formed gradients (literal or param).

- Updated dependencies [[`bcb9eed`](https://github.com/zwykstudio/flatkit/commit/bcb9eede3f20ee4cc2bda52e788013289bafb711)]:
  - @flatkit/types@0.19.2
  - @flatkit/engine@0.19.2

## 0.19.1

### Patch Changes

- [`d4e9590`](https://github.com/zwykstudio/flatkit/commit/d4e9590e8b06fc7268c4930940ff86e892469ffc) Thanks [@kaelhem](https://github.com/kaelhem)! - Fix a `flatc --check` false positive: a symbol's own `params` are now known variables in its `expr`.

  A symbol can read an exposed `param` (or state param) inside a channel expression -- `expr scaleX "1 - stationnaire"` -- and the runtime and `flatc --preview` resolve it (the param is injected into the instance scope). But the semantic linter did not put those params in the scope's known ids, so it wrongly reported `unknown variable "stationnaire"`. `docLintContext` now adds the current scope's symbol params + state params, resolved from the scope's `editPath` so they are added ONLY to that symbol (a param named in symbol A can't mask a real typo of the same name in symbol B). Monotone-safe: it only adds valid names, so it can only remove false positives -- a genuinely undeclared id is still flagged.

- Updated dependencies [[`d4e9590`](https://github.com/zwykstudio/flatkit/commit/d4e9590e8b06fc7268c4930940ff86e892469ffc)]:
  - @flatkit/types@0.19.1
  - @flatkit/engine@0.19.1

## 0.19.0

### Minor Changes

- [`c53a7b3`](https://github.com/zwykstudio/flatkit/commit/c53a7b3471dae0e1bfef923cdab861cc0cef5284) Thanks [@kaelhem](https://github.com/kaelhem)! - Symbol COLOR params can now drive gradient STOPS and a TINT, not only a solid `fill <param>`.

  Recolorable generic effects (halos, glows, gradients) live in gradients and tints, but a `param color` could only feed a solid fill -- inside a `radial(...)`/`linear(...)` stop or a `tint`, the color was a baked hex and the param was dead. This generalizes the existing `fill <param>` to every place a color is accepted.

  - DSL: a gradient stop accepts a param ref with an optional alpha override -- `radial(0.5, 0.5, 0.5, 0:teinte@0.8, 1:teinte@0)` -- next to literal `0:#ffe9a8cc` stops; and `tint <param> <amount>` binds a tint hue to a param. The alpha is needed because a color param is a 6-digit hue (a halo wants "same hue, alpha fading 0.8 -> 0"). Round-trips through `flatFormat`.
  - Model: `Stop` gains `param?` + `alpha?`, `Tint` gains `param?` -- a unified "color ref (hex | param + alpha)". A new `resolveColorRef` is the single primitive behind solid fill, gradient stops and tint.
  - Player: stops and tint resolve per instance against the same `colorParams` scope as `fill <param>`; the tint is resolved to a concrete color before the off-screen composite, so the filter-composite cache busts when the param changes.
  - Engine: the merge key (`paintKey`) distinguishes a param stop from a literal one (no wrong merges); stop/tint interpolation carries the param binding.

  Backward compatible: a stop/tint with no param is an ordinary literal -- every existing hex gradient and tint renders pixel-for-pixel as before. The `@` character is now a token (the stop alpha marker); it was previously ignored, and no `.flat` source used it.

### Patch Changes

- Updated dependencies [[`c53a7b3`](https://github.com/zwykstudio/flatkit/commit/c53a7b3471dae0e1bfef923cdab861cc0cef5284)]:
  - @flatkit/types@0.19.0
  - @flatkit/engine@0.19.0

## 0.18.0

### Minor Changes

- [`9772d59`](https://github.com/zwykstudio/flatkit/commit/9772d592750f27dd482de0776464e64287dae552) Thanks [@kaelhem](https://github.com/kaelhem)! - Independent (MovieClip-style) playback per nested instance: `loop` / `once`.

  A nested instance used to be a Flash "graphic symbol" only -- its local frame DERIVED from the ancestor's, so a sub-loop was truncated and snapped back to mid-cycle whenever an ancestor's timeline was shorter than (or not a multiple of) the sub-loop. The only way to keep a state-loop or idle clean was to pad every parent to the LCM of its sub-loops, which broke again the moment the asset was composed into a host with a different root length.

  This adds the Flash "MovieClip" model: an instance with its OWN clock, driven by the runtime's monotone heartbeat (`mono`) on its OWN duration, immune to any ancestor's loop wrap.

  - DSL: `instance "X" as "y" loop` (independent) / `... once` (play through, then HOLD the last frame) / `... synced` (the unchanged default). Round-trips through `flatFormat`.
  - Engine: `resolveInstanceFrame` / `instanceFrames` take the mono clock; `independent` = `mono mod dur`, `once` = `clamp(mono, 0, dur-1)`. `synced` and `singleFrame` are byte-for-byte unchanged.
  - Player: the render/hit paths carry the monotone beat down every scope; a non-playing `seek` anchors `mono` to the scrubbed frame, so headless `seek`+`render` and `--render --frame N` resolve MovieClip clips deterministically (phase = frame mod dur). During playback `mono` free-runs across loop wraps, so the phase is continuous.
  - Compiler: `flatc --preview` now sizes the preview window to a common multiple of every `independent` descendant's duration (and past the longest `once` clip) so a nested MovieClip loops cleanly in the preview, without touching the previewed symbol's own authored duration.

  Backward compatible: absent playback = `synced`, so every existing `.flat` renders identically. A static walk with no runtime clock falls back to synced.

### Patch Changes

- Updated dependencies [[`9772d59`](https://github.com/zwykstudio/flatkit/commit/9772d592750f27dd482de0776464e64287dae552)]:
  - @flatkit/types@0.18.0
  - @flatkit/engine@0.18.0

## 0.17.3

### Patch Changes

- [`a8af28a`](https://github.com/zwykstudio/flatkit/commit/a8af28a5825cacf5e72acbe81cf8e01b49dd2140) Thanks [@kaelhem](https://github.com/kaelhem)! - Warm the hit-test path cache so the FIRST interaction isn't a cold-start jolt. The 0.17.2 cache removed the recurring mouse lag, but on an empty cache the very first pointermove/pointerdown still flattened every hittable Bezier path in the scene at once (~one-time stall). The player now pre-flattens all hittable region/cel-material paths on `requestIdleCallback` after the first paint (when input is enabled), so that one-time cost lands during load instead of on the user's first gesture. Also exposes `FlatPlayer.warmHitCache()` and a standalone `warmHitCache(doc)` export for hosts that want to trigger it explicitly (or run in a browser without `requestIdleCallback`).

- Updated dependencies [[`a8af28a`](https://github.com/zwykstudio/flatkit/commit/a8af28a5825cacf5e72acbe81cf8e01b49dd2140)]:
  - @flatkit/types@0.17.3
  - @flatkit/engine@0.17.3

## 0.17.2

### Patch Changes

- [`0955eec`](https://github.com/zwykstudio/flatkit/commit/0955eecfc05743b2fb30fb5a4fcea6fa12c0ea10) Thanks [@kaelhem](https://github.com/kaelhem)! - Fix the remaining pointer lag: memoize `pathToPolygons`. Hit-testing flattened every region's Bezier curves into polygons on every item on every `pointermove`, re-subdividing identical paths and allocating fresh rings each time — heavy CPU plus massive GC churn (the dominant cost in the browser profile). A path's geometry is invariant (dynamic geometry produces new path objects, never in-place mutation), so the default-tolerance flatten is now cached in a `WeakMap<Path, Polygon[]>` keyed by path identity. The hot hit callers (`hitRegion`, `pointInMask`, `regionHit`) reuse the same path reference across moves → cache hits, no re-flatten, no per-move allocation. Hit results are identical (pure memoization). The returned rings are now shared — treat them as read-only.

- Updated dependencies [[`0955eec`](https://github.com/zwykstudio/flatkit/commit/0955eecfc05743b2fb30fb5a4fcea6fa12c0ea10)]:
  - @flatkit/types@0.17.2
  - @flatkit/engine@0.17.2

## 0.17.1

### Patch Changes

- [`468c15d`](https://github.com/zwykstudio/flatkit/commit/468c15d3d69c5b4da621701ca861213a1b91dbe5) Thanks [@kaelhem](https://github.com/kaelhem)! - Fix pointer-move lag: the player rendered a full frame synchronously on every `pointermove` (which fire at 125–1000 Hz), on top of the 60 fps playback loop, saturating the main thread. Now the move render is coalesced — while a render loop (playback or a transition) is already running it repaints the next frame instead of per-event, and a static scene still renders synchronously so the cursor follows immediately. Also skip the per-move expression-cache invalidation when nothing reads `mouse.x`/`mouse.y` (a drag self-invalidates, so this is safe). Active-drag latency is unchanged (still synchronous).

- Updated dependencies [[`468c15d`](https://github.com/zwykstudio/flatkit/commit/468c15d3d69c5b4da621701ca861213a1b91dbe5)]:
  - @flatkit/types@0.17.1
  - @flatkit/engine@0.17.1

## 0.17.0

### Minor Changes

- [`3de508a`](https://github.com/zwykstudio/flatkit/commit/3de508a13fd44e39a2f92c7f0b60d1886928d097) Thanks [@kaelhem](https://github.com/kaelhem)! - States no longer freeze nested timelines. A symbol's `states` block used to pin its whole subtree's frame, so any timeline nested inside a state (a sub-loop, an idle) froze. The pinned POSE frame is now decoupled from the playback CLOCK handed to children: a state pins the symbol's own pose while the timelines nested inside it keep playing. This lets a state host a running loop (e.g. a `marche`/`panique` cycle selector) or an idle that runs during a state — authored entirely in keyframes, no `expr` scripting. Looping is opt-in: a frozen pose with no nested loop stays frozen, so existing state assets render unchanged.

### Patch Changes

- Updated dependencies [[`3de508a`](https://github.com/zwykstudio/flatkit/commit/3de508a13fd44e39a2f92c7f0b60d1886928d097)]:
  - @flatkit/types@0.17.0
  - @flatkit/engine@0.17.0

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
