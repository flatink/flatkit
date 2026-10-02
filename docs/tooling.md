# Tooling — the `flatc` CLI

`flatc` compiles `.flatink` text into a single `.flatpack`, and helps you **see**, **test**, and
**ship** scenes. Install with `pnpm add -D @flatkit/compiler` (or `pnpm flatc …` in this repo).
`flatc --help` lists everything.

## Files

| File | What |
|---|---|
| `.flatink` | the program (composition + behavior, the DSL) |
| `.flat` | a visual asset library (symbols), exported by the editor |
| `.flatpack` | the baked, playable `Doc` (JSON) — what the player runs |

```
flatc game.flatink hero.flat -o game.flatpack
```

`.flat` libs in the program's folder are discovered automatically; media declared by
`asset "id" "path" kind` are embedded as `data:` URIs.

> **The extension decides how a file is read**, so it decides what `--check` verifies. A `.flat` is read
> as a bag of symbols: a whole *program* saved under that name has no symbols in it, so `--check` used to
> report "0 symbol(s)" and exit 0 with nothing verified. `flatc` now **refuses** a `.flat` that contains a
> `scene { … }` block or `object` blocks. When checking a program, make sure it is named `.flatink`.
>
> **`--no-libs`** turns off the folder auto-discovery. In a working folder a neighbouring scratch file is
> not a dependency — and when one of them fails to parse, the error now names the file.

## Compile & check

```
flatc <program.flatink> [-o out.flatpack]
flatc <program.flatink> --check      # semantic lint only (exits ≠0 on ERROR; warnings don't block)
flatc <program.flatink> --check --no-libs    # …without pulling in the .flat files sitting next to it
flatc <program.flatink> --watch      # recompile on every change in the folder
flatc <library.flat> [more.flat …] --check   # lint an asset LIB per-symbol (several .flat are merged)
```

### Repairing the mechanical slips — `--fix`

Some errors have exactly ONE possible repair: a separator the author left out. Those diagnostics now
**carry the edit**, and `flatc --fix` applies it, iterating (repairing one error unmasks the next — a
run-on interactor line swallows the statements under it) and re-checking after each pass. It writes only
if the error count strictly DROPS; otherwise it reverts and says so. An auto-fix that is wrong is worse
than none, because it changes code silently.

```
flatc game.flatink --fix --no-libs
flatc: --fix: repaired `at <x>,<y> takes a COMMA between the two coordinates` in game.flatink
flatc: --fix: 2 repair(s) applied to game.flatink · errors 4 → 0
flatc: check passed ✓
```

Four slips are repaired today, all of them a missing separator: `at 12 -16` (the comma), `#` used as a
comment (`//`, and only when the rest of the line holds no brace — otherwise it would comment out the
closing one), two statements on one line, and a run-on interactor block. Anything needing a DECISION — an
unknown event name, a `when <condition>`, a binding at the program level that must name its object — is
reported and left alone.

**From code**, the same repairs without a subprocess — this is the point of carrying them:

```ts
import { checkProgram, repairLoop } from '@flatkit/compiler'

const { text, applied } = repairLoop(srcFromAnLLM, checkProgram(srcFromAnLLM).diagnostics,
                                     (candidate) => checkProgram(candidate).diagnostics)
const after = checkProgram(text)          // ALWAYS re-check: the loop never claims the result is valid
if (!after.ok) regenerate(after.report)   // only now does it cost a model round-trip
```

`repairLoop` is the iteration, as a pure function: it applies, re-checks, and keeps a pass only if the
error count strictly drops — stopping when nothing more applies. Reach for `applyFixes` alone if you want
a single pass. Do NOT stop your own loop on "the count stopped dropping": repairing one error unmasks the
next, and on a source that did not parse at all the count RISES on the first pass (one error was all that
was visible). The stopping condition is `applied === 0`.

A missing comma should not cost a whole regeneration. `CheckDiagnostic.fix` is present only when the
repair is the single possible reading; a multi-line replacement inherits the indentation of the line it
replaces.

`--check` lints a program **or** an asset library (`.flat`): the same per-symbol checks (params-in-`expr`,
undeclared color param in a paint, unknown functions/objects) run on a lib's symbols — no need to compile a
preview first.

`--check` also covers approximate **layout** warnings: text overflowing the canvas, **wrapped text taller
than its box** (or holding a single word too wide to break), clipped items, missing/overlapping drop zones,
never-used variables, and a `color` param used as a paint (a `fill`/`stroke`, a gradient stop `0:teinte@…`,
or a `tint`) that the symbol doesn't declare — a silent "dead recolor". The layout passes descend **into
groups** and measure in world coordinates, and they skip anything positioned at runtime (a bound or dragged
item, and everything nested under one, has no meaningful static position).

It reports what a gesture or a shape does SILENTLY when its options do not add up: a `draw` on a shape
with no `stroke` (nothing to trim), a `reveal … cells` array whose length does not match the grid the
engine builds (writes past the end are dropped, so a restored session comes back untouched — the message
states the geometry and the exact `fill(N, 0)` to declare), a `step` of 0 or less on a `trace` (the
progress can never move, so the drill cannot be completed), `both ends` without `step`, a non-positive
`tolerance`/`brush`/`grain` (silently replaced by the default), and a `filter` under a transform that
never stops moving (the composite is re-baked every frame, forever — see the
[gotchas](dsl-gotchas.md#filter-performance)).

It flags an instant **captured on `time` and read by `pulse`/`shake`** — both ride the monotone `clock`, so
the two axes never meet and the ramp never fires, with nothing on screen to say so. The costliest kind of
bug in a codebase migrated from 0.21; see the
[gotchas](dsl-gotchas.md#feedback-reactions-in-one-line).

### Rendering from code — one frame, or three hundred

`renderDocToPng(doc, opts)` draws one image. For a GIF, an MP4, a contact sheet or a loop check, hold a
renderer OPEN instead: the expensive setup — the `skia-canvas` import, writing and registering the
embedded fonts, decoding every image asset, building the player, installing the Node globals — is paid
once rather than per frame.

```ts
import { createRenderer } from '@flatkit/compiler/render'

const r = await createRenderer(doc, { scale: 2, params: { door: 'open' } })
try {
  for (let f = 0; f < 300; f++) writeFileSync(`out/${f}.png`, await r.frame(f))
} finally {
  r.close()   // restores the globals and drops the temp fonts — not optional
}
```

`params` sets a SYMBOL's exposed params before rendering — a state NAME or a number, the same spelling
`--set` accepts, and now available on `--render` too (`flatc --render p.flatink --set door=open`). It was
`--preview`-only, which is why anyone wanting to render a program in a given state wrote their own
harness.

> **Driving the player yourself under Node?** You need a `document` shim, or every `filter` and `tint` is
> dropped — the frame still draws, the effect is simply gone. The player warns once when that happens.
> `createRenderer` installs the shims for you; prefer it.

### The same pass, from code — `checkProgram`

The compiled Doc is **not enough** to validate a program. A text that is not FlatInk at all compiles to an
empty Doc nothing distinguishes from a valid one, and an `object` block that binds to nothing leaves no
trace either: both errors live in the SOURCE. `checkProgram` runs the whole `--check` pass on a string, so
validating in a service or a browser no longer means spawning `flatc`:

```ts
import { checkProgram } from '@flatkit/compiler'

const { ok, errors, warnings, report, doc } = checkProgram(srcFromAnLLM, { assetSrcs: [libText] })
if (!ok) regenerate(report) // the report doubles as the repair prompt
```

Never throws: a source the parser rejects outright comes back as a diagnostic with `doc: null`. The CLI
calls the same function, so the two verdicts cannot drift **on the same text** — which is the caveat worth
knowing: `flatc` reads a FILE and auto-discovers the `.flat` libs beside it, `checkProgram` receives a
STRING and only the `assetSrcs` you hand it. Two different inputs, two legitimate verdicts. If the two ever
disagree, compare what each was actually given before suspecting the pass.

It also flags the three **silent drops of a cel layer** (such a layer draws only the current cel's
`matter` and the containers that cel poses): a bare shape left in the layer, a `pose "X"` naming no roster
item, and a roster item no cel ever poses. Each renders an empty frame with no other signal — see
[frame-by-frame](animating-symbols.md#frame-by-frame--a-different-drawing-on-each-cel).

## See what you draw — `--render`

Render a PNG (skia backend, faithful to the browser). Needs the optional `skia-canvas` dep
(`npm i -D skia-canvas`).

`skia-canvas` 3 (3.0.8 or later) and 4 (from `4.0.0-rc7`) are both accepted. They do not render to the
same pixels: **version 4 can set a line of text one device pixel higher or lower** than version 3 (half a
unit at the default scale of 2); shapes are identical. It is a rounding that falls one way or the other
from one text to the next, not a uniform shift: on a same picture one block may move down, another up, a
third not at all (measured by a consumer on 545 scenes: 16 identical to the pixel, a median of 0.31% of
pixels visibly different, 3.4% at most on a page of text). Frames rendered with one must not be mixed
with frames rendered with the other in the same video, and a pixel comparison between two renders needs
the same version on both sides. While version 4 is a release candidate, pin the exact version.

```
flatc <file> --render -o out.png [--frame N] [--at k=v[,k2=v2]] [--steps N] [--scale S]
```

- `--frame N` target frame · `--scale S` resolution factor.
- `--at score=3,step=2` forces variables → capture a precise state.
- **`--steps N`** runs N fixed simulation steps (`every frame`, 60 Hz) *before* capture, so a stateful
  act unfolds on its own — no need to force every derived ramp variable by hand.
- **`--script gestures.json`** replays a gesture script first, exactly as `--play` does, and renders the
  state it reaches — the third right answer, the piece dropped, level 2 — instead of a copy of the program
  with other initial `var`s. The order is: `--frame`, `--at`, the script, `--steps`, the capture. A
  **`{ "type": "shot", "name": "after" }`** gesture writes the image *at that point* next to the output
  (`out.after.png`; unnamed shots are numbered), and the output is always the final state. A failed
  `expect` makes the run exit ≠0, images written all the same. `--settle` applies as in `--play`. From
  code: `createRenderer(doc, { interactive: true })`, then `play(gestures)` and `capture()`.
- **Embedded fonts render too**: any `asset "id" "font.woff2" font` is registered with skia before
  capture, so text uses the authored face (matched by the font's intrinsic family name — the same name
  you put in `text … font "…"`) instead of a host fallback. `.woff2/.woff/.ttf/.otf` are all supported;
  flatc prints the registered families to stderr.
- **Font family alias**: add a quoted name after `font` — `asset "id" "font.woff2" font "Quicksand"` —
  to register the face under *that* family instead of the file's intrinsic one. Use it when a font's
  name table is wrong (e.g. a variable-font static export skia reads as `… Thin/Light`), so the alias
  matches the `text … font "Quicksand"` you authored. Browsers ignore it (they bind families via
  `FontFace`); it only steers headless `--render`.

## Preview a `.flat` symbol — `--preview`

Wrap ONE symbol of a `.flat` library into a playable, auto-sized Doc — no hand-authored wrapper. Outputs a
`.flatpack` (drop it in the browser player) or, with `--render`, a PNG.

```
flatc --preview <library.flat> [--symbol NAME] [-o out.flatpack | --render -o out.png]
                [--bbox all|frame0] [--pad N] [--set p=v[,p2=v2]] [--frame N] [--scale S]
```

- `--symbol NAME` picks the symbol (default: the first; others are listed on stderr).
- **`--bbox all`** (default) auto-sizes to the UNION of bounds over every frame (sub-timelines unfrozen),
  so drifting/rotating/growing motion is never clipped. `--bbox frame0` is the old frame-0-only measure;
  `--pad N` adds a margin (default 24). The symbol is measured **as it is drawn**: its `expr` channels
  are evaluated with its params — the declared defaults, or the `--set` values — so a bar stretched by
  `expr scaleX "long"` is framed at its real length.
- **`--frame N` does not move a symbol that has `states`**: its pose is set by the state, not by the
  playhead (only the loops nested in it advance). `flatc` says so; to see a state, or a point between
  two, use `--set <param>=<state name | value>` (`--set pos=0.5` is halfway).
- **`--set p=v`** sets the symbol's exposed [params](animating-symbols.md#exposed-parameters-params): a
  `color` (`hull=#1a5`), a `number`/`bool` (`wave=1.5`), or a `state` by name (`door=open`). Baked into the
  preview (flatpack + render).
- **`--scale auto`** picks the render factor from the symbol's size — enlarges small/thin assets (so a fine
  filament stays legible) and leaves large ones at 1×. Otherwise `--scale S` (default 2).

## Media packing — `--assets`

```
flatc <file> --assets inline      # default: media embedded as data: URIs → one portable .flatpack
flatc <file> --assets external    # asset.data = relative key + a sidecar <out>.assets/ folder
```

Use `external` for big media you don't want inflating the JSON; serve the folder and play with
`sameOriginAssetResolver(<flatpackUrl>)` (see `@flatkit/player`).

## Headless play — `--play`

Run a scene **without a canvas**, replay a gesture script, and print `{ sends, vars }` — great in CI.

```
flatc <file> --play --script gestures.json [--trace] [--settle N]
```

**Prefer semantic gestures** (by object NAME — robust, the engine resolves coordinates):

```json
[
  { "type": "drag",    "source": "Card1", "target": "ZoneA" },
  { "type": "tap",     "target": "Button" },
  { "type": "scratch", "target": "Cover1" },
  { "type": "turn",    "target": "Hand",  "angle": 120 },
  { "type": "connect", "source": "Word",  "target": "Picture" },
  { "type": "key",     "name": "ArrowRight", "frames": 10 },
  { "type": "wait",    "frames": 30 },
  { "type": "expect",  "sends": ["win"], "vars": { "score": 3 } }
]
```

- `drag` / `tap` / `scratch` (sweeps a `reveal` zone) / `connect` (pulls a `link` wire) — by name.
  `tap` also takes a point instead of a name — `{ "type": "tap", "x": 120, "y": 80 }` — for a rail or
  an area that has no name.
- Audio is off in `--play`: a `sound` action is a silent no-op, so a program is replayed as written.
- `random()` is seeded in `--play` (seed `1`), so a replay says the same thing twice and an `expect` can
  assert on a draw. `--seed N` picks another one.
- **A pointer event takes a frame.** Each press, move and release is followed by one simulation step, as
  a real pointer stays at least one frame on each position — so a rule written in `every frame` sees the
  drag. `--settle N` sets that number for the whole script (`--settle 0` = the instantaneous replay of
  before 0.38), and `"settle": N` on a gesture sets it for that one. A script that `expect`s a value which
  decays every frame (a feedback pulse read right after the tap) needs `"settle": 0` on that tap.
- **`turn`** turns a `turn`/`turnDeg` target **to** `angle`: the value the gesture ENDS at, wherever the
  press was — not a rotation added to the current one. Degrees for `turnDeg`, radians for `turn`; `0` is
  to the right of the pivot, positive is clockwise on screen. It is swept in sub-steps, so several turns
  land (`"angle": 540`). The press goes to the object's position, then to the centre of its drawn box (a
  hand drawn *from* its pivot has its origin on the edge of its shape). **`"from": [x, y]`** names the
  press point — the way to pick one of two hands overlapping at noon. A press that does not grab the
  target is an **error** that names what is grabbed there instead; it used to turn the wrong object, or
  none, in silence.
- `set` drives a variable from the host; `wait` runs N fixed 60 Hz steps (advances `every frame` physics).
- **`key`** holds a key down (`keys.<name>` reads `1`) for `frames` steps — default `1` — then releases
  it: the way to test a keyboard-driven scene in CI. Use the authored name (`"ArrowRight"`, `"Space"`).
- **`expect`** turns the script into a test: it compares the `send`s emitted since the last `expect` and
  the current vars, and makes `--play` **exit ≠0** on mismatch. No more eyeballing. It matches the
  **sequence of event names**; to assert a payload, read `sends` from the JSON output (each entry is the
  object the host would receive: `{ name, value?, fields? }` — see
  [host integration](host-integration.md#receiving-events-send--onevent)).
- Low-level gestures (`down`/`move`/`up`/`cancel` with `x,y`) remain for special cases — and they drive
  the interactors just as the semantic ones do, `turn`/`turnDeg` included. One trap when hand-writing them
  for a rotation: the angle written is the one from the PIVOT to the pointer, so a move that stays
  collinear with the pivot writes the angle that was already there and the object looks stuck. Move to a
  point that is genuinely at the angle you mean.
- `--trace` prints a human-readable log per gesture (emitted sends + variable diff) instead of JSON —
  a `send` shows as `name`, `name=value`, or `name{a=1, b=2}` for a record payload.

### Recording

In the player, `player.startRecording()` / `stopRecording(): Gesture[]` capture gestures you play by
hand into a script that `--play` replays. (Authoring/CI helpers live in `@flatkit/player/debug`.)
Pointer only — key presses are not captured; add the `key` gestures to the recorded script yourself.

## Upgrading: what is drawn differently (`--since`)

```
flatc scene.flatink lib.flat other.flatink --since 0.35
```

A one-shot report for an upgrade: what these sources draw **differently** from that version, each finding
with its `file:line`. Nothing is modified, and the exit code is 0.

One change is recorded so far. Until 0.36 a path made only of lines (`L`, `H`, `V`) was rounded at its
gentle turns; it is now drawn straight, as its data says. The report lists each such path that moves by
1% of its size or more, open or closed, with how far it moves — a soft hill written as four points wants
`smooth` back (`path "…" smooth`), a hexagon does not. An open line is also listed when it moves by 2
units or more, however little that is of its length: a horizon across the whole frame bends by a few
units and by a fraction of a percent. `--all` adds the slighter ones.

It is a report and not a `--check` warning on purpose: a polyline that is *meant* straight has nothing to
add to say so, and would be warned about for ever.

## What does this program DO?

Merging DSL you did not write (a generated skin, a themed layer) raises a question a compiler answers and
a regex cannot: *what is this fragment allowed to do?* Read the structure, never the source text:

```js
import { parseProgramFull } from '@flatkit/engine/flatFormat'
import { manifestEvents } from '@flatkit/compiler'

const emitted = manifestEvents(parseProgramFull(merged))   // every `send`, wherever it hides
const introduced = emitted.filter((e) => !ownEvents.includes(e))
if (introduced.length) throw new Error(`the skin emits ${introduced.join(', ')}`)
```

`manifestEvents` walks every action of the document — inside `if` / `repeat` bodies, inside procedures,
inside the timeline hooks — so it sees what a pattern over the source cannot:

- `send"win"` with no space (the grammar does not require one — see the [gotchas](dsl-gotchas.md));
- an event emitted **through a function**: a fragment that never writes `send` at all can call a `fn` the
  rest of the program defines, and the event fires.

Symmetrically, it does not fire on the word `send` sitting in a comment or inside a string a text draws —
which a pattern would reject. `manifestVars` and `docToManifest` answer the same kind of question for the
variables a program reads and the contract its objects carry.

## Teaching the language to a model

Three pieces, all pure functions — no filesystem, no canvas — so they work in a browser as well as in CI:

```ts
import { languageCard, drawingCard, docToManifest, llmContext, manifestObjects, manifestEvents } from '@flatkit/compiler'

languageCard()      // BEHAVIOR: events, channels, expressions (function/constant lists interpolated
                    // from the engine, so they cannot go stale)
drawingCard()       // COMPOSITION: shapes, paints, filters, text, clipping, and the word order that
                    // breaks most often. Its examples are compiled by a test — a copied reference drifts
docToManifest(doc)  // the SCENE MAP alone: the names this scene can reference, and the contract below
llmContext(doc)     // the bundle: both cards + the map. `{ drawing: false }` drops the drawing half
```

Pick `docToManifest` when you already inject the references yourself — `llmContext` is the everything-included
bundle, and calling it in that case ships the cards twice.

The scene map (`docToManifest`) ends with the **binding contract**: for each named object, the events the
logic handles on it, whether it is dragged, whether it is a drop zone, the channels the logic drives, and
the state it reads — plus the events the program emits. Deliberately **no coordinates**: that is what lets
a second skin honour the same logic with a completely different composition.

```
contract (honour these; the layout is yours):
  Flask - zone
  TileH - drag, on drop, driven: x y opacity rotation, reads: xh yh rmix inO
events: correct, completed, incorrect
```

Longer, hand-written prompts (a full reference plus one file per role — asset creator, motion designer,
coder) ship with the package under `prompts/`; see [its README](../packages/compiler/prompts/README.md).

## See also

- The language itself → **[Scene & drawing](scene-and-drawing.md)** · **[Behavior & interactions](behavior-and-interactions.md)**
- Wiring a scene into an app → **[Host integration](host-integration.md)**
- Pitfalls & best practices → **[Gotchas](dsl-gotchas.md)**
