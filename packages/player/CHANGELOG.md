# @flatkit/player

## 0.48.1

### Patch Changes

- [`3fa3028`](https://github.com/flatink/flatkit/commit/3fa3028018ca52e95a7177338b8578531a7173c7) Thanks [@kaelhem](https://github.com/kaelhem)! - A pass over every guide, README and agent prompt, each example compiled and each claim run against the code, and the defects it turned up.
  
  Fixes in the code:
  
  - `sameOriginAssetResolver('/activities/42/')` -- the example of the host guide -- resolved nothing, embedded assets included: a base that is a path (`/...`, `./...`, `../...`) is now resolved against the page it runs in. An empty base or a protocol-relative one still resolves nothing, and in Node an absolute URL is needed as before.
  - An unresolved `$(name)` in path data is always a compile error. It was one only when nothing in the name read as an SVG command: `$(trace)` compiled to a path of NaN with a mere warning.
  - `feedback lift   // dim later` no longer turns `dim` on: the tokens are read before the comment.
  - `flatc --render` (and `createRenderer` / `renderDocToPng`) refuse skia-canvas 3, which is npm's `latest` tag and what a bare `pnpm add -D skia-canvas` installs: it rendered without a word, with half the picture missing behind a moved shape larger than the frame. The error names the version found and the install hint says `skia-canvas@next`.
  
  In the guides (they ship with the compiler under `docs/` and `prompts/`):
  
  - Examples that did not compile, mostly `#` used as a comment after the header: fixed, and written with `//` throughout.
  - Guide layers (`guide layer`, `orient`) and the `blend`, `opacity`, `hitbox` item attributes were documented nowhere.
  - `self.grabbed` is 1 only on an object that can be grabbed (a `when pressed` or an interactor): said, with the empty `when pressed { }` that makes a click-only button squash.
  - The thread of a `link`: the example read `self.grabbed` on the wrong object and never showed.
  - `reveal ... cells`: the grid follows `grain`, not `brush`, once a grain is given.
  - The `turn` gesture of `--play` leaves a wrapped direction, not an accumulated angle; the `wheel` gesture and the pointer `id` were missing.
  - `repairLoop` from code needs a first pass on a source that does not parse, as `flatc --fix` does.
  - Host guide: what `seek`, `stop`, `toggle` and `load` do precisely, handlers that `wait`, `when loaded` running again on a restore, `setAudio`, `warmHitCache`, the `image` option, the browser bundle.
  - Prompts and `languageCard`: interactor options one per line, `tint` not on a bare shape, `when wrong` (not an event) replaced, `each` handlers need a parameterized symbol, the `hitbox` centred on the origin, `label`, `random()`, `keys.<Code>`, `valign`, `stroke ... fixed`, and a `pulse` captured on `time` never fires (it used to say it replays).

- [`bfdc1e3`](https://github.com/flatink/flatkit/commit/bfdc1e3cde7c50668c9a29283d21e940224c3d75) Thanks [@kaelhem](https://github.com/kaelhem)! - Nine defects of the code found while checking the guides against it.
  
  - An object that follows a `guide layer` reads where it is drawn: `Boat.x` / `Boat.y`, its rotation under `orient`, and `self` in its handlers gave the straight line between its two poses while the boat was drawn on the curve. A gesture script now presses it there too.
  - A text written `as "<id>"` is an object like another: a variable set by its handlers or its `drag` was "unknown" to every other block, a `--play` gesture could not name it, and `match` over such texts failed to check. `text(it)` in a `match` therefore has a clean form: the items are the texts themselves.
  - A statement written on the `object "X" { ... }` line itself reported its column counted from the brace, so `flatc --fix` could not split a run-on line there; and `feedback lift` on that line was not recognised.
  - `arr[i] = v` on a name that is not an array is a warning (the write was dropped at run time, in silence), with the declaration to write.
  - A state name inside an expression (`Door.door = score > 5 ? open : closed`) is a warning: the name is only read when it is the whole value, and was read as 0.
  - `spring dx "..."` / `smooth dy "..."` in a `.flat` is a compile error, as in an `object` block: it compiled and moved nothing.
  - Three warnings said `1:1`: `draw` on a shape with no stroke, a filter under a transform that never settles, and the same-direction-contours warning when two paths start alike (it now names its path as far as it takes to tell it from the others, and lands on it).
  - The hint of a missing `text("id")` wrote `as` after `at`, which does not compile.
  
  Measured before shipping: none of the new diagnostics fires on the 1197 `.flat` / `.flatink` sources of the consumer repos.
- Updated dependencies [[`3fa3028`](https://github.com/flatink/flatkit/commit/3fa3028018ca52e95a7177338b8578531a7173c7), [`bfdc1e3`](https://github.com/flatink/flatkit/commit/bfdc1e3cde7c50668c9a29283d21e940224c3d75)]:
  - @flatkit/engine@0.48.1
  - @flatkit/types@0.48.1

## 0.48.0

### Minor Changes

- [`127ffcc`](https://github.com/flatink/flatkit/commit/127ffcc45f425d358ae0b1c84747d484b218cca8) Thanks [@kaelhem](https://github.com/kaelhem)! - `wait` in a handler: "do this, wait, do that" without a hand-written state machine in `every frame`.
  
  ```
  object "Door" {
    when clicked {
      opened = 1
      wait 1.5
      sound "creak"
      wait until Player.x > 400
      opened = 0
    }
  }
  ```
  
  - `wait <seconds>` suspends the handler it is written in; the duration is an expression, counted in steps of the simulation (60 per second), never in real time, so `flatc --play` replays it exactly. A `wait` lasts one step at least.
  - `wait until <cond>` reads the condition once per step; already true when reached, it does not pause.
  - Allowed in object events, `when loaded` and `at frame <n>`, inside `if` and `repeat` too. In `every frame` and in a `fn` it is a compile error that says what to write instead.
  - A handler triggered again while it waits starts over: the waiting run is dropped. Different handlers wait side by side.
  - Waiting handlers are resumed at the start of each step, in the order they started, before `every frame`. They share the step's action budget. The player keeps at most 256 of them; `--check` warns when a document declares more.
  - The host's `pause()` freezes them, its `seek()` and `load()` drop them; a script's own `pause` and `go to` do not.
  - `wait(1.5)` reads as `wait 1.5`.
  - `--check` warns on an `at frame <n>` script that waits longer than a lap of a timeline nothing holds: the playhead is back on the frame first, so the script starts over for ever and what follows the wait never runs.
  - Nothing changes for a program that does not wait: such a handler runs through the same interpreter as before. `wait` remains usable as a variable name.
  
  New in the model: the actions `{ do: 'wait', seconds }` and `{ do: 'waitUntil', cond }`. Not in this release: `forever` and `repeat until`.

### Patch Changes

- Updated dependencies [[`364a652`](https://github.com/flatink/flatkit/commit/364a6526f1cfa480ca079f297e1ce4b0b87359d0), [`127ffcc`](https://github.com/flatink/flatkit/commit/127ffcc45f425d358ae0b1c84747d484b218cca8)]:
  - @flatkit/engine@0.48.0
  - @flatkit/types@0.48.0

## 0.47.0

### Minor Changes

- [`70d9ef0`](https://github.com/flatink/flatkit/commit/70d9ef064278708e19dfd31afc75514efae6f15d) Thanks [@kaelhem](https://github.com/kaelhem)! - The shapes of a `mask layer` add up: the mask is their union, each one filled by its own rule. Two shapes that overlapped used to cancel where they overlapped (the picture had a hole there, while the touch test already counted it in), so patching a mask with a second shape removed what it was meant to add. A single shape, or shapes that stay apart, still clip as before, pixel for pixel; shapes that overlap are composed off-screen.

- [`70d9ef0`](https://github.com/flatink/flatkit/commit/70d9ef064278708e19dfd31afc75514efae6f15d) Thanks [@kaelhem](https://github.com/kaelhem)! - `nonzero` on a shape fills it by the SVG / Canvas default rule: `path "M... Z M... Z" nonzero fill #461fbf`. Two contours that run the same way add up where they overlap, where the even-odd rule (still the default, so a nested contour still cuts a hole) leaves a hole: the stem and the arms of a letter in a logo taken from an SVG. The touch area follows the picture, and so does a mask made of the shape. `flatc --check` warns about a filled path whose same-way contours overlap and names the word; a nested contour, the ring idiom, is left alone.

- [`70d9ef0`](https://github.com/flatink/flatkit/commit/70d9ef064278708e19dfd31afc75514efae6f15d) Thanks [@kaelhem](https://github.com/kaelhem)! - `skia-canvas` 4 (from `4.0.0-rc7`) is now required to render in Node; version 3 is no longer accepted. Version 3 drops what lies behind a shape larger than the frame once its group moves it (half the picture comes out transparent), and the player carried a workaround for it in every browser bundle, where it never ran. That workaround is gone, with other duplicated code: the browser player is about 1.2 KB lighter (minified) than 0.46 although it gained the `nonzero` rule and the union of mask shapes. Coming from version 3, expect the text differences described in `docs/tooling.md` (a line of text may sit one device pixel higher or lower).

### Patch Changes

- Updated dependencies [[`70d9ef0`](https://github.com/flatink/flatkit/commit/70d9ef064278708e19dfd31afc75514efae6f15d)]:
  - @flatkit/types@0.47.0
  - @flatkit/engine@0.47.0

## 0.46.0

### Minor Changes

- [`dc5313b`](https://github.com/flatink/flatkit/commit/dc5313b05e860e04d3a8bef10bf9642522010ca6) Thanks [@kaelhem](https://github.com/kaelhem)! - The sound starts at the first gesture on the page when the browser kept it locked. With `autoplay`, the clips are scheduled at load, outside any gesture: Safari leaves the AudioContext suspended and no later click asked again, so a looping clip at frame 0 stayed silent until a pause/play. The first pointer press or release, key or tap anywhere on the page now resumes the context and puts the clips of every playing player back on its playhead. A host that worked around it (audio off then on at the first gesture) can drop that.

- [`65b7ae0`](https://github.com/flatink/flatkit/commit/65b7ae0b0ffd5926d376cd1939b5083f92f9da38) Thanks [@kaelhem](https://github.com/kaelhem)! - `reveal ... erase` leaves nothing of the veil where the finger went, and its edge is as soft as documented. Each frame's discs used to be blurred on their own before being added to the mask: a disc blurred alone is not opaque at its centre, so the stamps of successive frames never added up to a hole (faint rings inside the rubbed area, up to 13% of the veil left), and the blur was wide enough to spread the edge over two to three grains. The mask now keeps hard discs and the blur is applied once, to their union: measured on a scratch card with `brush 44 grain 11`, the edge goes from 34 units to 3. The outline follows the grid more visibly at a coarse grain; use a finer `grain` for a cleaner one.

- [`5cb7e7f`](https://github.com/flatink/flatkit/commit/5cb7e7fabad42a37f48bd48e600fc75a1ca2bd66) Thanks [@kaelhem](https://github.com/kaelhem)! - `valign top|middle|bottom` on a text places its lines in the height of its box. `top` is the default and changes nothing. `middle` centres what the eye reads, from the top of the first line's capitals to the baseline of the last line, so a label sits in the middle of its frame whatever the font: no more nudging `at` by eye. `bottom` brings the last line down until its descenders touch the bottom of the box. Both count the lines actually drawn (`wrap`, line breaks); with no box height, `middle` centres the text on its `at` line.

### Patch Changes

- Updated dependencies [[`eca701d`](https://github.com/flatink/flatkit/commit/eca701dcd29f4a27c5e0d1bf36f9c315b54e2355), [`5cb7e7f`](https://github.com/flatink/flatkit/commit/5cb7e7fabad42a37f48bd48e600fc75a1ca2bd66)]:
  - @flatkit/engine@0.46.0
  - @flatkit/types@0.46.0

## 0.45.0

### Patch Changes

- Updated dependencies [[`47ebe66`](https://github.com/flatink/flatkit/commit/47ebe663da33bb3cb89a71d981f17a1275da62cf)]:
  - @flatkit/engine@0.45.0
  - @flatkit/types@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies [[`88fe486`](https://github.com/flatink/flatkit/commit/88fe48671799d848c2e3e5af8686bc8b0ff712a4)]:
  - @flatkit/engine@0.44.0
  - @flatkit/types@0.44.0

## 0.43.0

### Minor Changes

- [`aec31e0`](https://github.com/flatink/flatkit/commit/aec31e03a01e5092388833b1b92d227cc6429456) Thanks [@kaelhem](https://github.com/kaelhem)! - flatink/flatink#20: `stroke ... fixed` keeps a shape's stroke width in scene units whatever its own scale (a
  rail stretched by `scaleX = 4` no longer gets thick sides). flatink/flatink#32: a bound text takes several
  values, one per `{}` slot (`bind "a", "b"`; new optional `Text.bindMore`). flatink/flatink#68: an instance's
  params and states read by name (`R.bras`, live value, else call site, else default); `--check` warns on a
  field an object does not have (`B.zoom`, `mouse.down`), places Doc-level warnings on the line of their
  subject instead of 1:1, and no longer warns about `time` on a motion that loops seamlessly.

- [`80568af`](https://github.com/flatink/flatkit/commit/80568af00b74e5ea8ae4ab8215be961a1b24708f) Thanks [@kaelhem](https://github.com/kaelhem)! - flatink/flatink#14: `Inst.state = B from A` replays a state transition from its start (jump to `A`, play to
  `B`, even when already at `B`); `--check` checks both states. flatink/flatink#32: `bind ... locale fr`
  spells the bound number the French way (minus sign U+2212, decimal comma, narrow no-break space between
  thousands); `text()` sends that spelling. flatink/flatink#68: the expressions written on scene items
  (`bind`, `draw`, `from`, `count`, text-on-path `start` / `spacing`, an `expr` attribute) are linted by
  `--check`.

### Patch Changes

- [`87a8912`](https://github.com/flatink/flatkit/commit/87a8912d75e52fcc48623442e7919f78ad2c6576) Thanks [@kaelhem](https://github.com/kaelhem)! - A security / correctness / performance pass before release. Security: an untrusted document could write to
  the host page's Object.prototype through an instance named `__proto__` (by-name param reads, unreleased),
  freeze the player with a param name used as a regex, allocate gigabytes per tick with a huge `fps` (the
  `at frame` walk of 0.41), or stall on a long `from` value; `--check` crashed on an object named `toString`.
  Correctness: `text()` of a bound text inside a symbol reads its instance's params; a `pause` on a
  stepped-over frame holds that frame; `load()` of a shorter document no longer fires a burst of frame scripts;
  an instance playing on its own keeps a held scene alive; a range-loop variable read after its loop is an
  error; fewer false warnings (text named with `as`, quoted `from`, gated `time` motions); a trailing comma in
  a `var` array is allowed again. Performance: `--check` stays linear on large programs (12k located warnings:
  8.2 s to 0.7 s). `@flatkit/mcp` moves to `@modelcontextprotocol/sdk` 1.31+ (advisory).
- Updated dependencies [[`aec31e0`](https://github.com/flatink/flatkit/commit/aec31e03a01e5092388833b1b92d227cc6429456), [`87a8912`](https://github.com/flatink/flatkit/commit/87a8912d75e52fcc48623442e7919f78ad2c6576), [`80568af`](https://github.com/flatink/flatkit/commit/80568af00b74e5ea8ae4ab8215be961a1b24708f)]:
  - @flatkit/engine@0.43.0
  - @flatkit/types@0.43.0

## 0.42.0

### Minor Changes

- [`f1022d8`](https://github.com/flatink/flatkit/commit/f1022d89d50c5b0df822473346d12a780249905f) Thanks [@kaelhem](https://github.com/kaelhem)! - flatink/flatink#62: a `.flatpack` may leave out the fields at their default value. Loading a document
  (`sanitizeDoc`, which the player runs) now puts back the ones some readers did not default (layer
  `visible` / `locked` / `opacity`, an identity `transform`); before, a missing `visible` read as a hidden
  layer. `compactDoc(doc)` (engine), `packToJSON(doc, { compact: true })` and `flatc --compact` write the
  lighter form, which needs a player on this version or later. Measured on our corpora: about 3% of the
  document without media, every render identical.

### Patch Changes

- Updated dependencies [[`f1022d8`](https://github.com/flatink/flatkit/commit/f1022d89d50c5b0df822473346d12a780249905f)]:
  - @flatkit/engine@0.42.0
  - @flatkit/types@0.42.0

## 0.41.0

### Minor Changes

- [`e9544ab`](https://github.com/flatink/flatkit/commit/e9544ab35127697ae88a4af59f36f2fc1fa695f4) Thanks [@kaelhem](https://github.com/kaelhem)! - Fixes and checks from flatink/flatink#64 [#65](https://github.com/flatink/flatkit/issues/65) [#66](https://github.com/flatink/flatkit/issues/66) [#67](https://github.com/flatink/flatkit/issues/67).
  
  **Breaking:**
  
  - `flatc <program>` (plain compile) exits 1 when the program has an `error` (the `.flatpack` is still
    written). Scripts that relied on exit 0 must check the report or fix the errors.
  - The scene parser refuses what it used to swallow: an `asset` without a kind, `timeline` with one
    number, an unknown easing or filter, an unknown `blend` / `cap` / `join` / `align` / `spin` word, a
    colour that is not 3/4/6/8 hex digits, `clip` on a text or an image, a non-colour `background`, a
    non-symbol line in a `.flat`, a `spring` without `stiffness` (a `smooth` without `k`).
  - New `--check` errors: wrong argument counts, unknown procedure or package, two interactors on one
    object, `sound` of an undeclared asset, `text()` of a missing text.
  - A script `pause` holds the playhead only: `every frame`, `clock` and springs keep running. The host's
    `play()` no longer releases a playhead the scene paused (the scene's `play` does); the host's `pause()`
    still freezes everything. `isPlaying` is true when the timeline moves.
  - `at frame N` now runs for frames the playhead steps over (120 fps timelines, slow displays).
  - A `repeat i from A to B` variable is restored after the loop.
  - `shake` is 4 degrees (was 4 radians); `text("id")` of a bound text sends the displayed value.
  - FlatPlayer internals are ES private fields: reading one through a cast no longer works (public API
    unchanged).
  
  Bugs: `at frame` runs for every whole frame the playhead crossed, not only the one it landed on; a plain
  `flatc` compile with an error exits 1 (the pack is still written); `else` may open the line after the `}`
  (its body used to run unconditionally); a var array reads each cell as a constant expression
  (`[PI / 2, 1]`); compact SVG arc flags (`a10 10 0 0120 0`); `text("id")` of a bound text sends the
  displayed value; `pause` in `when loaded` holds against `autoplay`; `shake` is 4 degrees, not 4 radians;
  `ease bounce` no longer crashes the render.
  
  Stricter parsing (each used to compile and lose content or draw the default): a required asset kind
  (file-type words such as `png` or `mp3` stand for it), two numbers after `timeline`, known easings,
  filters, `blend`, `cap`, `join`, text `align`, pose `spin`, 3/4/6/8-digit colours, `clip` only on a group
  or an instance, a solid `background`, symbols only in a `.flat`, `spring` / `smooth` with their own slots
  and a required `stiffness` / `k`.
  
  New `--check` diagnostics: wrong argument counts, unknown procedure calls, an unknown package, two
  interactors on one object, `when dropped on` with nothing draggable, an `at frame` that never runs,
  `sound` of an undeclared asset, `text()` of a missing text, a `fn` or `var` hidden by a built-in, an
  object name matching several items, no more false "never used" for a variable read by `each`.
  
  Decided: a script `pause` holds the playhead only (like Flash's `stop()`): `every frame`, `clock` and
  springs go on, `--play` follows, and the host's `play()` no longer undoes it (its `pause()` still freezes
  the player). A `repeat i from A to B` variable is the loop's own. `repeat 3 {` without `times` carries
  its `--fix` repair. `self` in a handler stays in scene space (documented).

### Patch Changes

- Updated dependencies [[`e9544ab`](https://github.com/flatink/flatkit/commit/e9544ab35127697ae88a4af59f36f2fc1fa695f4)]:
  - @flatkit/engine@0.41.0
  - @flatkit/types@0.41.0

## 0.40.0

### Minor Changes

- [`669ab59`](https://github.com/flatink/flatkit/commit/669ab59554bcbd35ec11a3741bca4837256db7db) Thanks [@kaelhem](https://github.com/kaelhem)! - Three leftovers of the review pass.
  
  - **A syntax error points at its line in the author's file.** It was off by the number of `def` lines and parameterized symbols above it (they were cut out of the text before parsing; they are now blanked), it pointed inside a rebuilt text for an error in the program's own `symbol`, and `flatc` printed no line at all: it now prints `flatc: <file>:<line>:<col>: compile error: ...`. A parameterized symbol can be used inside the program's own plain symbol (it failed on `(`).
  - **A loop or a parameterized symbol no longer moves the lines below it.** Unfolding put one item per line, so a scene `repeat` of ten pushed every line after it down - an error further down, in the scene or in an `object` block, was reported up to tens of lines too low. The unfolded text now keeps the line count of the source (items are separated by a break that is not a line): an error after the loop is at its own line, an error inside it at the line of the `repeat`. The same for a parameterized symbol unfolded at its call, and for `each` and `match` blocks: the behaviour parser treats that break as the end of a statement, and drops the mechanical repair of a diagnostic that falls on unfolded code (its range would not be the author's text).
  - **`printProgram` keeps a matrix**: its linear part is written with 6 decimals and its translation with 4 (two decimals turned `rotate 45` into 0.71, a couple of pixels away from the pivot at each round trip).
  - **Rendering after a script paints once.** `player.withoutPainting(f)` runs `f` with painting suspended and leaves the picture dirty for the next `render()`; the renderer uses it while it replays a gesture script (200 moves and a `scratch` painted the scene 828 times, for one picture at the end).

- [`be29259`](https://github.com/flatink/flatkit/commit/be29259a11207b62ef6347a1a0cd288558c5a82e) Thanks [@kaelhem](https://github.com/kaelhem)! - What a performance, quality and security pass over the 0.36-0.39 changes found, each reproduced before being fixed. Measured on four consumer repositories: no `--check` exit code changes on 789 files, 145 of 145 replay tests of one, 127 of 128 gesture scripts of another with identical output (the last differs in variables only).
  
  **Errors that used to be silent** - a program that relied on them now fails to compile, with a message that says why:
  
  - A `repeat` bound that is not a constant (a param, a variable) unfolded zero times; it is now an error naming the bound. A program's `def` now reaches a `repeat` in the program's own plain `symbol`. More than 5000 iterations in all, or more than 4 MB of unfolded source, is an error instead of a silent cut or a server running out of memory (a 14 KB library took 18 s and 3 GB). The `repeat` head is found by a linear scan (a regex backtracked for 12 s on 120 KB of comment).
  - A `var` initialiser is read to the end of its statement: `var a = 3 == 3` gave 3, `var a = 4 garbage` gave 4. Several `var`s on one line still work.
  - On a declaration line, a channel spelled `rotate` (`expr rotate "45"`, `spring rotate "a"`) is an error: it meant radians, next to `rotate <n>` in degrees. Write `rotation` or `rotationDeg`.
  
  **Player**
  
  - `random()` draws from two seeded streams, one for the logic and one for the picture: painting and hit-testing shifted the numbers the logic drew, so `--play` and `--render --script` disagreed on the same seed.
  - On-demand painting settles: a number the picture reads repaints only when it has moved by more than 1e-4 since it was last painted (an exponential decay repainted for a minute after each trigger). The pointer repaints only when the picture reads the mouse; a playing scene is painted once per frame while dragging.
  - `setParam` and `Inst.p = <number>` read the number directly (each distinct value was compiled and cached for good); `Inst.flag = true` now works; the expression cache has a ceiling.
  - A crafted document's `contentParam: "constructor"` or non-string `content` no longer crashes the renderer.
  
  **flatc and the replay**
  
  - One budget per replay: 100 000 simulation steps in all, a `turn` of at most 10 000 sub-moves, at most 200 `shot`s; a `scratch` steps the simulation on its press and release only (it was 45x slower on a scene with `every frame`). A gesture that cannot be replayed is one line on stderr. A replayed target follows the rule of names (a text named by its content yields to a group).
  - A rendered picture is at most 40 million pixels, scale included.
  - `--check`: "did you mean" skips names that cannot be a typo (22 s on long names); a value function's parameter named `value` or `time` is no longer reported as hidden; path extents no longer overflow the stack on huge paths; `--since` counts lines once per file.
  
  **sugarflat**: in `place`, an item picked and then dragged home is no longer sent back by a later tap on another target; Tab goes through the blocks in their order (each block owns a range of focus ranks).

### Patch Changes

- Updated dependencies [[`669ab59`](https://github.com/flatink/flatkit/commit/669ab59554bcbd35ec11a3741bca4837256db7db), [`be29259`](https://github.com/flatink/flatkit/commit/be29259a11207b62ef6347a1a0cd288558c5a82e), [`00e721b`](https://github.com/flatink/flatkit/commit/00e721b657ffb569ca2a9330c5608da7ebfbe09a)]:
  - @flatkit/engine@0.40.0
  - @flatkit/types@0.40.0

## 0.39.1

### Patch Changes

- Updated dependencies []:
  - @flatkit/engine@0.39.1
  - @flatkit/types@0.39.1

## 0.39.0

### Minor Changes

- [`30605db`](https://github.com/flatink/flatkit/commit/30605db0fd1feb3334e72f89f6a404f44c0437e2) Thanks [@kaelhem](https://github.com/kaelhem)! - Three questions from people writing real activities, answered in the docs, with one addition to the language.
  
  - **`DT`, the simulation step** (flatink/flatink#34). A new constant: the duration of one `every frame` run, in seconds, 1/60. `every frame` has always been a fixed 60 Hz step whatever the `timeline` fps and whatever the display; the language now names it, so an integration is `v = v + a * DT` instead of a `dt` measured from `clock` in every activity. (In a browser `clock` follows real time once per display, so two steps run in the same display read the same `clock`: a measured `dt` is the display's duration, then 0.) `--check` reports a variable named `DT` as hidden by the constant. `SIM_HZ` is exported by `@flatkit/engine/expr`.
  - **How a frame runs** (flatink/flatink#33 [#34](https://github.com/flatink/flatkit/issues/34)): a new section of `docs/behavior-and-interactions.md`. Handlers run when their event arrives, before the next step; then the 60 Hz steps (the scene's `every frame`, the active symbols', then `at frame` scripts); then the picture, where channel bindings are read. It says what a handler sees of a value derived in `every frame`, and what happens when the display stalls: at most 0.25 s counted and 30 steps run per display, the rest dropped, so the simulation slows down and never jumps.
  - **Determinism** (flatink/flatink#36): a new section of `docs/expressions-and-stdlib.md`. Which built-in functions give the same bits on every engine (the operators, `sqrt`, `floor`, `round`, `mod`, `clamp`, `lerp`...) and which ECMAScript leaves to the implementation (`sin`, `cos`, `pow`, `exp`, `log`, `hypot`...); how `%`, `round` and `random()` behave for someone writing a replica in another language.
  
  Each statement of those two sections is pinned by a test next to the code, and a test fails when a built-in function is added without being classified.

### Patch Changes

- Updated dependencies [[`30605db`](https://github.com/flatink/flatkit/commit/30605db0fd1feb3334e72f89f6a404f44c0437e2)]:
  - @flatkit/types@0.39.0
  - @flatkit/engine@0.39.0

## 0.38.0

### Minor Changes

- [`59bd47f`](https://github.com/flatink/flatkit/commit/59bd47f16d049874f9973dd0abd5e0ae86440729) Thanks [@kaelhem](https://github.com/kaelhem)! - Nine reports from a crew writing real activities: four places where the language refused something it accepts one block away, five in `flatc`.
  
  **Language**
  
  - **`repeat`, `def` and `$()` in a `.flat` library** (flatink/flatink#15). `repeat i from 0 to 8 { circle $(i*20) 0 6 fill [#333](https://github.com/flatink/flatkit/issues/333) }` inside a symbol's layer is unfolded when the library is read, as in a program's scene. It was refused with `"layer" expected, "repeat" found`.
  - **A plain `symbol "X" { ... }` in the program** (flatink/flatink#27). The block a `.flat` holds (its own timeline, cels, states, params) can be written in the `.flatink`, before or after the scene, and instanced without parens. On a name both declare, the program's symbol wins over the library's. No dummy parameter needed any more. `parseProgram` now fills `Program.symbols`, and `splitLocalSymbols` is exported.
  - **`rotate` / `scale` / `scaleX` / `scaleY` where an item is declared** (flatink/flatink#28): `group "G" at 100,100 pivot 20,0 rotate 45 scale 2 { ... }`, on a group, an instance, a text or an image. Degrees and multipliers, as in a `pose`; they turn around the pivot, which stays where `at` put it. Baked into the matrix. Not combinable with `align`.
  - **A table written in place: `[a, b, c][i]`** (flatink/flatink#29). Elements and index are expressions, only the element picked is evaluated, and it indexes as an array variable does. A table that is not indexed is an error that says so.
  
  **`flatc`**
  
  - **BEHAVIOR CHANGE - `--play`: a pointer event takes a frame** (flatink/flatink#16). Each press, move and release of a replayed gesture is followed by one simulation step, so a rule written in `every frame` sees the drag. `--settle N` sets that number for a script, and `"settle": N` on a gesture sets it for that one; `playHeadless` takes `settle` too. `--settle 0` is exactly the replay of before. Measured on the replays of two consumers (127 scripts, 145 tests): the `send`s never change, variables that move with time do, and 5 of them fail - four `expect` a value that decays every frame, read right after a tap, and one releases a fling "one frame after the move" with a `wait` that is now one frame too many. Those need `"settle": 0` on the gesture, or the `wait` removed.
  - **`--play`, gesture `turn`** (flatink/flatink#17). `angle` is the value the gesture ENDS at (the docs said "by"). Without `from`, the press goes to the object's position, then to the centre of its drawn box. A press that does not grab the target is now reported (a `warnings` entry in the result, a line on stderr) naming what is grabbed there instead; it used to turn another object, or none, in silence. It is not a failure: a script may be proving that a locked object does not respond.
  - **`--preview` measures the symbol as it is drawn** (flatink/flatink#21): its `expr` channels evaluated with its params, the `--set` values included. A bar stretched by `expr scaleX "long"` was framed on its base shape and came out cropped. `containerBBox` and `containerBBoxUnion` take a `scoped` argument.
  - **`--preview --frame N` on a symbol with `states`** says that it has no effect and what to write instead (flatink/flatink#23).
  - **`--render --script`** (flatink/flatink#38) replays a gesture script, as `--play` does, and renders the state it reaches. A `{ "type": "shot", "name": "x" }` gesture writes `<out>.x.png` at that point; a failed `expect` exits non-zero. It was accepted and ignored. From code: `createRenderer(doc, { interactive: true })`, then `play(gestures)` and `capture()`; `renderDocToPng` takes `script`. `@flatkit/player/debug` exports `createReplayer`, and the player has `grabTargetAt(point)`.

### Patch Changes

- Updated dependencies [[`59bd47f`](https://github.com/flatink/flatkit/commit/59bd47f16d049874f9973dd0abd5e0ae86440729)]:
  - @flatkit/types@0.38.0
  - @flatkit/engine@0.38.0

## 0.37.1

### Patch Changes

- [`7611bc8`](https://github.com/flatink/flatkit/commit/7611bc847ffb83d3328dceac8e8418a96ea75880) Thanks [@kaelhem](https://github.com/kaelhem)! - What the consumers of 0.37 reported.
  
  - **Node rendering: a large shape filled with a GRADIENT no longer wipes what is behind it.** The guard against the skia-canvas 3 shortcut (a fill whose local bounds contain the canvas discards everything drawn before) covered solid fills only; a gradient sky larger than the frame, moved by its group, still came out half transparent. Linear and radial gradients are now covered. Browsers were never concerned.
  - **skia-canvas 4 is accepted** (peer range `^3.0.8 || ^4.0.0-rc7`). Version 4 fixes the shortcut above by itself. It sets text one device pixel lower than version 3 (shapes are identical), so do not mix frames of the two in one video.
  - **`pathToPolygons` gives the vertices alone for a path of lines.** The zero-length handle that marks such a path as straight made its first edge a "curve", subdivided into some twenty-five aligned points.
  - **`flatc --since 0.35` also lists an open line that moves by 2 units or more**, however little that is of its length. A horizon across the whole frame bent by 3.9 units and 0.4% of its size, and only `--all` showed it.
  - **Docs and prompts**: `dsl-gotchas.md`, `flatink-core.md`, `flatink-lite.md` and `role-asset-creator.md` now say that a path of lines is drawn straight, that `smooth` after the path data gives the curve, and that `--check` is silent under 12 points. `polyline` is in the two references and the gotchas page.
- Updated dependencies [[`7611bc8`](https://github.com/flatink/flatkit/commit/7611bc847ffb83d3328dceac8e8418a96ea75880)]:
  - @flatkit/engine@0.37.1
  - @flatkit/types@0.37.1

## 0.37.0

### Minor Changes

- [`ebeb796`](https://github.com/flatink/flatkit/commit/ebeb796f2d03954c5955b798296f87216a592473) Thanks [@kaelhem](https://github.com/kaelhem)! - Four things reported by the first two consumers to move to 0.36.
  
  - **Rendering in Node: a large opaque shape no longer wipes what is behind it.** skia-canvas 3.x discards
    everything drawn so far when a fill "covers the canvas", and decides it from the path's local bounds,
    before the context transform. A shape much larger than the canvas and offset by its group -- covering
    only part of the frame -- wiped the background: more than half of the picture came out transparent
    (`flatc --render`, any host rendering frames with skia-canvas). Plain rectangles and polygons had the
    defect before 0.36; rounded rectangles gained it when their sides became straight. The player now fills
    such a path in device space. Browsers were never concerned; skia-canvas 4 no longer needs it.
  - **`player.setParam(instance, param, value)` is public.** A host drives an instance's exposed params:
    a number, a boolean, a state by name, a color, and a text given as it is (no quoting, no escaping). It
    returns `false`, and changes nothing, for an unknown instance, an undeclared param or a value of the
    wrong kind.
  - **`polyPath` draws straight sides**, as its name says. It returned bare anchors, read as free-hand
    material: rounded at gentle turns and exported with `smooth`.
  - **`flatc --since <version>`**: a one-shot report of what the given sources draw differently from that
    version, with `file:line`. Recorded so far: the paths of lines that 0.35 rounded and 0.36 draws
    straight, with how far each moves, so an author decides once where `smooth` belongs.

### Patch Changes

- Updated dependencies [[`ebeb796`](https://github.com/flatink/flatkit/commit/ebeb796f2d03954c5955b798296f87216a592473)]:
  - @flatkit/engine@0.37.0
  - @flatkit/types@0.37.0

## 0.36.1

### Patch Changes

- Updated dependencies [[`9ba1877`](https://github.com/flatink/flatkit/commit/9ba187778ca41d14aae99bfc2055dc4badb2cd39)]:
  - @flatkit/engine@0.36.1
  - @flatkit/types@0.36.1

## 0.36.0

### Minor Changes

- [`357137e`](https://github.com/flatink/flatkit/commit/357137ea70e9064d6ecea56e93be827351ef2e03) Thanks [@kaelhem](https://github.com/kaelhem)! - `polyline <xs> <ys> [count <n|"expr">] [closed]`: a shape whose points are two array variables, read every
  frame. A trajectory, a curve as it is computed, a polygon the learner deforms -- what used to take hundreds
  of small groups shown one by one. The segments are straight; fill, stroke, `opacity`, `draw` and `nohit`
  are those of any shape. The arrays stay the truth (replayable, restorable), and a line that no longer
  changes is no longer repainted. `flatc --check` reports a name that is not a declared array.

- [`b29bb4e`](https://github.com/flatink/flatkit/commit/b29bb4e482be3ffbb1242c68081e067278ff9e94) Thanks [@kaelhem](https://github.com/kaelhem)! - Keyboard access is built in: `focusable` objects are reached with Tab, clicked with Enter or Space, and
  ringed by the player.
  
  - **`focusable [order <n>] [noring]`** in an `object` block. Tab and Shift+Tab walk the focusable objects
    (ranked ones first, then document order; an object that is not shown is skipped), Enter and Space fire
    the focused object's `when clicked`, and `self.focused` is 1 on it.
  - **The player draws the focus ring** (around the object's `hitbox` when it has one). `noring` on an
    object, or the `focusRing: false` option, leave the drawing to the scene.
  - **A stop, not a trap.** The canvas joins the page's tab order (`tabindex="0"` when the scene has
    focusable objects); Tab is handled only while the canvas has the page's focus, and past either end it is
    left to the page. Using the pointer drops the keyboard focus.
  - **Host API**: `player.focused`, `player.focusNext(1 | -1)`, and the `focusRing` option.
  - **Testable**: under `flatc --play`, a `key` gesture named `Tab` moves the focus and `Enter` clicks.
  - **sugarflat**: every element of `place`, `compose` and `steps` is focusable. `place` gains a second way
    in besides dragging: pick an item (Enter, or a tap), then pick its target. A picked item is scaled up
    a little; `<block>_sel` holds its 1-based index.

- [`1acff0c`](https://github.com/flatink/flatkit/commit/1acff0c61cdd644f500eddb68b9ea97830daefa1) Thanks [@kaelhem](https://github.com/kaelhem)! - The player paints less, and a component costs what it draws.
  
  Measured on a scene of 40 component instances and 300 named objects (`packages/player/bench/components.bench.mts`,
  one sim step + its render): 3.3 ms per frame before, 0.43 ms after; with 40 param writes per frame, 127 ms
  before, 0.40 ms after.
  
  - **A param write no longer paints.** `Inst.param = ...` ended in a full synchronous render, so N writes in
    an `every frame` drew the scene N + 1 times. Whoever runs the actions (the tick, a sim step, a pointer
    handler) paints once when they are done.
  - **A picture that did not change is not repainted.** While it plays, the player paints a frame only when
    something the picture reads has changed: a variable, a param or a state, a settling spring, the pointer,
    a key, an image or a font that finished loading. A scene at rest costs no paint. A scene that reads
    `time`, `clock`, `frame` or `random()`, or whose keyframes play with the playhead, is painted every frame
    as before. A host that changes what is drawn behind the player's back calls `player.render()`.
  - **An instance scope is chained, not copied.** Entering an instance merged its params into a copy of the
    whole scene context (every variable, every named object), per instance and per walk. `childScope` (new,
    `@flatkit/engine/expr`) links the params to the parent scope instead.
  - **A spring in a library the scene does not use costs nothing.** The modifier pass was switched on by any
    symbol of the document; it now looks at what the scene can reach.
  - **New option `maxPixelRatio`.** Caps the device pixel ratio the canvas is sized with: on a 3x phone, `2`
    trades a little sharpness for a much cheaper frame. No cap by default.

- [`e6eca55`](https://github.com/flatink/flatkit/commit/e6eca55c5bc56a1506aabd6cd9c0849cff152548) Thanks [@kaelhem](https://github.com/kaelhem)! - Symbol params: a `text` type, colors and texts written at runtime, and `--check` reads what an instance
  is given.
  
  - **`text` params.** `params { text libelle = "OK" }`, drawn inside the symbol with `text libelle at ...`
    (the bare name instead of a quoted string). A reusable button carries its own label, set per instance
    with `{ libelle = "Valider" }`.
  - **Colors and texts change at runtime.** `Inst.fond = #33aa33` and `Inst.libelle = "Bravo"` repaint the
    instance. The right-hand side is a literal (a color, a quoted text); a color assignment used to
    compile and do nothing.
  - **`--check` checks instance params and states.** A param the symbol does not declare (with the name it
    probably meant), a value of the wrong type, a number outside its `range`, a state that does not exist,
    at the call site and in an assignment; and an assignment whose target is no instance of the scene.

- [`8bf60de`](https://github.com/flatink/flatkit/commit/8bf60dedcefc3332d280c5147543346a3dd8f3cd) Thanks [@kaelhem](https://github.com/kaelhem)! - `random()` can be reproduced, and sugar gestures can shuffle.
  
  - **`seed` option of the player.** `random()` (in `[0, 1[`, now documented) draws from a seeded generator
    when the host passes `seed`, and from `Math.random` otherwise. `load()` starts the sequence again.
  - **A headless replay is always seeded.** `flatc --play` and `playHeadless` use seed `1`, so the same
    script gives the same result twice and an `expect` can assert on a draw; `--seed N` picks another.
    `flatc --render --steps` is seeded too.
  - **sugarflat: `shuffle`.** A `shuffle` line in a `place`, `compose` or `steps` block swaps the places of
    the elements the learner picks from when the activity loads. Targets stay put, and the order of a
    `steps` sequence is unchanged. `meta[].shuffle` reports it.
  - A semantic gesture by name (`tap`, `drag`) aims at where the object stands now: it used to read a
    per-frame snapshot that a `when loaded` could have made stale.

- [`aac2a80`](https://github.com/flatink/flatkit/commit/aac2a809e926333168426538646227f4af6e2cd9) Thanks [@kaelhem](https://github.com/kaelhem)! - Touch and input: an object is touched where it is drawn, by as many fingers as there are, and the
  keyboard has names for its physical keys.
  
  - **An instance is touched where it is drawn.** The hit test entered an instance with its parent's scope:
    an inner group moved by `expr x "pos"` was touched where it stands with `pos` unset, and a state-driven
    symbol where its initial state puts it. It now enters with the instance's params (declared, given at
    the instance, written at runtime), like the renderer.
  - **`hitbox` is also where an object is touched** -- clicked, pressed, dragged, hovered -- whenever
    nothing drawn inside it is hit first. A stroke-only ring is clicked in its middle, a small handle gets
    a finger-sized target, an empty group becomes a touch area. The rectangle follows the object, and what
    is drawn above it keeps the pointer. BEHAVIOR CHANGE: an object with handlers and a `hitbox` larger
    than its drawing now reacts in the whole rectangle. `hitbox` is kept on an `instance` too (it used to
    be parsed and dropped), for touch and for drops.
  - **Each pointer has its own gesture.** Two fingers can press, hold and drag two objects at once. With a
    single gesture for everyone, lifting one finger released what the other was holding, and that one's
    own release was lost.
  - **`keys.<Code>`: the physical key.** A key answers to its `KeyboardEvent.code` as well as its `key`:
    `keys.ShiftLeft` / `keys.ShiftRight` are two keys, the digit row is `keys.Digit1`, the keypad
    `keys.Numpad1`. A `key` name is released with the key that set it, even if the character changed
    meanwhile (Shift let go first used to leave "A" held).
  - **The first `sound` is heard, and on time.** Sound assets are decoded when the document loads (through
    an OfflineAudioContext, so no AudioContext is opened before a gesture) instead of in the frame that
    first plays them. A sound asked for while its asset is still decoding plays when it lands; a timeline
    clip in the same case starts then, not on the next loop.
  - A pointer the browser refuses to capture (a synthetic event) no longer swallows the press.

### Patch Changes

- [`ecd419e`](https://github.com/flatink/flatkit/commit/ecd419e136906bbcd28c8740169adf71db9a8934) Thanks [@kaelhem](https://github.com/kaelhem)! - Fifteen reports from a team writing real activities, most of one family: the program compiled, `--check`
  passed, and the behavior was simply not there.
  
  **Language**
  - Several `every frame` (or `when loaded`) blocks all run, in source order. Only the last one used to.
  - `var z = 10 / 3` is evaluated like a `def` (a constant expression). It used to keep the `10` and drop the
    rest of the line. An initialiser that is not a constant is now an error.
  - `size` is read anywhere in the header. After an `asset` line it was skipped and the scene stayed 800x600.
  - Scientific notation (`1.5e2`, `2.7e-06`) is accepted in an expression, as it already was in a `var`.
  - In a `.flat`, `expr rotationDeg "a"` is the degree twin of `expr rotation`, and an unknown channel name is
    a compile error. It used to compile and animate nothing.
  
  **Checks**
  - New warning: a variable (or a function parameter) hidden by a math function, a constant, a reserved name
    or a value function of the same name -- `var angle = 40` read 0 under `use "gesture"`.
  - A variable read only inside a value function (`fn f() = G + 1`) is no longer reported "never used".
  - "overlapping hitboxes" fires only when both zones are drop targets.
  
  **Player**
  - Writing a state it is already heading to no longer restarts its transition. Mirroring a variable into a
    state from `every frame` froze an `easeInOut` transition at its origin.
  - A zero-length stroked subpath draws its cap (a disc for `round`, a square for `square`), as SVG does.
    Current Chrome follows the Canvas spec and drew nothing, so the "dot" idiom vanished.
  - Word-wrap never breaks at a no-break space (U+00A0, U+202F, U+2007).
  - A `sound` action is a silent no-op where there is no WebAudio, instead of a crash.
  
  **flatc**
  - `--play` and `--render` take the `.flat` libraries passed as arguments, like `--check` and the compile.
  - `--play`: audio is off, and `tap` accepts a point (`"x"`, `"y"`) as well as a `"target"`.
  
  **sugarflat**
  - `place`: labels that fold to the same identifier (`-1` / `+1`, `< 1` / `= 1` / `> 1`) each get their own
    object -- the first keeps the plain name, the next ones take `_2`, `_3`. Two targets with the SAME label
    are an error.
- Updated dependencies [[`357137e`](https://github.com/flatink/flatkit/commit/357137ea70e9064d6ecea56e93be827351ef2e03), [`b29bb4e`](https://github.com/flatink/flatkit/commit/b29bb4e482be3ffbb1242c68081e067278ff9e94), [`a6a462c`](https://github.com/flatink/flatkit/commit/a6a462c101c710147c279f2ea2424ebf35aa0e34), [`1acff0c`](https://github.com/flatink/flatkit/commit/1acff0c61cdd644f500eddb68b9ea97830daefa1), [`e6eca55`](https://github.com/flatink/flatkit/commit/e6eca55c5bc56a1506aabd6cd9c0849cff152548), [`ecd419e`](https://github.com/flatink/flatkit/commit/ecd419e136906bbcd28c8740169adf71db9a8934), [`f958ce8`](https://github.com/flatink/flatkit/commit/f958ce8f6aecb1deb5750609f2d5fecb53a54e12), [`aac2a80`](https://github.com/flatink/flatkit/commit/aac2a809e926333168426538646227f4af6e2cd9)]:
  - @flatkit/types@0.36.0
  - @flatkit/engine@0.36.0

## 0.35.3

### Patch Changes

- [`d0c60a9`](https://github.com/flatink/flatkit/commit/d0c60a94826ed7bd98558e7532537c8a1ac3a25a) Thanks [@kaelhem](https://github.com/kaelhem)! - perf(player,engine): stop rebuilding, every frame, what never changes

  A frame profile of a 200-instance scene said the renderer's biggest single cost was smoothing and
  re-creating the SAME geometry it had already built the frame before. Nothing here changes what is drawn.

  - Region outlines are memoized. `pathToBezier` (the Catmull-Rom pass) and the `Path2D` a region strokes and
    fills are now kept on the path they came from, on the invariant the flattening cache already relies on:
    geometry never changes in place (a morph or a `bind` yields a NEW path). That scene was building 601
    `Path2D` objects and issuing 4806 native path calls PER FRAME; it now issues none.
  - Arc-length flattening is memoized too, per subpath and tolerance. It is what `samplePathAt` /
    `projectToPath` walk, several times per POINTER MOVE while a child draws a `trace` -- and what
    `makePathSampler` re-walks once per frame per text-on-path.
  - The context matrix is read only when it is needed. `scaleOf` and a leaf's screen box exist to size an
    isolation buffer; an item with neither a tint nor a filter -- most of them -- no longer measures itself or
    allocates a DOMMatrix to ask the scale (420 reads per frame down to 18).
  - A solid fill measures no geometry: `paintStyle` takes its bbox lazily, so the bounding box a gradient
    needs is not computed for every plain-coloured region of every frame.
  - Per-container garbage: `renderLayers` allocated three empty Maps per call (once per container per frame),
    and `layerStructure` built an id map and climbed ancestors for stacks that declare no `parent` -- where a
    mask, a guide, and a hidden ancestor are all impossible by construction.
  - The pointer path: handlers and interactors are indexed by target instead of re-scanned (and re-filtered
    into a fresh array) for every item of every hit chain on every move; `self` and its parent space now come
    from ONE scene walk that stops at the object instead of two that each resolve the whole scene; a `trace`
    target's world path is measured once per document rather than on every write of its progress.
  - Load: the three questions asked of the document (does it read the wheel / the pointer / which keys) share
    one serialization instead of stringifying the whole `.flatpack` three times.

  Measured on a 200-instance, 30-symbol scene, baseline and candidate interleaved: 67% less time per rendered
  frame (same on a real canvas backend), 59% per simulated frame, 62% per pointer move of a `trace`.

- Updated dependencies [[`d0c60a9`](https://github.com/flatink/flatkit/commit/d0c60a94826ed7bd98558e7532537c8a1ac3a25a)]:
  - @flatkit/engine@0.35.3
  - @flatkit/types@0.35.3

## 0.35.2

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.35.2
  - @flatkit/engine@0.35.2

## 0.35.1

### Patch Changes

- Updated dependencies [[`ea7f916`](https://github.com/flatink/flatkit/commit/ea7f9163e88bfc53f10a502344013fb06eb2ec1e)]:
  - @flatkit/engine@0.35.1
  - @flatkit/types@0.35.1

## 0.35.0

### Minor Changes

- [`bbd43c0`](https://github.com/flatink/flatkit/commit/bbd43c070dd77767253d2a0df697446eb3953472) Thanks [@kaelhem](https://github.com/kaelhem)! - `--check` now warns when a `filter` sits under a transform that never stops moving.

  Isolating a filter costs an off-screen canvas, a CSS filter and a blit. The player pays that once and
  keeps the baked bitmap, keyed on the item's screen placement -- that cache is the whole reason a scene
  can afford glows at all. Bind a transform channel to a _periodic_ `clock` motion on the filtered item
  or on any ancestor, and the key never repeats: the composition is re-baked every frame, forever.

  Measured on a generated activity: a garland swaying on `dy = 3 * sin(clock * 0.55)` with six glowing
  lanterns hanging from it. The lanterns were innocent -- their own motion settles -- but the sway above
  them re-baked all six glows on every frame. Nothing looked wrong; the drag simply stuttered, and the
  cost was invisible in the source, split across a `filter` on one line and a parent's `dy` fifty lines
  away. `drawScene.ts` had documented the hazard in a comment since the cache landed; nothing checked
  for it.

  The rule is narrow on purpose. Only a **periodic** wrapper (`sin`, `cos`, `mod`) counts, because only
  those provably never settle. `rotation = shake(bad, clock)` is `bad ? sin(t*40)*4 : 0` -- exactly 0 at
  rest, and every draggable object carries one -- and a `clamp` decay is constant past its delay. Both
  pay the composition once and hit the cache forever after; flagging them would have fired the warning
  on scenes that were perfectly fine. `opacity` is likewise ignored: it is applied at blit time and is
  deliberately absent from the cache signature, so a pure fade reuses the bitmap.

  **And the cache the warning talks about now covers leaves.** `paintLeaf` isolated a filtered shape
  off-screen exactly like a container, but passed no cache slot -- so `circle ... filter glow`, the shape a
  decorated scene is full of, re-composited on EVERY frame whether or not anything moved: 360 content draws
  over 60 frames, where a filtered group standing still drew 0. It now takes the same slot (and
  `filterCacheSlot` still refuses to cache what may change: a bound text, a shape with an animated `draw`).

  **The cache is also keyed per instance, not per item id.** A symbol's items are the same objects for every
  instance of it, so eight lanterns from one symbol shared one entry and thrashed it -- measured at 480
  content draws over 60 frames where 8 was the answer. Now 0 in the steady state, one entry each. Bounded:
  256 baked composites per document, past which a scene keeps drawing the slow way rather than growing
  without a ceiling.

  Two corrections to the rule itself, both measured: the busting channels are DERIVED from the pose channels
  (minus `opacity`, plus the offsets) instead of being retyped -- a hand-kept copy of a list the player owns
  is exactly how `--check` came to size a `reveal` grid on the brush while the engine used the grain -- and
  every ever-growing instant counts, so `sin(time * 2)` and `sin(frame / 10)` are caught alongside `clock`.

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.35.0
  - @flatkit/engine@0.35.0

## 0.34.2

### Patch Changes

- [`71295ca`](https://github.com/flatink/flatkit/commit/71295caa82b73ff6af3ab263c6ce441f4770e291) Thanks [@kaelhem](https://github.com/kaelhem)! - Scratching a fine-grained veil no longer gets slower the more you scratch, and three bounds the last three
  releases had left open.

  **The scratch cost grew with the cells already cleared.** `erase` re-stamped EVERY cleared cell, blurred,
  into a fresh buffer on every frame the set changed -- which is every frame of a stroke. Measured on the
  reported shape (880x404 zone, `brush 36` / `grain 8`, so 5610 cells) with the off-screen renderer:

  ```
                          before      after
  scratching, 70 cells    0.43 ms     0.30 ms   per frame
  scratching, 520         2.07        0.13
  scratching, 2020        1.73        0.22
  scratching, 5610        4.23        0.22
  idle (any count)        0.02        0.02
  ```

  Four milliseconds a frame, paid exactly while the child is scratching -- the one moment smoothness is felt
  -- and growing with the grain they had just been given. The holes are now kept as a persistent mask and
  stamped INCREMENTALLY: a frame draws the handful of cells that just fell, not the thousands already there.
  Flat instead of linear. (Idle frames were already one blit, and stay so.)

  **`revealGrid` is now ONE function**, in the engine, called by the player that ticks the cells and by
  `--check` that tells the author how many to declare. Computing it twice is how they drifted the day `grain`
  arrived, and the array silently lost every write past its end.

  **A `reveal` grid is bounded** (100k cells, never sub-pixel). A `grain` of 0.01 over a full frame asked for
  billions of cells -- each one scanned per pointer move and stamped by `erase` -- which an untrusted
  `.flatpack` is entitled to try. The grid coarsens instead of freezing the tab. The cap matches `fill`'s own,
  so the count `--check` advises is always declarable.

  **`arr = fill(n, v)` is charged to the tick budget by what it WRITES.** The budget counts actions, assuming
  each costs about the same; this one writes up to a hundred thousand slots, so a `repeat` full of them ran
  200k of them under a green ceiling.

  **And two silent numbers named.** A `step` of 0 or less is the one option here that does not fall back: the
  progress may grow by at most `step` px per frame, so nothing ever advanced -- a drill impossible to
  complete, drawing its guide, following the finger, ink empty, `--check` green. A non-positive `tolerance`,
  `brush` or `grain` is the milder cousin: silently replaced by the default, so the number written in the
  source described nothing. Both are reported now.

- Updated dependencies [[`71295ca`](https://github.com/flatink/flatkit/commit/71295caa82b73ff6af3ab263c6ce441f4770e291)]:
  - @flatkit/engine@0.34.2
  - @flatkit/types@0.34.2

## 0.34.1

### Patch Changes

- Updated dependencies [[`faa4b9e`](https://github.com/flatink/flatkit/commit/faa4b9ee71c63c0a006e96465b0210d540a4d661)]:
  - @flatkit/engine@0.34.1
  - @flatkit/types@0.34.1

## 0.34.0

### Minor Changes

- [`f4069b0`](https://github.com/flatink/flatkit/commit/f4069b076c3dd4149439fa039a7e02446e83e3ca) Thanks [@kaelhem](https://github.com/kaelhem)! - `arr = fill(n, v)`, a `turn` gesture that can name where it presses, and `--check` sizing a `reveal` grid
  the way the engine does.

  **`--check` measured a `reveal` grid on the BRUSH while the player used the GRAIN** (regression from
  0.33.0, where the two were separated). Following the advice declared an array far too short, every write
  past its end was dropped in silence, the fraction climbed normally, and the array stayed at zero -- so a
  restored session came back with an untouched veil, `--check` green. Measured on an 880x404 zone with
  `brush 36` / `grain 8`: the advice said 300 cells where the engine made 5610. It now sizes on the grain,
  brush as the fallback, and names which one it measured with.

  **`arr = fill(<count>, <value>)`** -- `fill` was only recognised at a declaration, so blanking a grid meant
  one `arr[i] = ...` line per cell (five thousand of them, on a scratch grid). Both arguments are ordinary
  expressions, evaluated when the action runs. It is the ONE array-valued assignment: expressions are scalar,
  so `fill` is still not a function you can call inside one.

  Writing a `reveal`'s `cells` array WHOLE now re-seats the coverage behind it, so `grid = fill(n, 0)` really
  is "start this activity over" -- without that, the array would read zero while the interactor still held
  the cells, and the next grab would put them all back. (An ELEMENT write, `grid[i] = 0`, stays cosmetic on
  purpose: the gesture itself makes thousands of them.)

  **`{ "type": "turn", "target", "angle", "from": [x, y] }`** -- the semantic gesture presses the object
  where the engine finds it, which is whatever is TOPMOST there; two clock hands overlapping at noon
  therefore both go to the one on top. `from` says where the finger lands. (Low-level `down`/`move`/`up`
  already drove rotation interactors and picked the target under the press point -- the trap is that a move
  staying collinear with the pivot writes the angle that was already there, so the object looks stuck. Both
  facts are in the tooling doc now, with a test each.)

### Patch Changes

- Updated dependencies [[`f4069b0`](https://github.com/flatink/flatkit/commit/f4069b076c3dd4149439fa039a7e02446e83e3ca)]:
  - @flatkit/types@0.34.0
  - @flatkit/engine@0.34.0

## 0.33.1

### Patch Changes

- [`cf624b3`](https://github.com/flatink/flatkit/commit/cf624b30715da754fe4204251ea10291de35afa7) Thanks [@kaelhem](https://github.com/kaelhem)! - A seeded document brings its gestures back with it, and `setVar` is the write it always claimed to be.

  `doc.variables` is how a host restores an activity where a reader left it, and it carried everything that
  IS a variable. The state a gesture keeps BESIDE them did not come back: a continuous `trace`'s progress was
  cleared on load and only re-seated by a write, so a restored trace said "three quarters done", drew its ink
  to three quarters, and sent the finger back to the start on the first touch. A `reveal`'s scratched grid
  was worse off -- nothing could read it back at all, so a reader who had scratched half an image returned to
  find it intact.

  Both now re-seat themselves on the seed, once per `load()` (and at construction), before the first paint:

  - a continuous `trace` resumes at its own progress variable -- ink, pen-tip marker and finger together;
  - a `reveal ... { cells <array> }` grid is rebuilt from the array it writes, `erase` included, with the
    fraction recomputed from the cells. One format, both directions: seed the array you saved and the veil
    comes back scratched where it was.

  And the public `setVar` now takes the SAME path as an assignment written in the scene. The two used to
  differ, and the difference was invisible from outside: the variable moved, the stroke was inked to the new
  value, and only the pen-tip marker stayed at the start. A host restoring a trace by rewriting its variable
  after construction hit exactly that.

- Updated dependencies [[`cf624b3`](https://github.com/flatink/flatkit/commit/cf624b30715da754fe4204251ea10291de35afa7)]:
  - @flatkit/types@0.33.1
  - @flatkit/engine@0.33.1

## 0.33.0

### Minor Changes

- [`15bc1f0`](https://github.com/flatink/flatkit/commit/15bc1f0f433b948ed5c993b0d0131ce89d934580) Thanks [@kaelhem](https://github.com/kaelhem)! - `trace` can be a TRACE and not a cursor (`step`), `erase` stops looking like stamps, and a scratched veil
  stops recompositing forever.

  **`trace <p> along <G> { step <px> }`** -- without it, the progress is where the finger PROJECTS on the
  path, so a press three pixels from the finish reports the exercise as finished (measured: 1.000 on a
  straight line, from one press and a 10 px move). That is a cursor: right for a slider, wrong for a writing
  drill. `step` says the progress may only grow through what the finger passes, by at most `step` px of arc
  length between two frames, and everything else follows from that single rule:

  - it must be ENTERED at an end -- nothing else is within `step` of a progress of 0 (that same press now
    advances nothing);
  - a leap ahead does not count: the progress waits where it was until the finger comes back within `step`;
  - the progress belongs to the OBJECT, not to the grab, so lifting the finger and putting it back where it
    was RESUMES (a child stops mid-letter). Putting it back somewhere else advances nothing.

  `both ends` makes the far end a legal entry too -- the run is measured from the end that was entered, and
  the direction locks on the first advance, so a closed shape can be walked either way round. `point <x>,<y>`
  writes the WORLD position of the current progress into two variables: the pen tip while tracing, and where
  to put the finger back after a pause. It is placed on the path's start as soon as the scene loads, so a
  marker never sits at the origin. Restart with `<p> = 0` -- the variable stays the truth, and the trace
  re-seats itself on what the scene wrote.

  **`reveal ... { brush <px> grain <px> }`** -- the two numbers are now independent: `brush` is how wide a
  touch clears (a gameplay setting), `grain` how finely the runtime tracks and rubs it out (absent = the
  brush, i.e. the old behavior). A wide finger with a fine edge is `brush 48` + `grain 12`. And the erased
  edge is BLURRED rather than cut: hard discs read as stamps -- a lone touch left a perfect circle and the
  border of a scratched area was a scallop at the mesh of the grid. `--check` warns when the grain is coarser
  than the brush, where a touch can fall between two cell centres and clear nothing.

  **A scratched `erase` composite is cached** on its screen placement and the number of cells that have
  fallen. Until now, one cleared cell meant that for the rest of the activity every frame paid a bbox
  accumulation over the subtree, an off-screen canvas, a full re-render of the veil, N arcs and a blit back --
  while the child was busy elsewhere on the board. While the scratching happens the work still happens; the
  moment it stops, a frame is one blit.

  Also: `both ends` without `step` is reported (it picks which end a run is measured from, and a `trace`
  without `step` has no run), and the `point` variables count as used by the dead-global pass.

### Patch Changes

- Updated dependencies [[`15bc1f0`](https://github.com/flatink/flatkit/commit/15bc1f0f433b948ed5c993b0d0131ce89d934580)]:
  - @flatkit/types@0.33.0
  - @flatkit/engine@0.33.0

## 0.32.0

### Minor Changes

- [`dfdb538`](https://github.com/flatink/flatkit/commit/dfdb5389fd7aca3b248b26c3e2c8c53ccbe0e6d4) Thanks [@kaelhem](https://github.com/kaelhem)! - `draw`: a stroke drawn by ARC LENGTH, and `reveal ... erase`: a veil the runtime rubs out.

  **`draw <to> [from <start>]` on a shape** sets how much of its outline is stroked, as a fraction of the
  path's arc length. A quoted value is an expression re-evaluated per frame, so ink appears behind a finger:

  ```
  path "M60 300C220 120 340 480 500 300" nofill stroke #2255ff 18 cap round draw "progress" nohit
  ```

  The measure is the one `samplePathAt` / `projectToPath` walk -- so a `trace` interactor's progress on the
  same path data puts the ink exactly where the finger is (a `scaleX`-driven mask ties it to screen x, which
  on a steep slope drifted by two stroke widths on the reported template). `from` opens a window (comet
  trail). Subpaths are traversed in order, the first drawn whole before the next starts. It trims the STROKE
  only: fill, gradient box, bbox and hit shape stay those of the whole path. `flatc --check` reports a `draw`
  on a shape with no `stroke`, which would animate nothing.

  **`reveal <p> { brush <px> erase }`** makes the runtime rub the grabbed object out where it was scratched:
  a scratch card is a grey rectangle and nothing else -- no grid of tiles to author, no per-cell artwork. One
  disc per cleared cell, so what disappears is exactly what the fraction counts. A `mask` layer cannot do
  this (its matter is an even-odd clip path, where two overlapping stamps cancel instead of accumulating),
  and nothing in the language creates a stamp at the pointer.

  **`reveal <p> { cells <array> }`** hands out the grid behind the fraction -- WHERE it was scratched
  (`cells[row * cols + col] = 1`, `cols = ceil(zone_width / brush)` over the object's world bbox) -- for a
  scene that must react to the uncovered area rather than just show it. `--check` states the grid's exact
  geometry and the `fill(N, 0)` to declare whenever the array's length disagrees.

  **A `reveal` target is now grabbable over its whole ZONE**, whatever its content currently looks like. A
  veil whose cells were faded to `opacity 0` stopped being hittable, so the scratching worked on the first
  stroke and then stalled on the cleared area -- invisible in a static render, visible only in a replayed
  `down/move/up` script.

  **A variable read only by a LEAF is no longer reported "never used"**: a dynamic text's `bind`, a
  text-on-path's animated `start`/`spacing`, a shape's `draw`. They read variables every frame but carry no
  channel and no action, so the dead-global pass -- which walked only those two -- called them dead.

### Patch Changes

- Updated dependencies [[`dfdb538`](https://github.com/flatink/flatkit/commit/dfdb5389fd7aca3b248b26c3e2c8c53ccbe0e6d4)]:
  - @flatkit/types@0.32.0
  - @flatkit/engine@0.32.0

## 0.31.1

### Patch Changes

- [`fda522f`](https://github.com/flatink/flatkit/commit/fda522ff266d62877539b88abaa63ab24b894a82) Thanks [@kaelhem](https://github.com/kaelhem)! - "never used" now reads the Doc, not a text rebuilt from it — 20 false warnings became 5 true ones.

  The dead-global pass counted a variable's occurrences in the text `scopeProgram` rebuilds from the Doc.
  That text only carries the `object` blocks of items at the ROOT of a scope, so on a composed program whose
  draggables live inside element groups most of them were simply absent: measured on a 210-line generated
  activity, 3 blocks out of 11 survived the round-trip, and every variable read only in the other 8 came back
  "never used". Twenty warnings, all false, on a program where nothing was wrong.

  It now walks the Doc itself (`forEachExpression` / `forEachAction`, which descend the whole tree and the
  symbols), plus the modifier targets and the interactor slots. That last one was the reported case: an
  interactor writes through named SLOTS and guards itself with `enabled`, and neither is an expression the
  walkers see — so `drag x, y { enabled over == 0 }` never counted as reading `over`.

  On the reported program: 20 warnings -> 5, and those 5 are genuine (each name appears exactly once in the
  source, its own declaration).

- Updated dependencies [[`fda522f`](https://github.com/flatink/flatkit/commit/fda522ff266d62877539b88abaa63ab24b894a82)]:
  - @flatkit/types@0.31.1
  - @flatkit/engine@0.31.1

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

### Patch Changes

- Updated dependencies [[`dd832fe`](https://github.com/flatink/flatkit/commit/dd832fe9aa6b0edd62ab58d9e76bba46081dde8e)]:
  - @flatkit/types@0.31.0
  - @flatkit/engine@0.31.0

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

- Updated dependencies [[`9371b38`](https://github.com/flatink/flatkit/commit/9371b387b67b6f26dc4058bcd366dd3125013506)]:
  - @flatkit/types@0.30.2
  - @flatkit/engine@0.30.2

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

- Updated dependencies [[`85781eb`](https://github.com/flatink/flatkit/commit/85781eb40378d4d7413f291e46ea7c0773b66866)]:
  - @flatkit/types@0.30.1
  - @flatkit/engine@0.30.1

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

### Patch Changes

- Updated dependencies [[`ba7878a`](https://github.com/flatink/flatkit/commit/ba7878a9f2117268f44549a254b9202957a83cf9)]:
  - @flatkit/types@0.30.0
  - @flatkit/engine@0.30.0

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

- Updated dependencies [[`307c60e`](https://github.com/flatink/flatkit/commit/307c60e34ab9022981ffc7f533bf87ba4f790364), [`6bb9674`](https://github.com/flatink/flatkit/commit/6bb9674e354a1b47b7590adc01e0280b63ffbc9f), [`9f6eba5`](https://github.com/flatink/flatkit/commit/9f6eba54be796ee24a6eb83b15a7b113176724cc)]:
  - @flatkit/types@0.29.2
  - @flatkit/engine@0.29.2

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

- Updated dependencies [[`83bea35`](https://github.com/flatink/flatkit/commit/83bea35551dd84ab48cba834df815502a9766664), [`8f9837e`](https://github.com/flatink/flatkit/commit/8f9837ee38755d4e1cf1836f021d3089a115b710)]:
  - @flatkit/types@0.29.1
  - @flatkit/engine@0.29.1

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

### Patch Changes

- Updated dependencies [[`96c4f4e`](https://github.com/flatink/flatkit/commit/96c4f4e2d4871ed398e5551bd13e423ec8ce93e3)]:
  - @flatkit/engine@0.29.0
  - @flatkit/types@0.29.0

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

### Patch Changes

- Updated dependencies [[`1d72dd7`](https://github.com/flatink/flatkit/commit/1d72dd7f0ee3bda7222209d80f142b2087654912)]:
  - @flatkit/engine@0.28.0
  - @flatkit/types@0.28.0

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

### Patch Changes

- Updated dependencies [[`7b14d89`](https://github.com/flatink/flatkit/commit/7b14d894b8e101a411851811b129950488602d93)]:
  - @flatkit/engine@0.27.0
  - @flatkit/types@0.27.0

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

### Patch Changes

- Updated dependencies [[`3d3e34b`](https://github.com/flatink/flatkit/commit/3d3e34b9b37e59068992d422924d112c573ce832)]:
  - @flatkit/engine@0.26.0
  - @flatkit/types@0.26.0

## 0.25.0

### Minor Changes

- [`c60b730`](https://github.com/flatink/flatkit/commit/c60b7302466c7643824335a28b0f9c1743cc3604) Thanks [@kaelhem](https://github.com/kaelhem)! - Warn when a program never declares `size`.

  The line is REQUIRED by the format, and the compiler silently defaulted it to 800x600 - so a document
  laid out for one canvas was drawn on another, with everything past the edge clipped away and nothing to
  say so. Measured cost of that silence: a generator omitted the line across its entire corpus for months,
  undetected. A warning rather than an error, because checking a fragment on its own is legitimate.

### Patch Changes

- Updated dependencies [[`c60b730`](https://github.com/flatink/flatkit/commit/c60b7302466c7643824335a28b0f9c1743cc3604)]:
  - @flatkit/engine@0.25.0
  - @flatkit/types@0.25.0

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

### Patch Changes

- Updated dependencies [[`79faa20`](https://github.com/flatink/flatkit/commit/79faa206f6180540615b007b2880aec0c8c5a373)]:
  - @flatkit/engine@0.24.0
  - @flatkit/types@0.24.0

## 0.23.0

### Minor Changes

- [`f4bb7b1`](https://github.com/flatink/flatkit/commit/f4bb7b1de799f0a6248cb600ceab255ce9028a75) Thanks [@kaelhem](https://github.com/kaelhem)! - Close the silent traps found while writing activity generators against 0.21 (host integration).

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

### Patch Changes

- Updated dependencies [[`f4bb7b1`](https://github.com/flatink/flatkit/commit/f4bb7b1de799f0a6248cb600ceab255ce9028a75)]:
  - @flatkit/engine@0.23.0
  - @flatkit/types@0.23.0

## 0.22.0

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.22.0
  - @flatkit/engine@0.22.0

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

### Patch Changes

- Updated dependencies [[`f0dac30`](https://github.com/flatink/flatkit/commit/f0dac3024b76c5e894fc7b720301e24f021ba1c3)]:
  - @flatkit/engine@0.21.0
  - @flatkit/types@0.21.0

## 0.20.2

### Patch Changes

- [`cb8720d`](https://github.com/flatink/flatkit/commit/cb8720ded50eab1d7296ee4aa5fb61379effdfd5) Thanks [@kaelhem](https://github.com/kaelhem)! - fix(hit): a mask shaped by text/image no longer crashes selection

  `pointInMask` read `(it as Region).path` for any non-container mask material. A mask shaped by a **text** or **image** (e.g. `mask layer { text "…" }`) has no `.path`, so the hit test threw `Cannot read properties of undefined (reading 'subpaths')`. Because a masked layer is point-tested before any position check, **every click** on such a scene crashed. Text/image mask material now clips by its box (like the rest of the hit test); containers stay non-blocking.

- Updated dependencies []:
  - @flatkit/types@0.20.2
  - @flatkit/engine@0.20.2

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

- Updated dependencies [[`2352dee`](https://github.com/flatink/flatkit/commit/2352dee487d5ad72b4b269ede51f6212194d6e08)]:
  - @flatkit/types@0.20.1
  - @flatkit/engine@0.20.1

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

### Patch Changes

- Updated dependencies [[`fb31814`](https://github.com/flatink/flatkit/commit/fb31814f34ad26f45e0a5c7780f5baecc7ddabed)]:
  - @flatkit/types@0.20.0
  - @flatkit/engine@0.20.0

## 0.19.12

### Patch Changes

- [`05e9ce9`](https://github.com/flatink/flatkit/commit/05e9ce9e91c1edbfef37cb123854bb6b1710e0fd) Thanks [@kaelhem](https://github.com/kaelhem)! - docs: each published package now ships a README, so its npm page is no longer blank -- a short pitch,
  install line, and a minimal usage snippet (player: FlatPlayer + loadEmbeddedFonts; compiler: flatc + the
  compileFlatpack programmatic entry; engine: the per-module subpath imports; types: typing a Doc). This
  release also publishes the package metadata that moved to the flatink GitHub org (the `repository` link on
  the npm page), which had only been committed, not yet published.
- Updated dependencies [[`05e9ce9`](https://github.com/flatink/flatkit/commit/05e9ce9e91c1edbfef37cb123854bb6b1710e0fd)]:
  - @flatkit/types@0.19.12
  - @flatkit/engine@0.19.12

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

- Updated dependencies [[`d257d17`](https://github.com/flatink/flatkit/commit/d257d172db96c10659b19a9d0e66f086f917fd7b)]:
  - @flatkit/types@0.19.11
  - @flatkit/engine@0.19.11

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

- Updated dependencies [[`01b2d05`](https://github.com/flatink/flatkit/commit/01b2d05f70187043b6218cb4ef80ab18accd5c7e)]:
  - @flatkit/types@0.19.10
  - @flatkit/engine@0.19.10

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

- Updated dependencies [[`1911179`](https://github.com/flatink/flatkit/commit/19111798c155c2c9a2d479eeedd6c2046c16202c)]:
  - @flatkit/types@0.19.9
  - @flatkit/engine@0.19.9

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

- Updated dependencies [[`7569c6b`](https://github.com/flatink/flatkit/commit/7569c6b1b406ad9a2b618fc1d89b9514580d6023)]:
  - @flatkit/types@0.19.8
  - @flatkit/engine@0.19.8

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

- Updated dependencies [[`a4f4b8d`](https://github.com/flatink/flatkit/commit/a4f4b8d468b8e92d87f87c1ca8980ecc9ecab480)]:
  - @flatkit/types@0.19.7
  - @flatkit/engine@0.19.7

## 0.19.6

### Patch Changes

- [`e1b06e2`](https://github.com/flatink/flatkit/commit/e1b06e2cc328be30b932b5b3d725c068bde89eff) Thanks [@kaelhem](https://github.com/kaelhem)! - FlatInk now tolerates several statements on one line: `a = 1  b = 2` parses as two
  statements instead of erroring with "two statements on one line". The parser splits
  at the boundary of a second assignment/binding (the [#1](https://github.com/flatink/flatkit/issues/1) LLM footgun) in action bodies
  and channel bindings, so lint and compile both accept it. Single-expression slots
  (e.g. a `send` payload) still reject a stray `=`. The language card now states the
  one-statement-per-line rule explicitly to steer generators toward the canonical form.
- Updated dependencies [[`e1b06e2`](https://github.com/flatink/flatkit/commit/e1b06e2cc328be30b932b5b3d725c068bde89eff)]:
  - @flatkit/types@0.19.6
  - @flatkit/engine@0.19.6

## 0.19.5

### Patch Changes

- [`48d96ae`](https://github.com/flatink/flatkit/commit/48d96ae1ca00de5f05cad2f29a4cd9d290ea1983) Thanks [@kaelhem](https://github.com/kaelhem)! - `flatc --check` success message no longer contains the word "error".

  The success line was `flatc: no errors` -- which contains "errors", so a tool or agent that greps the output for "error" to detect a failure gets a false positive (it reads success as failure). The line is now `flatc: check passed` (and surfaces a `N warning(s)` count when there are non-blocking warnings). The real failure signal stays the exit code (non-zero on error); on a failure the per-line report still prints "error" to stderr, so grepping for "error" now matches only genuine failures.

- Updated dependencies [[`48d96ae`](https://github.com/flatink/flatkit/commit/48d96ae1ca00de5f05cad2f29a4cd9d290ea1983)]:
  - @flatkit/types@0.19.5
  - @flatkit/engine@0.19.5

## 0.19.4

### Patch Changes

- [`3481147`](https://github.com/flatink/flatkit/commit/34811472904012c35136957681d41c12ac5540d8) Thanks [@kaelhem](https://github.com/kaelhem)! - `flatc --check <library>.flat` now lints an asset library (per-symbol), instead of choking on it as a scene.

  `--check` always routed through the program parser, so a `.flat` lib (symbols/params/layers, not a scene) failed with a cascade of `[scene] unexpected statement "symbol"`; the only way to lint an asset was to compile a preview and call the API by hand. A `.flat` first positional is now detected (like `--preview` does) and parsed with `parseFlatLib`, its symbols merged into an empty-scene Doc, and run through the SAME `lintDoc`, so every existing check (params-in-`expr`, undeclared color param in a paint, unknown functions/objects) applies for free, with the identical `[scope] line:col: level: msg` format and exit code (non-zero on error, warnings non-blocking). Several `.flat` can be passed and are merged (`flatc a.flat b.flat --check`), and `--watch` works. The program path (`flatc x.flatink --check`, with `.flat` libs as args) is unchanged.

- Updated dependencies [[`3481147`](https://github.com/flatink/flatkit/commit/34811472904012c35136957681d41c12ac5540d8)]:
  - @flatkit/types@0.19.4
  - @flatkit/engine@0.19.4

## 0.19.3

### Patch Changes

- [`1d13505`](https://github.com/flatink/flatkit/commit/1d13505b4e9c9354136fb188d493e23af24957bb) Thanks [@kaelhem](https://github.com/kaelhem)! - `flatc --check` now flags a `color` param used as a paint that the symbol doesn't declare.

  A gradient stop (`0:teinte@0.8`), a `tint <param> <amount>`, or a `fill`/`stroke <param>` that references an undeclared (or mistyped) color param silently falls back to the literal hex at render -- a "dead recolor": the asset looks fine but the picker does nothing. The lint now walks each symbol's paints and warns on a color-param reference the owning symbol doesn't declare, scoped to that symbol (a `teinte` declared in symbol A doesn't silence the same name in symbol B). Non-blocking (a warning), so it can only surface a latent bug, never break a build. Complements the earlier "the lint knows a symbol's params in its expr" fix.

- Updated dependencies [[`1d13505`](https://github.com/flatink/flatkit/commit/1d13505b4e9c9354136fb188d493e23af24957bb)]:
  - @flatkit/types@0.19.3
  - @flatkit/engine@0.19.3

## 0.19.2

### Patch Changes

- [`bcb9eed`](https://github.com/flatink/flatkit/commit/bcb9eede3f20ee4cc2bda52e788013289bafb711) Thanks [@kaelhem](https://github.com/kaelhem)! - Harden the renderer against a crafted gradient in an untrusted `.flatpack` (security pass).

  The player renders untrusted `.flatpack` JSON and `sanitizeDoc` does not validate paint stops, so a crafted gradient could CRASH the render: a stop `param: "__proto__"` made the per-instance color lookup return `Object.prototype`, which the color helpers (`splitAlpha`/`withAlpha`) then threw on; a non-string color or a non-finite `offset`/`alpha` (e.g. `offset: "x"` -> NaN) made `addColorStop` throw. `resolveColorRef` now uses an OWN string value only (a prototype hit or non-string falls back to the literal hex) and ignores a non-finite alpha; the stop loop clamps a non-finite offset. A malformed gradient now degrades to a valid color instead of throwing. No effect on well-formed gradients (literal or param).

- Updated dependencies [[`bcb9eed`](https://github.com/flatink/flatkit/commit/bcb9eede3f20ee4cc2bda52e788013289bafb711)]:
  - @flatkit/types@0.19.2
  - @flatkit/engine@0.19.2

## 0.19.1

### Patch Changes

- [`d4e9590`](https://github.com/flatink/flatkit/commit/d4e9590e8b06fc7268c4930940ff86e892469ffc) Thanks [@kaelhem](https://github.com/kaelhem)! - Fix a `flatc --check` false positive: a symbol's own `params` are now known variables in its `expr`.

  A symbol can read an exposed `param` (or state param) inside a channel expression -- `expr scaleX "1 - stationnaire"` -- and the runtime and `flatc --preview` resolve it (the param is injected into the instance scope). But the semantic linter did not put those params in the scope's known ids, so it wrongly reported `unknown variable "stationnaire"`. `docLintContext` now adds the current scope's symbol params + state params, resolved from the scope's `editPath` so they are added ONLY to that symbol (a param named in symbol A can't mask a real typo of the same name in symbol B). Monotone-safe: it only adds valid names, so it can only remove false positives -- a genuinely undeclared id is still flagged.

- Updated dependencies [[`d4e9590`](https://github.com/flatink/flatkit/commit/d4e9590e8b06fc7268c4930940ff86e892469ffc)]:
  - @flatkit/types@0.19.1
  - @flatkit/engine@0.19.1

## 0.19.0

### Minor Changes

- [`c53a7b3`](https://github.com/flatink/flatkit/commit/c53a7b3471dae0e1bfef923cdab861cc0cef5284) Thanks [@kaelhem](https://github.com/kaelhem)! - Symbol COLOR params can now drive gradient STOPS and a TINT, not only a solid `fill <param>`.

  Recolorable generic effects (halos, glows, gradients) live in gradients and tints, but a `param color` could only feed a solid fill -- inside a `radial(...)`/`linear(...)` stop or a `tint`, the color was a baked hex and the param was dead. This generalizes the existing `fill <param>` to every place a color is accepted.

  - DSL: a gradient stop accepts a param ref with an optional alpha override -- `radial(0.5, 0.5, 0.5, 0:teinte@0.8, 1:teinte@0)` -- next to literal `0:#ffe9a8cc` stops; and `tint <param> <amount>` binds a tint hue to a param. The alpha is needed because a color param is a 6-digit hue (a halo wants "same hue, alpha fading 0.8 -> 0"). Round-trips through `flatFormat`.
  - Model: `Stop` gains `param?` + `alpha?`, `Tint` gains `param?` -- a unified "color ref (hex | param + alpha)". A new `resolveColorRef` is the single primitive behind solid fill, gradient stops and tint.
  - Player: stops and tint resolve per instance against the same `colorParams` scope as `fill <param>`; the tint is resolved to a concrete color before the off-screen composite, so the filter-composite cache busts when the param changes.
  - Engine: the merge key (`paintKey`) distinguishes a param stop from a literal one (no wrong merges); stop/tint interpolation carries the param binding.

  Backward compatible: a stop/tint with no param is an ordinary literal -- every existing hex gradient and tint renders pixel-for-pixel as before. The `@` character is now a token (the stop alpha marker); it was previously ignored, and no `.flat` source used it.

### Patch Changes

- Updated dependencies [[`c53a7b3`](https://github.com/flatink/flatkit/commit/c53a7b3471dae0e1bfef923cdab861cc0cef5284)]:
  - @flatkit/types@0.19.0
  - @flatkit/engine@0.19.0

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

### Patch Changes

- Updated dependencies [[`9772d59`](https://github.com/flatink/flatkit/commit/9772d592750f27dd482de0776464e64287dae552)]:
  - @flatkit/types@0.18.0
  - @flatkit/engine@0.18.0

## 0.17.3

### Patch Changes

- [`a8af28a`](https://github.com/flatink/flatkit/commit/a8af28a5825cacf5e72acbe81cf8e01b49dd2140) Thanks [@kaelhem](https://github.com/kaelhem)! - Warm the hit-test path cache so the FIRST interaction isn't a cold-start jolt. The 0.17.2 cache removed the recurring mouse lag, but on an empty cache the very first pointermove/pointerdown still flattened every hittable Bezier path in the scene at once (~one-time stall). The player now pre-flattens all hittable region/cel-material paths on `requestIdleCallback` after the first paint (when input is enabled), so that one-time cost lands during load instead of on the user's first gesture. Also exposes `FlatPlayer.warmHitCache()` and a standalone `warmHitCache(doc)` export for hosts that want to trigger it explicitly (or run in a browser without `requestIdleCallback`).

- Updated dependencies [[`a8af28a`](https://github.com/flatink/flatkit/commit/a8af28a5825cacf5e72acbe81cf8e01b49dd2140)]:
  - @flatkit/types@0.17.3
  - @flatkit/engine@0.17.3

## 0.17.2

### Patch Changes

- [`0955eec`](https://github.com/flatink/flatkit/commit/0955eecfc05743b2fb30fb5a4fcea6fa12c0ea10) Thanks [@kaelhem](https://github.com/kaelhem)! - Fix the remaining pointer lag: memoize `pathToPolygons`. Hit-testing flattened every region's Bezier curves into polygons on every item on every `pointermove`, re-subdividing identical paths and allocating fresh rings each time — heavy CPU plus massive GC churn (the dominant cost in the browser profile). A path's geometry is invariant (dynamic geometry produces new path objects, never in-place mutation), so the default-tolerance flatten is now cached in a `WeakMap<Path, Polygon[]>` keyed by path identity. The hot hit callers (`hitRegion`, `pointInMask`, `regionHit`) reuse the same path reference across moves → cache hits, no re-flatten, no per-move allocation. Hit results are identical (pure memoization). The returned rings are now shared — treat them as read-only.

- Updated dependencies [[`0955eec`](https://github.com/flatink/flatkit/commit/0955eecfc05743b2fb30fb5a4fcea6fa12c0ea10)]:
  - @flatkit/types@0.17.2
  - @flatkit/engine@0.17.2

## 0.17.1

### Patch Changes

- [`468c15d`](https://github.com/flatink/flatkit/commit/468c15d3d69c5b4da621701ca861213a1b91dbe5) Thanks [@kaelhem](https://github.com/kaelhem)! - Fix pointer-move lag: the player rendered a full frame synchronously on every `pointermove` (which fire at 125–1000 Hz), on top of the 60 fps playback loop, saturating the main thread. Now the move render is coalesced — while a render loop (playback or a transition) is already running it repaints the next frame instead of per-event, and a static scene still renders synchronously so the cursor follows immediately. Also skip the per-move expression-cache invalidation when nothing reads `mouse.x`/`mouse.y` (a drag self-invalidates, so this is safe). Active-drag latency is unchanged (still synchronous).

- Updated dependencies [[`468c15d`](https://github.com/flatink/flatkit/commit/468c15d3d69c5b4da621701ca861213a1b91dbe5)]:
  - @flatkit/types@0.17.1
  - @flatkit/engine@0.17.1

## 0.17.0

### Minor Changes

- [`3de508a`](https://github.com/flatink/flatkit/commit/3de508a13fd44e39a2f92c7f0b60d1886928d097) Thanks [@kaelhem](https://github.com/kaelhem)! - States no longer freeze nested timelines. A symbol's `states` block used to pin its whole subtree's frame, so any timeline nested inside a state (a sub-loop, an idle) froze. The pinned POSE frame is now decoupled from the playback CLOCK handed to children: a state pins the symbol's own pose while the timelines nested inside it keep playing. This lets a state host a running loop (e.g. a `marche`/`panique` cycle selector) or an idle that runs during a state — authored entirely in keyframes, no `expr` scripting. Looping is opt-in: a frozen pose with no nested loop stays frozen, so existing state assets render unchanged.

### Patch Changes

- Updated dependencies [[`3de508a`](https://github.com/flatink/flatkit/commit/3de508a13fd44e39a2f92c7f0b60d1886928d097)]:
  - @flatkit/types@0.17.0
  - @flatkit/engine@0.17.0

## 0.16.3

### Patch Changes

- [`c32026c`](https://github.com/flatink/flatkit/commit/c32026ca3e3bad35612c3e06b127a99b89850636) Thanks [@kaelhem](https://github.com/kaelhem)! - fix(player): two pointer-input edge cases (from the security/quality review)

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

- Updated dependencies [[`ecc39a2`](https://github.com/flatink/flatkit/commit/ecc39a2c3b7d8354e5e8b11bc964566958fee45d)]:
  - @flatkit/engine@0.16.2
  - @flatkit/types@0.16.2

## 0.16.1

### Patch Changes

- Updated dependencies [[`6c386b0`](https://github.com/flatink/flatkit/commit/6c386b09b941cd6d53cb32d7aa1a419f971d9434)]:
  - @flatkit/engine@0.16.1
  - @flatkit/types@0.16.1

## 0.16.0

### Minor Changes

- [`70f46c9`](https://github.com/flatink/flatkit/commit/70f46c949f21099833f70b27428374917a947112) Thanks [@kaelhem](https://github.com/kaelhem)! - feat(player): mouse-wheel scroll via `mouse.wheel` (+ a `wheel` headless gesture)

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

- [`2d23d0b`](https://github.com/flatink/flatkit/commit/2d23d0bfab98a02f79af4dd03e360c84bee91318) Thanks [@kaelhem](https://github.com/kaelhem)! - fix(player): defer `click` to release with a movement threshold (tap vs drag)

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

- [`deb96f0`](https://github.com/flatink/flatkit/commit/deb96f01d596fa8a082366021adcb415e85a706c) Thanks [@kaelhem](https://github.com/kaelhem)! - fix(player): sync `mouse.x/y` on pointer-down/up so press/click/release handlers read the real pointer

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

### Patch Changes

- Updated dependencies [[`fc226cc`](https://github.com/flatink/flatkit/commit/fc226ccaa2853fb1e6441a1943eabf9ba1abd009)]:
  - @flatkit/types@0.15.0
  - @flatkit/engine@0.15.0

## 0.14.5

### Patch Changes

- [`eb612eb`](https://github.com/flatink/flatkit/commit/eb612eb3c5e6712b40c6b104a450b23b8c75e2ea) Thanks [@kaelhem](https://github.com/kaelhem)! - Perf pass on the player's hot eval/resolve path (profiled: object construction dominated ~47% of CPU on a
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

- Updated dependencies [[`eb612eb`](https://github.com/flatink/flatkit/commit/eb612eb3c5e6712b40c6b104a450b23b8c75e2ea)]:
  - @flatkit/engine@0.14.5
  - @flatkit/types@0.14.5

## 0.14.4

### Patch Changes

- [`0aca995`](https://github.com/flatink/flatkit/commit/0aca99524deb94299915d6ac9cee2d0650fc2890) Thanks [@kaelhem](https://github.com/kaelhem)! - Perf: the `every frame` script interpreter no longer re-parses expressions and rebuilds the evaluation
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

- Updated dependencies [[`0aca995`](https://github.com/flatink/flatkit/commit/0aca99524deb94299915d6ac9cee2d0650fc2890), [`0aca995`](https://github.com/flatink/flatkit/commit/0aca99524deb94299915d6ac9cee2d0650fc2890)]:
  - @flatkit/engine@0.14.4
  - @flatkit/types@0.14.4

## 0.14.3

### Patch Changes

- [`1bb1ca3`](https://github.com/flatink/flatkit/commit/1bb1ca3b6d5c82c19a1a9d6b172d799895170f06) Thanks [@kaelhem](https://github.com/kaelhem)! - Perf: a container/leaf whose resolved `opacity` is `<= 0.01` is now skipped at render — its whole subtree
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

- Updated dependencies [[`bd0fdfb`](https://github.com/flatink/flatkit/commit/bd0fdfb92aa159be0841c3fd1a591a084c3c59e5)]:
  - @flatkit/engine@0.14.1
  - @flatkit/types@0.14.1

## 0.14.0

### Minor Changes

- [`5dd00af`](https://github.com/flatink/flatkit/commit/5dd00aff5be3a3c495d863642cab71586db3cdb3) Thanks [@kaelhem](https://github.com/kaelhem)! - Two more "silent at runtime" footguns from the field, plus a new monotone clock:

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

- Updated dependencies [[`5dd00af`](https://github.com/flatink/flatkit/commit/5dd00aff5be3a3c495d863642cab71586db3cdb3)]:
  - @flatkit/engine@0.14.0
  - @flatkit/types@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [[`7cc0ece`](https://github.com/flatink/flatkit/commit/7cc0ece3c04b7f270757efbe34550d5094340f3d)]:
  - @flatkit/engine@0.13.0
  - @flatkit/types@0.13.0

## 0.12.1

### Patch Changes

- Updated dependencies []:
  - @flatkit/types@0.12.1
  - @flatkit/engine@0.12.1

## 0.12.0

### Minor Changes

- [`eeecbce`](https://github.com/flatink/flatkit/commit/eeecbceb50cca47f99e3ad1599cfa39b65acfce5) Thanks [@kaelhem](https://github.com/kaelhem)! - Add a semantic `turn` gesture to headless gesture-replay (`flatc --play`):
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
