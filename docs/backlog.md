# Backlog — pending requests from the EDU production pipeline

> Carried over from the pre-split feedback channel. Each item was hit in real production
> (an LLM pipeline generating educational activities). Ordered by impact. Items marked
> **[verify]** have documentation that claims one behavior while the last production test
> observed another — check which one is true before coding.

## Gestures

1. ~~**`link`: the verdict is written AFTER `when released`.**~~ — **DONE (2026-06-11)**:
   `resolveLink` now runs BEFORE `fireEvent('release')` in `onPointerUp`, so a `when released`
   handler reads the resolved `<target>`/end position directly (consistent with `drag`). Test:
   `playerDrag.test.ts` "a `when released` handler reads the RESOLVED target".
2. ~~**`link` with `enabled` = false still grabs the pointer.**~~ — **VERIFIED OK (2026-06-11)**,
   then **REOPENED and FIXED (2026-08-07)**: a disabled interactor is indeed not captured
   (`pickInteractor` filters on `enabled`), and a `when released` *handler* on the same object
   still firing IS intended — handlers are independent of the interactor's `enabled`. But the
   2026-06-11 reading stopped one step short: because the verdict only ran when `dragActive` was
   set, the target-index variable **kept the last completed gesture's value**. A handler gated on
   `if target == 1 { … }` therefore re-ran on every further press, and an activity could finish
   with pairs it never connected. A gated-off (or canceled, or pointer-left) release now resolves
   the index to `0` — "no target reached". Position outputs are untouched (zeroing a `drag`'s vars
   would teleport the object). Test: `headless.test.ts` "a link gated OFF resolves to target 0".
3. ~~**[verify] `reveal`: coverage grid recreated on every grab.**~~ — **DONE (2026-06-11)**:
   ticked cells are now PERSISTED per target (`revealStates` map, reset on `load()`), so coverage
   accumulates across grabs (true monotonicity for several short strokes). Test:
   `playerDrag.test.ts` "coverage ACCUMULATES across separate grabs".
4. ~~**Semantic gestures for the new interactors.**~~ — **DONE (2026-06-11)**:
   `{ "type": "scratch", "target": "X" }` (the runtime boustrophedon-sweeps the reveal target's
   bbox at the interactor's brush spacing, bounded to `MAX_SWEEP`) and `{ "type": "connect",
   "source": "X", "target": "Y" }` (pulls a link wire and resolves the target index). Both in
   `headless.ts`/`player.ts` Gesture union, documented in `flatc --help`. Tests:
   `headless.test.ts` "scratch sweeps…" / "connect pulls a link wire…".

## Compiler / checker

5. ~~**[verify] `$()` / `def` inside `each` bodies: checker/runtime mismatch.**~~ —
   **DONE (2026-06-11)**: root cause was `expandEachHandlers` substituting the loop index but
   never re-interpolating, so `$(col + i*gap)` survived into the Doc as literal text. The pass
   now resolves each instance's body with `{...defs, [binder]: k}` before substituting the bare
   index, so the `$()` is gone for BOTH `--check` and `--play`. Test: `flatFormat.test.ts`
   "$(def + i*gap) in the body is resolved per instance". (No reported-position fix needed — the
   error no longer occurs.)
6. **No compile-time loop over ZONES inside an `each` body** (`when dropped on Slot$(k)` and
   nested `each` are not possible): N items × M zones still needs M hand-written drop
   handlers. Acceptable at small M; revisit if a large N×M case shows up.
7. **Layout lint, one more rule**: warn when an interactor's grabbable shape is smaller than
   its visual affordance marker (e.g. a dashed zone larger than the actual hit shape) —
   a real usability bug found in production (pointer-down on the marker's corner missed).
   **DEFERRED (2026-06-11)**: the model has no explicit "marker" concept distinct from the hit
   shape (the hittable shape IS the item bbox), so any rule today would be a noisy heuristic.
   Needs a first-class marker/affordance field before a low-false-positive lint is worth shipping.

## Rendering / tooling

8. ~~**`--render --steps N`**~~ — **DONE (2026-06-11)**: `flatc --render … --steps N` runs N fixed
   sim steps (`stepSim`, every-frame at 60 Hz) after applying `--at`/`--frame`, before capture, so a
   stateful act unfolds without forcing every derived variable by hand. N is clamped to
   `MAX_RENDER_STEPS = 10_000` (anti-DoS; each step bounded by `MAX_ACTIONS_PER_TICK`). Tests:
   `flatc.test.ts` "--render --steps" + `playerDrag.test.ts` "stepSim(N)".
9. ~~**npm packaging of `skia-canvas`**~~ — **DONE (2026-06-11)**: `skia-canvas` is now an
   **optional peerDependency** of `@flatkit/compiler` (light default install; `--render`
   users opt in with `npm i -D skia-canvas`). The workspace keeps it as a root devDependency
   with its build script allowed (`pnpm.onlyBuiltDependencies`). The `--render` error message
   now walks through npm/yarn, the pnpm build-script approval, and the manual prebuild
   fallback. README Install section documents it.
12. ~~**Text on a path (`text … along "<id>"`)**~~ — **DONE (2026-06-18)**: curved banners/ribbons/arcs
    (EDU friction W). Full RFC implemented across all 3 phases — `along "<id>"` / `along path "<d>"`
    (inline), `start` / `align` / `side over|under` / `spacing`, animated `start`/`spacing` (marquee /
    eased tracking), `--check` overflow warning, and shape `as "<id>"` naming. Shipped on branch
    `curved-text`. Full design in [`rfc-text-on-path.md`](./rfc-text-on-path.md).

## Authoring ergonomics (the biggest token/time lever for LLM generation)

10. ~~**Feedback mixins / stdlib**~~ — **DONE (2026-06-11)**, hybrid:
    (A) the player now exposes per-object interaction state to channel expressions as
    `self.hovered`/`self.grabbed`/`self.pressed` (0/1), tracked handler-independently;
    (B) a `feedback` stdlib package (`lift`/`dim`/`tilt`/`sink`/`shake`); (C) a `feedback <tokens>`
    DSL sugar (`lift tilt dim shake(<expr>)`) that unfolds into composed channel bindings. One line
    per element. Settle-bounce deferred (needs a release timestamp → not stateless). Tests:
    `cel.test.ts`, `playerFeedback.test.ts`, `stdlib.test.ts`, `flatFormat.test.ts` (feedback sugar).
    *(2026-08-07: the sugar no longer injects a `use "feedback"` LINE — the package is auto-imported
    from the calls themselves, and the expansion is line-preserving so it cannot shift diagnostics.)*

## Packaging

11. **Browser-ready build of `@flatkit/player`** — the published `dist/index.js` uses bare
    cross-package imports (`@flatkit/engine/cel`, `@flatkit/types`, chunk splits), so a browser
    cannot load it directly: every consumer who embeds the player in a plain `<script
    type="module">` or a static site must run a bundler first (flatink-edu ships a 16ms esbuild
    `build-vendor` step for exactly this). Since the player is meant to be embedded in
    third-party pages, ship an additional **self-contained browser bundle** (e.g.
    `@flatkit/player/browser` → one ESM/IIFE file with engine+types inlined, zero bare imports).
    Then consumers `cp` it instead of bundling. Low effort (an extra esbuild target in the
    player's own build), removes a real friction for the primary use case.

## Moiki integration — silent traps (2026-08-07)

Reported after writing two activity generators (`arrange`, `connect`) against 0.21. All nine points
were real; two were worse than reported. **All shipped in the same batch** — recorded here because the
class of bug matters more than the individual fixes: *the program compiled, `--check` passed, and the
behavior was simply absent*. Nothing on screen and nothing in the tooling could say so.

13. ~~**`object "X"` silently ignored when X is not poseable.**~~ — **DONE**: only a
    group/instance/text/image carries a pose, so a block naming a SHAPE or a LAYER had its channel
    bindings dropped AND its handlers pointed at a dangling `@name` target no hit-test resolves. Now a
    compile error naming what was actually hit (`objectTargetDiagnostics`). The reporters' four
    generators all had this on their end-of-game veil, which never displayed once.
14. ~~**`pulse`/`shake` computed on `time`, which wraps.**~~ — **DONE**: both ride the monotone `clock`
    now. The existing `time`-wraps warning only grepped the channel TEXT, so it said nothing at all when
    the wrapping clock sat inside the callee — it now follows `time` through functions and names them.
    MIGRATION: capture instants with `clock`.
15. ~~**`--check` line:col pointed into a program the author never wrote.**~~ — **DONE**: `lintDoc` linted
    the text rebuilt from the Doc (no `scene { … }` block), so every position was offset by that block's
    height and every scope read `scene`. Pass the source (`lintDoc(doc, src)`) → exact lines and real
    `object "X"` scopes. The editor keeps the rebuilt-text path, where that text IS the file.
16. ~~**A PROGRAM saved as `.flat` passed `--check` vacuously.**~~ — **DONE**: refused now. The danger
    was tooling-shaped: a check written against the wrong extension ALWAYS passed and looked like a net.
17. ~~**Calling a package function required a `use` the sugar happened to write.**~~ — **DONE**:
    auto-import on call. A generator emitting `feedback` per element broke at the exact moment its last
    element was removed.
18. ~~**Error messages that did not state the rule.**~~ — **DONE**: a swallowed non-assignment statement
    (`… send "x", 1`) and a misplaced `as` both name the rule now, instead of `unexpected character """`
    and `"layer" expected`.
19. ~~**`flatc` loaded every `.flat` in the folder, and never named the culprit.**~~ — **DONE**:
    `--no-libs`, plus the offending file's name in the error.
20. ~~**No idiom for drawing a `link`'s thread.**~~ — **DONE**: documented in
    [behavior-and-interactions](./behavior-and-interactions.md#drawing-the-thread-of-a-link) (rotate +
    stretch a bar of known length). The example is compiled and replayed, not sketched.
