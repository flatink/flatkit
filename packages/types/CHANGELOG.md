# @flatkit/types

## 0.31.0

### Minor Changes

- [`dd832fe`](https://github.com/flatink/flatkit/commit/dd832fe9aa6b0edd62ab58d9e76bba46081dde8e) Thanks [@kaelhem](https://github.com/kaelhem)! - The compiler's root entry no longer drags the CLI into a browser bundle.

  **Breaking, in one symbol: `run` is no longer exported from `@flatkit/compiler`.** It is the CLI entry
  point, it lives in a module that imports `fs`/`path` at the top, and re-exporting it put Node builtins in
  the root's chunk graph. Importing ANY symbol from the root then failed a browser build at NAME RESOLUTION
  (`"extname" is not exported by "__vite-browser-external"`) -- before tree-shaking could drop the unused
  `run`, and marking the package external does not help when the code is really in the graph.

  The README promised the opposite ("the player stays tiny and never pulls it in"). It held for
  `@flatkit/player`; it did not for anyone needing a helper only the root exported -- `languageCard`,
  `drawingCard`, `docToManifest`, the three functions whose entire job is to describe the language to a model
  in a service or a browser.

  `flatc` is unaffected: the CLI ships as a `bin`, which imports `./cli/flatc` directly. If you imported
  `run` as a library, import it from the source/dist path or shell out to the binary.

  Guarded, not promised: `check-pack` now walks the built chunk graph of `@flatkit/compiler`'s `.`,
  `./analysis` and `./compile` (and `@flatkit/sugarflat`'s root) and fails the release if any Node builtin is
  reachable from them.

## 0.30.2

### Patch Changes

- [`9371b38`](https://github.com/flatink/flatkit/commit/9371b387b67b6f26dc4058bcd366dd3125013506) Thanks [@kaelhem](https://github.com/kaelhem)! - Quality pass on `--fix`: one write, or none, and a position it cannot trust is skipped.

  `--fix` writes to the AUTHOR'S file, so its failure modes matter more than its happy path. Three things
  found reviewing it:

  - It rewrote the file even when it had repaired NOTHING. Identical bytes, but a fresh mtime -- which wakes
    every watcher pointed at the folder, and fails outright on a read-only checkout it had no reason to
    touch. It now leaves such a file alone.
  - It wrote each pass and reverted on failure, so the author's file transiently held a version already
    known to be unwanted -- and a process killed in that window left it there. The iteration is now
    `repairLoop`, a PURE function with no filesystem in it; the CLI writes once, at the end, a text the loop
    has already re-checked. The same is true of a source that does not parse at all, repaired in memory
    instead of one write per syntax error.
  - `applyFixes` is public, so the diagnostics it is handed may be stored, replayed against a file that moved
    on, or built by a consumer. A non-positive column reached `slice` as an offset FROM THE END and silently
    truncated the line. Positions it cannot honour are now skipped.

  `repairLoop` is exported: it is the loop worth not re-writing, including the part that is easy to get
  wrong -- the error count RISES on the first pass of a source that did not parse, so the stopping condition
  is "nothing applied", never "the count stopped dropping".

## 0.30.1

### Patch Changes

- [`85781eb`](https://github.com/flatink/flatkit/commit/85781eb40378d4d7413f291e46ea7c0773b66866) Thanks [@kaelhem](https://github.com/kaelhem)! - Three layout false positives, measured on a 174-file corpus: 53 warnings -> 22.

  Reported from the deckgen decks, where NONE of the 53 warnings matched a defect visible on screen. A
  warning nobody believes is worse than no warning, and all three causes were ours -- each was measuring a
  DECLARATION instead of what gets drawn.

  **A `box` is a layout frame, not ink** (36 -> 10). `text "Accepter" align center box 780 40` is eight
  glyphs in the middle of 780 px, and the clipped-at-the-edge pass measured the box: every centred text with
  a comfortable box tripped it. It now measures the estimated ink, positioned by `align`. A WRAPPED text
  keeps its box, where the ink really can fill the width.

  **A container inherits its children's motion** (the last one standing). A group whose own position is
  static but that CONTAINS an item a binding moves has no meaningful static bbox: its bounds are the union
  of its children, measured where they are parked rather than where they play. The `dynamic` flag was
  inherited downward and never upward, which is the other half of the same fact.

  **One line of slack on the wrapped-height warning** (7 -> 3). The estimator has no canvas: it wraps on a
  mean glyph advance, breaks early, and lands one line long -- measured against skia on five decks.

  And an ergonomic fix that came with them: `— add "wrap"` is advice that cannot be followed for a single
  word, since `wrap` breaks at spaces and nowhere else. A giant single word bleeding off frame is a
  deliberate gesture in every corpus measured; the message now says so instead of prescribing.

## 0.30.0

### Minor Changes

- [`ba7878a`](https://github.com/flatink/flatkit/commit/ba7878a9f2117268f44549a254b9202957a83cf9) Thanks [@kaelhem](https://github.com/kaelhem)! - Diagnostics carry their repair, and `flatc --fix` applies it.

  Some errors have exactly ONE possible repair -- a separator the author left out -- and the parser already
  computed it in order to print it in the message. That information was thrown away in a string. It is now a
  `fix` on the diagnostic: a `TextEdit` replacing a range, present only when the repair is the single
  possible reading of the text.

  Four slips today, all a missing separator: `at 12 -16` (the comma), `#` used as a comment (`//`, and only
  when the rest of the line holds no brace -- otherwise it would comment out the closing one), two
  statements on one line, and a run-on interactor block. Anything needing a DECISION -- an unknown event
  name, a `when <condition>`, a binding at the program level that must name its object -- is reported and
  left alone.

  `flatc --fix` iterates (repairing one error unmasks the next: a run-on interactor line swallows the
  statements under it) and writes only if the error count strictly drops, reverting otherwise. It also runs
  when the source does not parse AT ALL, which is where a mechanical repair earns its keep.

  `applyFixes(src, diagnostics)` is exported so the same repairs apply in a service, with no subprocess: a
  missing comma should not cost a whole regeneration.

  Along the way the flat parser gained POSITIONS. Every syntax error used to be reported at 1:1 -- accurate
  about the token, useless about where to look. `FlatSyntaxError` carries line, column, and sometimes the
  fix.

## 0.29.2

### Patch Changes

- [`307c60e`](https://github.com/flatink/flatkit/commit/307c60e34ab9022981ffc7f533bf87ba4f790364) Thanks [@kaelhem](https://github.com/kaelhem)! - Per-item constructs at the program level were dropped in silence too -- now an error.

  The mirror of the fix in 0.29.1. A `when clicked`, a channel binding (`opacity = 0.5`) or an interactor
  (`drag a, b`) written OUTSIDE any `object` block belongs to an item, and there is no item there:
  `unitsToTimeline` keeps only the scene-wide kinds and drops the rest. `--check` passed, and the only
  signal was a "never used" warning about the variable the dropped handler wrote -- which points at the
  wrong thing entirely. The message now names the construct and says to wrap it in `object "Name" { … }`.

- [`6bb9674`](https://github.com/flatink/flatkit/commit/6bb9674e354a1b47b7590adc01e0280b63ffbc9f) Thanks [@kaelhem](https://github.com/kaelhem)! - `when <condition>` and `at x y` now name the rule they broke.

  Both come from a day of real use writing a rule-driven activity.

  `when biomasse > 55 { … }` is the reflex of anyone expressing a system, and FlatInk has no conditional
  `when`. Listing the accepted events left the author to infer that, and the line-level recovery then
  reported the body as two MORE errors. It now states the rule once, swallows the block, and gives the
  `every frame` + flag idiom -- guarded, because the block runs 60 times a second and an unguarded `send`
  fires sixty events. The idiom inside the message is parsed by a test, so it cannot teach a form the parser
  rejects.

  `at 12 -16` (a space where the comma goes, the reflex of anyone who has written SVG) said `"," expected,
"-16" found` -- accurate about the token, silent about `at`. It now shows both spellings.

  The guide gains the paragraph, and the three references the one-liner.

- [`9f6eba5`](https://github.com/flatink/flatkit/commit/9f6eba54be796ee24a6eb83b15a7b113176724cc) Thanks [@kaelhem](https://github.com/kaelhem)! - The `link` thread idiom is in the prompts, as a program that compiles.

  `link` returns the end point and the target index; it does NOT draw the thread, and nobody writes anything
  but `rotation = angle(...)` / `scaleX = dist(...) / <drawn length>`. Those two lines were in the guide and
  in none of the six embedded prompts -- so every integrator rediscovered them. `flatink-core` and
  `role-coder` now carry a complete worked program (compiled by `prompts.test.ts`), and `flatink-lite` the
  two lines.

## 0.29.1

### Patch Changes

- [`83bea35`](https://github.com/flatink/flatkit/commit/83bea35551dd84ab48cba834df815502a9766664) Thanks [@kaelhem](https://github.com/kaelhem)! - Interactor options are one per LINE, and the error now says so.

  `dragX cx { confine to Rail  snap 26 }` on a single line failed with `end of line expected` at a column,
  which names nothing. Four reference listings (flatink-core, flatink-lite, role-coder, behavior-and-interactions)
  separated the options with a decorative middle dot, so that is exactly what a reader -- or a model prompted
  with them -- writes. The listings now show the one-per-line form, and a run-on line names the rule.

- [`8f9837e`](https://github.com/flatink/flatkit/commit/8f9837ee38755d4e1cf1836f021d3089a115b710) Thanks [@kaelhem](https://github.com/kaelhem)! - Scene-wide constructs inside an `object` block were dropped in silence -- now an error.

  `object "X" { when loaded { … } }` compiled clean and did nothing: `unitsToObject` keeps the per-item
  events and drops `load`, `enterFrame`, `at frame`, `label`, `each`, `use`, `fn` and `let` on the floor.
  The parser made it worse -- its unknown-event message lists `loaded` among the events an object block
  accepts. `when loaded` is the costly one: drawing a hidden value ONCE at start (`secret = floor(random() *
3)`) is what every guess-the-rule activity is built on, and it was a no-op with nothing on screen to say
  so. `--check` now names the construct and says to move it to the top level.

## 0.29.0

### Minor Changes

- [`96c4f4e`](https://github.com/flatink/flatkit/commit/96c4f4e2d4871ed398e5551bd13e423ec8ce93e3) Thanks [@kaelhem](https://github.com/kaelhem)! - Cels are not symbol-only, and nothing said so.

  A layer inside a program's `scene { ... }` takes cels, riding the program's own timeline - keyframes with
  easing, fractional frames, composing with `dx`/`dy` bindings. It has always worked. But every example in
  every doc and every prompt wraps them in a `symbol`, and two of the prompts said "(in a symbol)" in the
  heading.

  Measured consequence: a deck generator concluded they were unavailable and hand-compiles every entrance
  as `clamp((time - t0) / dur, 0, 1)`, per channel, per element - 3330 occurrences across 40 decks, 139 in
  a single 783-line file. A keyframe engine, retyped in arithmetic, because the reference implied the real
  one was out of reach.

  - The animation guide is retitled and carries a worked program-scene example: three staggered entrances
    with `hold`, plus an ambient binding riding on top.
  - The prompts say it, and their example compiles like the rest.
  - **New warning**: an item posed at one cel, absent from the next, then posed again LATER blinked out and
    back. A cel is a full snapshot, so that is the model working - and a FINAL absence is how an exit is
    written, which stays silent. But a staggered entrance needs `hold` on every cel, and forgetting it made
    elements vanish mid-run with nothing to say so.

## 0.28.0

### Minor Changes

- [`1d72dd7`](https://github.com/flatink/flatkit/commit/1d72dd7f0ee3bda7222209d80f142b2087654912) Thanks [@kaelhem](https://github.com/kaelhem)! - Two `object "X"` blocks MERGE their bindings instead of one replacing the other.

  Reported from a generated activity: the pieces stopped following the finger during a drag. Two blocks
  targeted the same item - the one carrying `drag` with its `x`/`y` bindings, and a second adding a wobble -
  and the second REPLACED the first's expressions wholesale. The interactor still wrote the variables,
  nothing read them any more, and `--check` reported a clean program.

  Handlers from several blocks already accumulated, so the same construct behaved two ways for its two
  halves. Now both merge, later block wins per CHANNEL.

  Binding the SAME channel from two blocks is still a loss, so it warns and points at the additive `dx`/`dy`
  as the way to add motion without replacing a position. Different channels merge silently - that is the
  normal way a skin adds life to something the rules already move.

  ⚠️ This CHANGES BEHAVIOUR for any program that already had duplicate blocks: bindings that were being
  dropped now apply. Measured on a 58-activity corpus: 6 such collisions, in 3 activities, every one of
  them a binding nobody could see was dead.

## 0.27.0

### Minor Changes

- [`7b14d89`](https://github.com/flatink/flatkit/commit/7b14d894b8e101a411851811b129950488602d93) Thanks [@kaelhem](https://github.com/kaelhem)! - Quick wins from surveying three consumer repos.

  Every consumer that needed more than ONE image had reimplemented headless rendering on top of the
  player: four harnesses across two neighbouring repos, ~430 lines, each rediscovering the same DOM shims,
  plus a third repo shelling out to `flatc --render` with a binary to locate and a temp dir per render.

  - **New `createRenderer(doc)`** - a renderer held open, `frame(n)` as many times as you like, `close()`
    when done. The setup (the `skia-canvas` import, writing and registering the embedded fonts, decoding
    every image asset, building the player, installing ten globals) is paid once instead of per frame.
    `renderDocToPng` is now the one-shot form of it.
  - **`--set` works on `--render`**, not just `--preview`, and `createRenderer`/`renderDocToPng` take
    `params`. Setting a symbol's state or colour before rendering a PROGRAM was impossible - only document
    `var`s could be overridden - which is precisely why one of those harnesses exists.
  - **The player warns when an effect is dropped for lack of an off-screen canvas.** Without a `document`
    there is no isolation, so `filter`, `tint` and `mask` fall back to a direct draw: it compiles, it
    renders, the effect is simply gone. A consumer documented this in their own source, in capitals, after
    losing time to it. Once per process, and it names the shim.
  - **The language guides ship in the package** (`docs/*`, exported as `./docs/*`). They were repo-only, so
    a consumer who wanted the gotchas beside their generator copied the file - measured: a 423-line copy
    that has already drifted. Same disease as the prompts, same cure; `/docs` stays the single source and
    the copy is generated at build time.

## 0.26.0

### Minor Changes

- [`3d3e34b`](https://github.com/flatink/flatkit/commit/3d3e34b9b37e59068992d422924d112c573ce832) Thanks [@kaelhem](https://github.com/kaelhem)! - Close the open integration reports: the prompts were shipping programs that do not compile.

  - **All three complete programs in the shipped prompts were rejected by the compiler they document.**
    An `as` written after the style, `#` used as a comment inside `scene`, and an `object` on a bare shape
    that 0.23 had turned into a hard error. These files are exactly what an integrator hands a model, so
    the error rate they cause is paid at the far end. Fixed, and a test now compiles every complete program
    in `prompts/` - `drawingCard()` had that test from the day it was written; these files shipped without.
  - **`#` is not a comment.** It opens a COLOUR, survives the header half of a program and breaks inside
    `scene` on a message about layers that points nowhere near it. The prompts now use `//` throughout and
    say so, and the parser names the character instead of the statement it displaced.
  - **A missing `scene { ... }` said the cause once instead of the symptom N times.** Composition at the root
    produced one error per line - measured at 72 on a 75-line file, with not one of them containing the
    word `scene` - so the repair pass fed those errors returned the same program. It cannot infer a cause
    from seventy-two symptoms.
  - **`--no-libs` is honoured by `--render` and `--play`.** It was parsed and then not passed on, so a
    render still auto-discovered a broken neighbour and failed advising the flag that had been given.
  - **New: a warning when an item is drawn ENTIRELY off-canvas.** The clipped-at-the-edge pass tolerates
    straddling and only ever looked at text and images; a shape or a group wholly outside the canvas was
    silent. Items parked off the top-left corner on purpose (`at -999,-999`) and hairlines lying along an
    edge are left alone - measured against a 58-activity corpus to keep it quiet.
  - **New: a warning when `--frame` is past the timeline.** The playhead wraps, so a render could answer
    frame 20 to a request for frame 200 and be read as a renderer bug. It was, once.
  - **`renderDocToPng` and the prompt files are reachable**: new `./render` and `./prompts/*` subpaths.
    Rendering no longer requires spawning `flatc` - a binary to locate, a temp dir per render, a timeout.

## 0.25.0

### Minor Changes

- [`c60b730`](https://github.com/flatink/flatkit/commit/c60b7302466c7643824335a28b0f9c1743cc3604) Thanks [@kaelhem](https://github.com/kaelhem)! - Warn when a program never declares `size`.

  The line is REQUIRED by the format, and the compiler silently defaulted it to 800x600 - so a document
  laid out for one canvas was drawn on another, with everything past the edge clipped away and nothing to
  say so. Measured cost of that silence: a generator omitted the line across its entire corpus for months,
  undetected. A warning rather than an error, because checking a fragment on its own is legitimate.

## 0.24.0

### Minor Changes

- [`79faa20`](https://github.com/flatink/flatkit/commit/79faa206f6180540615b007b2880aec0c8c5a373) Thanks [@kaelhem](https://github.com/kaelhem)! - Close the frictions found integrating 0.23, and answer the sugar-layer RFC.

  - **`--check` catches the silent `time` -> `pulse` trap.** `pulse`/`shake` ride the monotone `clock`, so
    an instant captured with the pre-0.23 idiom (`doneAt = time`) is compared against an axis it never
    shares: the ramp never fires, and nothing on screen or at `--check` said so. The link is static and is
    now named, whatever the timeline length. Touches every codebase migrated from 0.21.
  - **New `checkProgram(src)`** - the whole `--check` pass as a function, source in, diagnostics out, no
    subprocess. The compiled Doc cannot express two error classes (a text that is not FlatInk compiles to an
    empty Doc; an `object` block that binds to nothing leaves no trace), so the API used to return a weaker
    verdict than the CLI on the same file. The CLI now calls the same function, so they cannot drift.
  - **New `drawingCard()`** beside `languageCard()` - the composition half of the reference (shapes, paints,
    filters, text, clipping, and the word order that breaks most often), which the behavior card never
    covered. Its examples are compiled by a test, so a copied reference cannot drift. `llmContext(doc)` now
    includes it; pass `{ drawing: false }` to opt out.
  - **The agent prompts ship in the package** (`prompts/`): a full language reference, a condensed one, and
    one file per role (asset creator, motion designer, coder). They were gitignored and absent from the
    tarball, which forced integrators to copy the grammar by hand.
  - **Layout warnings descend into groups** and measure in world coordinates - most of a real scene lives
    inside a group, and none of it was checked before. Wrapped text is now measured too (more lines than the
    box is tall, or a word too wide to break), and anything positioned at runtime is skipped, along with
    everything nested under it.
  - **The manifest carries the binding contract**: per object, the events the logic handles, whether it is
    dragged or a drop zone, the channels the logic drives, and the state it reads (parsed, not grepped);
    plus `manifestEvents(doc)` for what the program emits. No coordinates cross that boundary, so a second
    skin can honour the same logic with a different composition.
  - **A stroke option written out of order names the rule**: `stroke [#888](https://github.com/flatink/flatkit/issues/888) 2 nofill dash 6,5` reported
    `"layer" expected, "dash" found`, which reads as if `dash` did not exist. It now says that
    `cap`/`join`/`miter`/`dash` belong to the stroke and must follow it directly.
  - **An `instance` resolving to no symbol is no longer silent.** The unresolved marker travelled all the
    way into the `.flatpack`, the instance drew nothing, and `--check` said `check passed`. Measured on a
    real corpus: 96 such references across 14 of 58 activities passed as green. Now a warning that names the
    missing symbols - a warning, not an error, because compiling a program on its own and supplying its
    libraries later is a legitimate workflow.
  - **Every published subpath answers `require` as well as `import`.** They pointed only at `import`, so
    `require("@flatkit/compiler/compile")` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` - a message claiming
    the subpath is not defined by `exports` when it plainly is. The condition points at the SAME ESM file:
    no CJS build, so no dual-package hazard (one file, one module instance), and Node >= 24 (this package's
    floor) requires ESM natively. `check:pack` now fails if a subpath loses its `require`.

## 0.23.0

### Minor Changes

- [`f4bb7b1`](https://github.com/flatink/flatkit/commit/f4bb7b1de799f0a6248cb600ceab255ce9028a75) Thanks [@kaelhem](https://github.com/kaelhem)! - Close the silent traps found while writing activity generators against 0.21 (moiki integration).

  Four of these let a program compile clean, pass `--check`, and still not do what it says.

  **`object "X"` that binds to nothing is now a compile ERROR.** Only a group/instance/text/image carries a
  pose, so a block naming a SHAPE (`rect ... as "Eclat"`) or a LAYER was dropped in total silence: the
  channel bindings vanished and the handlers got a dangling target no hit-test ever resolved. The message
  names what was actually hit and how to fix it (wrap the shape in a group).

  **`pulse` and `shake` now ride the monotone `clock`, not `time`.** `time` resets every `durationFrames`
  (2.5 s by default), so a one-shot end-of-game `pulse` replayed for ever and a refusal wobble skipped on
  every loop. MIGRATION: capture instants with `clock` -- `when wrong { shown = clock }`, not `= time`. The
  existing `time`-wraps warning also follows `time` THROUGH a function now, and names it: it only grepped
  the channel text before, so it said nothing at all in exactly the case that cost the most.

  **A `link` gated off by `{ enabled ... }` resolves its target index to 0.** `enabled` gates the GESTURE,
  not the handlers: `when released` keeps firing, and the index used to keep the last resolved value, so a
  handler could count the same pair again on every further press. Documented alongside, since guarding the
  handler body is still the author's job for every other output.

  **A PROGRAM saved as `.flat` is refused instead of vacuously passing.** A `.flat` is read as a bag of
  symbols, so a whole program under that name reported "0 symbol(s)" and exit 0 with nothing verified -- a
  check written against the wrong extension always passed and looked like a safety net.

  Diagnostics now point INTO the source file. `--check` on a `.flatink` reported line:col from a program
  rebuilt out of the Doc (no `scene { ... }` block), so every position was off by that block's height and
  every scope read `scene`. An error on line 13 was reported on line 4. The `feedback` sugar is
  line-preserving now too, so it no longer shifts what follows it.

  Also:

  - Calling a stdlib function auto-imports its package. `pulse(...)` needed a `use "feedback"` that only the
    `feedback` sugar wrote, so a generator that emits `feedback` per element broke at the exact moment its
    last element was removed. An explicit `use` still works, and your own `fn` of the same name still wins.
  - `--no-libs` skips the auto-discovery of the `.flat` files next to the program, and a lib that fails to
    parse is now NAMED (it is often a neighbour the author never mentioned).
  - A swallowed non-assignment statement (`score = score + 1  send "correct", 1`) says "two statements on one
    line" and names what it swallowed, instead of `unexpected character """`.
  - A misplaced `as` (`rect ... fill #fff as "N"`) states the ordering rule instead of `"layer" expected`.
  - Docs: the idiom for drawing a `link` thread (rotate + stretch a bar of known length), what `enabled` does
    and does not gate, and that opacities multiply (an `opacity 0` shape cancels its group's animation).
  - Docs, two pre-existing defects found while writing the above and fixed: the index page's headline example
    drove an `object "Star"` that named a bare `circle` -- it demonstrated the very bug above, and would now
    be a compile error; and every runnable example annotated with `#` could not be pasted, since `#` starts a
    COLOR and only `//` opens a comment. All 14 complete examples across the docs are now compiled as part of
    checking this change, and the comment rule is written down.

## 0.22.0

## 0.21.0

### Minor Changes

- [`f0dac30`](https://github.com/flatink/flatkit/commit/f0dac3024b76c5e894fc7b720301e24f021ba1c3) Thanks [@kaelhem](https://github.com/kaelhem)! - `send` record payload + keyboard fix (host integration)

  - **`send "event", { a = expr, b }`** — a fourth payload form carrying several NAMED numbers in one
    event (a state patch), instead of one positional value. `{ b }` is shorthand for `{ b = b }`. The
    host receives them on a new `fields` key: `onEvent({ name, value?, fields? })`.
    Bounded and vetted at both ends: at most 32 fields, identifier-shaped names, never `__proto__` /
    `constructor` / `prototype`, values coerced to finite numbers (NaN -> 0). A malformed or duplicate
    field name is a parse error; a hand-written `.flatpack` that bypasses the parser has its
    non-conforming fields dropped by the runtime.
  - **Fix: `keys.<Key>` always read 0.** The `keys` object is a Proxy over the held-keys set, but the
    expression sandbox resolves members with `Object.hasOwn` (own properties only), which a get-trap-only
    Proxy always answers false -> every key read collapsed to NaN -> 0. Keyboard input in expressions
    (`if keys.Space`, `x = x + keys.ArrowRight * 4`) now works.
  - **The keyboard now behaves inside a host page.** The listeners stay global (no click-to-focus), but a
    keystroke aimed at a host `<input>`/`<textarea>`/`<select>`/`contenteditable` is ignored by the scene;
    `preventDefault` is applied ONLY to the keys the document declares via `keys.<Name>` (mirroring the
    existing `mouse.wheel` rule), never to a `Ctrl`/`Cmd`/`Alt` combination, `Tab` or a function key; and
    losing the window releases the held keys (alt-tab delivers no `keyup`).
  - **`player.setKey(name, down)`** drives a key programmatically — for an on-screen D-pad (no keyboard on
    a phone) and for headless replay.
  - **New `key` gesture** in the headless scripts: `{ "type": "key", "name": "ArrowRight", "frames": 10 }`
    holds a key for N simulation steps then releases it, so a keyboard-driven scene is testable in CI
    (`flatc --play`). Key presses are still not captured by `--record`.
  - `@flatkit/player` now exports the **`SendEvent`** type, so a host can type its `onEvent` callback
    without restating the shape.
  - `flatc --play --trace` prints record payloads as `event{a=1, b=2}`.
  - New guide: **docs/host-integration.md** — receiving `send` events, driving state variables from the
    page, keyboard caveats, teardown and the security contract.

## 0.20.2

## 0.20.1

### Patch Changes

- [`2352dee`](https://github.com/flatink/flatkit/commit/2352dee487d5ad72b4b269ede51f6212194d6e08) Thanks [@kaelhem](https://github.com/kaelhem)! - fix(player): cache filtered composites of moving/tinted statics; treat stateful modifiers as non-static

  The filtered/tinted composite cache now keys on the item's own RESOLVED pose, not just the screen
  transform, via a new `isContentStatic` check that ignores the item's own channel drivers (they only
  move/scale/fade it) while still requiring its CONTENT subtree to be static. A tinted or filtered
  instance driven by a channel expression -- e.g. `each`-bound bricks -- reuses its baked composite
  whenever its pose holds still, instead of re-isolating off-screen every frame. Its own pose is folded
  into the cache signature (an expression-driven move busts the cache; a momentarily-still pose keeps
  HITting), and `opacity` is applied at blit so a pure fade reuses the bitmap.

  Also fixes a latent staleness bug: a subtree carrying a stateful modifier (`smooth`/`spring`) but no
  expression was wrongly treated as render-static, so a child's spring would freeze inside a cached
  composite. Modifiers now mark a subtree non-static (zero cost for scenes that use none). And the
  per-frame `cssFilterString` is computed once per filtered item instead of twice on the bake path.

  No DSL or API change; scenes without tint/filters are unaffected.

## 0.20.0

### Minor Changes

- [`fb31814`](https://github.com/flatink/flatkit/commit/fb31814f34ad26f45e0a5c7780f5baecc7ddabed) Thanks [@kaelhem](https://github.com/kaelhem)! - feat: additive position offsets `dx`/`dy` (`pos = at + (dx, dy)`)

  New binding-only channels `dx` and `dy` shift an object's resolved position in parent space,
  on top of its declared `at X,Y` (and any absolute `x`/`y` channel). The natural offset idiom
  `object "G" { dx = 30*sin(time) }` now oscillates AROUND the anchor instead of deserting to the
  origin -- no need to re-inject the base (`x = 620 + ...`). Absolute `x`/`y` still REPLACE `at`
  (unchanged); `dx`/`dy` add on top when both are bound (`pos = x + dx`). Offsets are stateless and
  binding-only: no keyframe, `spring`, or `smooth` form. Zero change for any scene that does not use
  them. Discoverable in the `flatc` manifest/language card and documented in dsl-gotchas /
  behavior-and-interactions.

## 0.19.12

### Patch Changes

- [`05e9ce9`](https://github.com/flatink/flatkit/commit/05e9ce9e91c1edbfef37cb123854bb6b1710e0fd) Thanks [@kaelhem](https://github.com/kaelhem)! - docs: each published package now ships a README, so its npm page is no longer blank -- a short pitch,
  install line, and a minimal usage snippet (player: FlatPlayer + loadEmbeddedFonts; compiler: flatc + the
  compileFlatpack programmatic entry; engine: the per-module subpath imports; types: typing a Doc). This
  release also publishes the package metadata that moved to the flatink GitHub org (the `repository` link on
  the npm page), which had only been committed, not yet published.

## 0.19.11

### Patch Changes

- [`d257d17`](https://github.com/flatink/flatkit/commit/d257d172db96c10659b19a9d0e66f086f917fd7b) Thanks [@kaelhem](https://github.com/kaelhem)! - compiler: a `font` asset declared without an explicit family (`asset "Archivo" "a.woff2" font`) now bakes
  an explicit `family` equal to its declared id. That id is exactly what the text targets via `font "<id>"`,
  so registration is now consistent everywhere instead of relying on a `family || id` fallback:

  - browser (`loadEmbeddedFonts`) already used `family || id`, so no behavior change there;
  - headless (`flatc --render` / skia `FontLibrary`) previously fell back to the font FILE's intrinsic
    name-table family when no alias was set, which only matched `font "<id>"` when the file's own name
    happened to equal the id. Forcing `family = id` makes headless text resolve to the authored face
    regardless of what the file's name table says.

  An explicit family alias (`asset "slug" "a.woff2" font "Real Family"`) is preserved untouched.

## 0.19.10

### Patch Changes

- [`01b2d05`](https://github.com/flatink/flatkit/commit/01b2d05f70187043b6218cb4ef80ab18accd5c7e) Thanks [@kaelhem](https://github.com/kaelhem)! - player: `loadEmbeddedFonts(doc)` -- register a doc's embedded fonts in the browser before mounting, so text
  uses the AUTHORED faces instead of a system fallback. Previously every consumer reimplemented the same
  `FontFace` glue; now it ships as a tiny tree-shakeable export:

  import { FlatPlayer, loadEmbeddedFonts } from '@flatkit/player'
  await loadEmbeddedFonts(doc) // BEFORE new FlatPlayer
  const player = new FlatPlayer(canvas, doc)

  It registers each `asset kind:'font'` under `family || id`, no-ops outside a DOM (SSR / Node), skips a
  corrupt face (graceful fallback, never throws), and is idempotent across remounts (a family already on
  `document.fonts` is not re-registered).

  Security: only embedded `data:` URIs are honored, and the bytes are decoded and handed to `FontFace`
  directly -- `asset.data` is never spliced into a CSS `src` string. So an untrusted doc can neither point a
  face at a remote origin (no network fetch / SSRF) nor inject extra CSS `src` descriptors via
  `url()`/`local()`. This is the same "no arbitrary fetch" contract the player's image/audio paths enforce.

  Docs: new `docs/embedding-fonts.md` covers the browser helper and the skia/Node (`FontLibrary`) snippet.

## 0.19.9

### Patch Changes

- [`1911179`](https://github.com/flatink/flatkit/commit/19111798c155c2c9a2d479eeedd6c2046c16202c) Thanks [@kaelhem](https://github.com/kaelhem)! - `velocity()` in a modifier target: react to a value's MOVEMENT, not just its value. Inside a `spring`/`smooth`
  target, `velocity(x)` is the per-second rate of change of `x` -- 0 at rest, non-zero only while x moves -- so a
  pendulum on a moving pivot (a crane cable that swings when the trolley moves, then hangs vertical) needs no scene
  code:

  group "Suspente" spring rotation "rad(-velocity(crochetX) \* 40)" stiffness 0.06 damping 0.22 { ... }

  At rest velocity = 0 -> target 0 -> vertical automatically; on a scrub / --render it is also 0 -> snaps to rest
  (consistent with the random-access semantics). Composable in any target.

  Design (extends the stateful-modifier work): `velocity()` is NOT a pure stdlib function -- it is resolved by the
  player's stateful advance pass (the previous value lives in the binding's per-(instance, channel) state, one slot
  per velocity() occurrence), so expressions stay pure (expr.ts unchanged: velocity is injected into the eval
  context) and it is per-instance correct. Valid ONLY inside a modifier target; `flatc --check` knows it there and
  flags it as misuse elsewhere. Per-second delta (fixed 60 Hz step) -> deterministic, readable gains. Additive.

## 0.19.8

### Patch Changes

- [`7569c6b`](https://github.com/flatink/flatkit/commit/7569c6b1b406ad9a2b618fc1d89b9514580d6023) Thanks [@kaelhem](https://github.com/kaelhem)! - Scene-side authoring for stateful channel modifiers: a `.flatink` `object` block can now declare a
  `spring` / `smooth` channel, not just a `.flat` symbol. The target is an ordinary (unquoted) FlatInk
  expression; block form for the params:

  object "Hero" {
  spring rotation = crochetX { stiffness 0.08 damping 0.86 }
  smooth opacity = lit { k 0.18 }
  }

  For a one-off spring on a scene object when the feel is not baked into a `.flat` symbol. Front-end only --
  a new `modifier` DSL unit (parse, print round-trip, compile to the item's `modifiers`, `flatc --check`
  lints the target and slots); the runtime (engine resolution, player advance, per-instance state) is the
  same code that already drives the `.flat` form. `rotate`/`rotationDeg` sugar like the rest. Additive.

## 0.19.7

### Patch Changes

- [`a4f4b8d`](https://github.com/flatink/flatkit/commit/a4f4b8d468b8e92d87f87c1ca8980ecc9ecab480) Thanks [@kaelhem](https://github.com/kaelhem)! - Stateful channel modifiers (`spring` / `smooth`): a `.flat` symbol channel can now INTEGRATE over time
  toward a target instead of recomputing purely each frame, so an asset carries its own reactive "feel"
  (a crane cable that swings and settles, a needle that eases to its value) with no scene code.

  Authoring (on any poseable item in a `.flat`):
  group "Suspente" spring rotation "crochetX" stiffness 0.08 damping 0.86 { ... }
  group "Aiguille" smooth rotationDeg "valeur \* 270" k 0.18 { ... }

  The target is an ordinary expression; expressions stay pure (no hidden state) -- the modifier holds the
  state. State is per INSTANCE (two cranes swing independently, even when the spring is on a group inside the
  symbol). It advances at a fixed 60 Hz step, independent of onEnterFrame/input, so an asset animates with zero
  scene behavior; on random access (timeline scrub, --render, contact sheet) the channel snaps to its target
  (the rest pose). The integrator is bounded (params clamped) -- it cannot diverge. `flatc --check` lints the
  target expression (a typo surfaces as "unknown variable") and flags out-of-range spring damping. Purely
  additive: documents without modifiers are unchanged.

## 0.19.6

### Patch Changes

- [`e1b06e2`](https://github.com/flatink/flatkit/commit/e1b06e2cc328be30b932b5b3d725c068bde89eff) Thanks [@kaelhem](https://github.com/kaelhem)! - FlatInk now tolerates several statements on one line: `a = 1  b = 2` parses as two
  statements instead of erroring with "two statements on one line". The parser splits
  at the boundary of a second assignment/binding (the [#1](https://github.com/flatink/flatkit/issues/1) LLM footgun) in action bodies
  and channel bindings, so lint and compile both accept it. Single-expression slots
  (e.g. a `send` payload) still reject a stray `=`. The language card now states the
  one-statement-per-line rule explicitly to steer generators toward the canonical form.

## 0.19.5

### Patch Changes

- [`48d96ae`](https://github.com/flatink/flatkit/commit/48d96ae1ca00de5f05cad2f29a4cd9d290ea1983) Thanks [@kaelhem](https://github.com/kaelhem)! - `flatc --check` success message no longer contains the word "error".

  The success line was `flatc: no errors` -- which contains "errors", so a tool or agent that greps the output for "error" to detect a failure gets a false positive (it reads success as failure). The line is now `flatc: check passed` (and surfaces a `N warning(s)` count when there are non-blocking warnings). The real failure signal stays the exit code (non-zero on error); on a failure the per-line report still prints "error" to stderr, so grepping for "error" now matches only genuine failures.

## 0.19.4

### Patch Changes

- [`3481147`](https://github.com/flatink/flatkit/commit/34811472904012c35136957681d41c12ac5540d8) Thanks [@kaelhem](https://github.com/kaelhem)! - `flatc --check <library>.flat` now lints an asset library (per-symbol), instead of choking on it as a scene.

  `--check` always routed through the program parser, so a `.flat` lib (symbols/params/layers, not a scene) failed with a cascade of `[scene] unexpected statement "symbol"`; the only way to lint an asset was to compile a preview and call the API by hand. A `.flat` first positional is now detected (like `--preview` does) and parsed with `parseFlatLib`, its symbols merged into an empty-scene Doc, and run through the SAME `lintDoc`, so every existing check (params-in-`expr`, undeclared color param in a paint, unknown functions/objects) applies for free, with the identical `[scope] line:col: level: msg` format and exit code (non-zero on error, warnings non-blocking). Several `.flat` can be passed and are merged (`flatc a.flat b.flat --check`), and `--watch` works. The program path (`flatc x.flatink --check`, with `.flat` libs as args) is unchanged.

## 0.19.3

### Patch Changes

- [`1d13505`](https://github.com/flatink/flatkit/commit/1d13505b4e9c9354136fb188d493e23af24957bb) Thanks [@kaelhem](https://github.com/kaelhem)! - `flatc --check` now flags a `color` param used as a paint that the symbol doesn't declare.

  A gradient stop (`0:teinte@0.8`), a `tint <param> <amount>`, or a `fill`/`stroke <param>` that references an undeclared (or mistyped) color param silently falls back to the literal hex at render -- a "dead recolor": the asset looks fine but the picker does nothing. The lint now walks each symbol's paints and warns on a color-param reference the owning symbol doesn't declare, scoped to that symbol (a `teinte` declared in symbol A doesn't silence the same name in symbol B). Non-blocking (a warning), so it can only surface a latent bug, never break a build. Complements the earlier "the lint knows a symbol's params in its expr" fix.

## 0.19.2

### Patch Changes

- [`bcb9eed`](https://github.com/flatink/flatkit/commit/bcb9eede3f20ee4cc2bda52e788013289bafb711) Thanks [@kaelhem](https://github.com/kaelhem)! - Harden the renderer against a crafted gradient in an untrusted `.flatpack` (security pass).

  The player renders untrusted `.flatpack` JSON and `sanitizeDoc` does not validate paint stops, so a crafted gradient could CRASH the render: a stop `param: "__proto__"` made the per-instance color lookup return `Object.prototype`, which the color helpers (`splitAlpha`/`withAlpha`) then threw on; a non-string color or a non-finite `offset`/`alpha` (e.g. `offset: "x"` -> NaN) made `addColorStop` throw. `resolveColorRef` now uses an OWN string value only (a prototype hit or non-string falls back to the literal hex) and ignores a non-finite alpha; the stop loop clamps a non-finite offset. A malformed gradient now degrades to a valid color instead of throwing. No effect on well-formed gradients (literal or param).

## 0.19.1

### Patch Changes

- [`d4e9590`](https://github.com/flatink/flatkit/commit/d4e9590e8b06fc7268c4930940ff86e892469ffc) Thanks [@kaelhem](https://github.com/kaelhem)! - Fix a `flatc --check` false positive: a symbol's own `params` are now known variables in its `expr`.

  A symbol can read an exposed `param` (or state param) inside a channel expression -- `expr scaleX "1 - stationnaire"` -- and the runtime and `flatc --preview` resolve it (the param is injected into the instance scope). But the semantic linter did not put those params in the scope's known ids, so it wrongly reported `unknown variable "stationnaire"`. `docLintContext` now adds the current scope's symbol params + state params, resolved from the scope's `editPath` so they are added ONLY to that symbol (a param named in symbol A can't mask a real typo of the same name in symbol B). Monotone-safe: it only adds valid names, so it can only remove false positives -- a genuinely undeclared id is still flagged.

## 0.19.0

### Minor Changes

- [`c53a7b3`](https://github.com/flatink/flatkit/commit/c53a7b3471dae0e1bfef923cdab861cc0cef5284) Thanks [@kaelhem](https://github.com/kaelhem)! - Symbol COLOR params can now drive gradient STOPS and a TINT, not only a solid `fill <param>`.

  Recolorable generic effects (halos, glows, gradients) live in gradients and tints, but a `param color` could only feed a solid fill -- inside a `radial(...)`/`linear(...)` stop or a `tint`, the color was a baked hex and the param was dead. This generalizes the existing `fill <param>` to every place a color is accepted.

  - DSL: a gradient stop accepts a param ref with an optional alpha override -- `radial(0.5, 0.5, 0.5, 0:teinte@0.8, 1:teinte@0)` -- next to literal `0:#ffe9a8cc` stops; and `tint <param> <amount>` binds a tint hue to a param. The alpha is needed because a color param is a 6-digit hue (a halo wants "same hue, alpha fading 0.8 -> 0"). Round-trips through `flatFormat`.
  - Model: `Stop` gains `param?` + `alpha?`, `Tint` gains `param?` -- a unified "color ref (hex | param + alpha)". A new `resolveColorRef` is the single primitive behind solid fill, gradient stops and tint.
  - Player: stops and tint resolve per instance against the same `colorParams` scope as `fill <param>`; the tint is resolved to a concrete color before the off-screen composite, so the filter-composite cache busts when the param changes.
  - Engine: the merge key (`paintKey`) distinguishes a param stop from a literal one (no wrong merges); stop/tint interpolation carries the param binding.

  Backward compatible: a stop/tint with no param is an ordinary literal -- every existing hex gradient and tint renders pixel-for-pixel as before. The `@` character is now a token (the stop alpha marker); it was previously ignored, and no `.flat` source used it.

## 0.18.0

### Minor Changes

- [`9772d59`](https://github.com/flatink/flatkit/commit/9772d592750f27dd482de0776464e64287dae552) Thanks [@kaelhem](https://github.com/kaelhem)! - Independent (MovieClip-style) playback per nested instance: `loop` / `once`.

  A nested instance used to be a Flash "graphic symbol" only -- its local frame DERIVED from the ancestor's, so a sub-loop was truncated and snapped back to mid-cycle whenever an ancestor's timeline was shorter than (or not a multiple of) the sub-loop. The only way to keep a state-loop or idle clean was to pad every parent to the LCM of its sub-loops, which broke again the moment the asset was composed into a host with a different root length.

  This adds the Flash "MovieClip" model: an instance with its OWN clock, driven by the runtime's monotone heartbeat (`mono`) on its OWN duration, immune to any ancestor's loop wrap.

  - DSL: `instance "X" as "y" loop` (independent) / `... once` (play through, then HOLD the last frame) / `... synced` (the unchanged default). Round-trips through `flatFormat`.
  - Engine: `resolveInstanceFrame` / `instanceFrames` take the mono clock; `independent` = `mono mod dur`, `once` = `clamp(mono, 0, dur-1)`. `synced` and `singleFrame` are byte-for-byte unchanged.
  - Player: the render/hit paths carry the monotone beat down every scope; a non-playing `seek` anchors `mono` to the scrubbed frame, so headless `seek`+`render` and `--render --frame N` resolve MovieClip clips deterministically (phase = frame mod dur). During playback `mono` free-runs across loop wraps, so the phase is continuous.
  - Compiler: `flatc --preview` now sizes the preview window to a common multiple of every `independent` descendant's duration (and past the longest `once` clip) so a nested MovieClip loops cleanly in the preview, without touching the previewed symbol's own authored duration.

  Backward compatible: absent playback = `synced`, so every existing `.flat` renders identically. A static walk with no runtime clock falls back to synced.

## 0.17.3

### Patch Changes

- [`a8af28a`](https://github.com/flatink/flatkit/commit/a8af28a5825cacf5e72acbe81cf8e01b49dd2140) Thanks [@kaelhem](https://github.com/kaelhem)! - Warm the hit-test path cache so the FIRST interaction isn't a cold-start jolt. The 0.17.2 cache removed the recurring mouse lag, but on an empty cache the very first pointermove/pointerdown still flattened every hittable Bezier path in the scene at once (~one-time stall). The player now pre-flattens all hittable region/cel-material paths on `requestIdleCallback` after the first paint (when input is enabled), so that one-time cost lands during load instead of on the user's first gesture. Also exposes `FlatPlayer.warmHitCache()` and a standalone `warmHitCache(doc)` export for hosts that want to trigger it explicitly (or run in a browser without `requestIdleCallback`).

## 0.17.2

### Patch Changes

- [`0955eec`](https://github.com/flatink/flatkit/commit/0955eecfc05743b2fb30fb5a4fcea6fa12c0ea10) Thanks [@kaelhem](https://github.com/kaelhem)! - Fix the remaining pointer lag: memoize `pathToPolygons`. Hit-testing flattened every region's Bezier curves into polygons on every item on every `pointermove`, re-subdividing identical paths and allocating fresh rings each time — heavy CPU plus massive GC churn (the dominant cost in the browser profile). A path's geometry is invariant (dynamic geometry produces new path objects, never in-place mutation), so the default-tolerance flatten is now cached in a `WeakMap<Path, Polygon[]>` keyed by path identity. The hot hit callers (`hitRegion`, `pointInMask`, `regionHit`) reuse the same path reference across moves → cache hits, no re-flatten, no per-move allocation. Hit results are identical (pure memoization). The returned rings are now shared — treat them as read-only.

## 0.17.1

### Patch Changes

- [`468c15d`](https://github.com/flatink/flatkit/commit/468c15d3d69c5b4da621701ca861213a1b91dbe5) Thanks [@kaelhem](https://github.com/kaelhem)! - Fix pointer-move lag: the player rendered a full frame synchronously on every `pointermove` (which fire at 125–1000 Hz), on top of the 60 fps playback loop, saturating the main thread. Now the move render is coalesced — while a render loop (playback or a transition) is already running it repaints the next frame instead of per-event, and a static scene still renders synchronously so the cursor follows immediately. Also skip the per-move expression-cache invalidation when nothing reads `mouse.x`/`mouse.y` (a drag self-invalidates, so this is safe). Active-drag latency is unchanged (still synchronous).

## 0.17.0

### Minor Changes

- [`3de508a`](https://github.com/flatink/flatkit/commit/3de508a13fd44e39a2f92c7f0b60d1886928d097) Thanks [@kaelhem](https://github.com/kaelhem)! - States no longer freeze nested timelines. A symbol's `states` block used to pin its whole subtree's frame, so any timeline nested inside a state (a sub-loop, an idle) froze. The pinned POSE frame is now decoupled from the playback CLOCK handed to children: a state pins the symbol's own pose while the timelines nested inside it keep playing. This lets a state host a running loop (e.g. a `marche`/`panique` cycle selector) or an idle that runs during a state — authored entirely in keyframes, no `expr` scripting. Looping is opt-in: a frozen pose with no nested loop stays frozen, so existing state assets render unchanged.

## 0.16.3

## 0.16.2

## 0.16.1

## 0.16.0

## 0.15.2

## 0.15.1

## 0.15.0

### Minor Changes

- [`fc226cc`](https://github.com/flatink/flatkit/commit/fc226ccaa2853fb1e6441a1943eabf9ba1abd009) Thanks [@kaelhem](https://github.com/kaelhem)! - feat: text on a path (`text … along …`)

  Lay text along a curve — banners, badges, ribbons, dials (the FlatInk analogue of SVG `textPath`).

  - **`along "<id>"`** follows a named shape's outline (`circle`/`rect`/`ellipse`/`path … as "<id>"`); a closed
    named shape anchors the run **upright over the top** by default. **`along path "<d>"`** takes inline SVG
    path data instead (baked literally).
  - **`start <0..1>`** / **`align`** anchor the run; **`side over|under`** puts it outside/inside;
    **`spacing <px>`** tracks the glyphs (negative allowed). Closed paths wrap; open paths drop overflow.
  - **Animate** by quoting the value: `start "time * 0.1"` (marquee), `spacing "sin(time) * 4"` (eased
    tracking) — same expression scope as `bind`.
  - **Shapes are now nameable** with `as "<id>"`, and `flatc --check` warns when a run overflows its path.

## 0.14.5

## 0.14.4

## 0.14.3

## 0.14.2

## 0.14.1

## 0.14.0

## 0.13.0

## 0.12.1

## 0.12.0

## 0.11.0

## 0.10.0

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

## 0.5.0

## 0.4.0

### Minor Changes

- Font family alias for headless `--render`: `asset "id" "font.woff2" font "Quicksand"` registers the embedded face under the declared family instead of the file's intrinsic name-table family. Fixes variable-font static exports whose name table is wrong (skia would otherwise read them as `… Thin/Light` and fall back). Browsers are unaffected (they bind families via `FontFace`); the alias only steers `flatc --render`.

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

## 0.2.0
