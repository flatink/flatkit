# FlatInk DSL — gotchas & best practices (appendix)

> **New here?** Start with the [documentation index](README.md) and the
> [getting-started guide](getting-started.md). This page is the **appendix**: hard-won pitfalls and
> sharp edges learned on a real production pipeline, then fixed in the engine or written down here.
> Skim it once you know the basics.

## Mental model

- A `.flatink` file splits in two: the **`scene { … }`** block (the VISUAL composition:
  `path`/`circle`/`group`/`image`/`text`) and the **behavior** that follows (`object "Name"
  { … }`, `every frame`, timeline bindings). The two do NOT share the same grammar.

## One action / one binding per line

- **One single action or assignment per line.** `x = 1  y = 2` raises a clear error
  ("one action per line — unexpected `=`"), with the column pointing at the second `=`.
- **`send` footgun (fixed)**: `send "evt", x = 1` (with a comma) used to capture `x = 1` as
  the *payload*. It is now a dedicated error. A `send` carries at most one payload:
  `send "evt"`, `send "evt", <expr>`, or `send "evt", text("textId")`.

## Drawing (region / path)

- **`stroke` DOES exist on paths** (despite the folklore):
  `path "…" fill #rrggbb stroke #rrggbb <width> [cap butt|round|square] [join …] [miter n] [dash a,b,…]`.
  No need to draw ropes/threads as thin filled shapes.
- **`stroke` ALSO exists on text** (same grammar): `text "…" color #fff stroke #000 4 join round` outlines
  the glyphs (stroke drawn behind the fill). No need to fake outlines by stacking two text objects.
- **`opacity` DOES exist on paths**: `path "…" fill #000 opacity 0.5`. (8-digit hex alpha
  works too, but `opacity` reads better.)
- **Shape primitives** (sugar, normalized to `path` on save):
  - `circle <cx> <cy> <r>`
  - `ellipse <cx> <cy> <rx> <ry>`
  - `rect <x> <y> <w> <h>` · `… <r>` (uniform rounded corners) · `… <rx> <ry>`
  No more hand-computing the k = 0.5523·r Bézier constant.
- **`filter` on a path**: accepted (`path "…" fill #000 filter glow 6 #fff`). No need to wrap
  in a `group` just to add a shadow/glow. (Also works on group/image/text.)
- **`linear(angle, …)` gradient**: `0` = → (left to right), `90` = ↓ (top to bottom).

## Text

- **Word-wrap**: opt-in via `wrap`. `text "long sentence…" … box <W> <H> wrap` breaks at
  spaces within `W`. Without `wrap`, text does NOT wrap on its own (it respects explicit
  `\n`). Opt-in on purpose, to avoid breaking existing layouts.
- **Dynamic text (read-only)**: `text "Angle: {}°" … bind "round(aDeg)" decimals 1`. The
  expression is evaluated every frame; its formatted value fills the **`{}`** slot in the
  content (or is shown alone when there is no `{}`). `decimals` sets the decimal count.
  No more gauges/needles just to display a measurement (angle, timer, score…).
- **Centering an `image`**: the origin is the top-left corner → center with `at -W/2,-H/2`.

## Drag & drop

- **Drop semantics**: by default the **object's center** (its x/y channels) is tested against
  the zone. Two levers to match human expectations:
  - `when dropped on Zone at pointer { … }`: tests the **POINTER position** (not the center).
  - `group "Zone" … hitbox <W> <H> { … }`: an **explicit drop rectangle** (centered on the
    origin, ±W/2 × ±H/2) instead of the content bbox. Replaces invisible `#ffffff01` paths.
- **Locking a placed object**: `drag x, y { enabled <expr> }`. The drag is active only while
  the expression is ≠ 0. No more `x = (p==1) ? Zone.x : xv` + `if p==0` guard patterns.
- **Event order on release**: `when released` fires **BEFORE** the drop test (useful to lower a
  "hold" flag before the drop fires). A `link` interactor writes its outputs (`<target>` index,
  end position) **before** `released` too, so a `when released` handler can read `<target>`
  directly (consistent with `drag`, which writes its vars before `dragged`).
- **Several `when dropped on` per object**: evaluated in **declaration order**, without
  short-circuit (the basis of the right-zone / wrong-zones pattern).

## Gestures beyond drag (interactors)

Inside an `object "Name" { … }`, besides `drag x, y` / `dragX` / `dragY`:

- **`turn <angle> around <x>,<y> [{ snap <deg> · enabled <expr> }]`**: pointer-driven
  rotation. Writes into `<angle>` (degrees) the direction from the pivot to the cursor.
  Great for clock hands, dials, protractors, knobs. Use it via `rotation = <angle>`.
- **`trace <progress> along <TraceGroup> [{ tolerance <px> · enabled <expr> }]`**: follow a
  path with the finger. While the pointer stays within `tolerance` of the trace (the regions
  of the named group), `<progress>` rises from 0 to 1 (monotone, never goes back down).
  Great for tracing a letter, a border, a constellation. (`tolerance` defaults to 24 px.)
- **`reveal <progress> [{ brush <px> · enabled <expr> }]`**: scratch / wipe. The grabbed
  object IS the area to reveal; rubbing it ticks the cells of an internal grid (cell side =
  `brush`) and `<progress>` rises from 0 to 1 (monotone, and **cumulative across separate grabs**
  — a child rubbing in several short strokes keeps adding coverage, it does not reset). Drive a
  cover's opacity with `opacity = 1 - <progress>`. Great for scratch cards, fogged glass, digging.
  (`brush` defaults to 24 px; coverage model, no pixel mask.)
- **`link <endX>, <endY>, <target> to <TargetsGroup> [{ enabled <expr> }]`**: pull an elastic
  thread toward a target. During the drag, `<endX>`/`<endY>` = pointer position (DRAW the
  thread yourself with expressions, e.g. a region connecting the object to `endX,endY`). On
  release, `<target>` = the **1..n** index of the named child of the group that was hit
  (0 if none), and the thread end snaps to the linked target's center; off-target, the
  author handles the "return" via `<target> == 0`. Several links coexist: one `link`
  interactor per source object. Great for word↔image, prey↔predator, capital↔country.
  **WORLD coords** (place sources and targets at the scene root so the thread lines up).
- Reminder: `{ enabled <expr> }` (dynamic lock) works on `turn`/`trace`/`reveal`/`link` too.
- **Output into an ARRAY element**: every gesture output accepts `name[<idx>]` (not just a
  bare identifier) — `drag hx[i], hy[i]`, `turn ang[k] around …`, `reveal seen[2]`,
  `link ex[i], ey[i], rel[i] to …`. This is the natural form **under `each`**:
  `each "Handle" as i { drag hx[i], hy[i] }` attaches one drag per instance, each writing its
  OWN slot. (The index is substituted by `each`; the array must exist: `var hx = fill(n, 0)`.)

## Feedback (reactions in one line)

An object's channel expressions can read **its own interaction state**: `self.hovered`,
`self.grabbed`, `self.pressed` (each `0`/`1`). So a hover-lift or a grab-squash is just an
expression — no mirror variable, no handler:

```
object "Button" {
  scaleX  = self.hovered ? 1.06 : 1
  opacity = self.hovered ? 0.85 : 1
  scaleY  = self.grabbed ? 0.94 : 1
}
```

`self.hovered` tracks the pointer **handler-independently** (you do not need a `when enter/leave`),
and composes with `self.x`/`self.y` etc. (same `self`).

- **`feedback <tokens>` sugar** — the one-liner. Inside an `object` block,
  `feedback lift tilt dim shake(<expr>)` unfolds into the channel bindings above (auto-injecting
  `use "feedback"`), **composed per channel** so it never clashes with your `x`/`y` position
  bindings. Tokens: `lift` (hover grow), `tilt` (grab squash), `dim` (hover opacity),
  `shake(<expr>)` (refusal wobble — `<expr> ≠ 0` shakes the `rotation`). One line per element
  instead of six — the biggest size/token saver across an activity.
  ```
  object "Tile" {
    x = tx   y = ty                 // your position bindings, untouched
    feedback lift dim shake(wrongZone)
  }
  ```
- **`use "feedback"` functions** — the same reactions as plain helpers if you want to wire them by
  hand: `lift(h)` · `dim(h)` · `tilt(g)` · `sink(g)` · `shake(bad, t)`. (Settle-bounce is not here
  yet: it needs a release timestamp, so it is not stateless.)

## Factoring

- **Scene-level `repeat`**: generates N items.
  ```
  scene {
    layer "Stars" {
      repeat i from 0 to 9 {
        circle $(60 + i*40) 80 6 fill #ffd98a
      }
    }
  }
  ```
  The index is used inside numbers via the **`$(expr)`** interpolation (compile-time
  arithmetic: `$(i*40)`, `$( (i+1)*20 )`…). Nested loops are fine (grids).
  ⚠️ Not to be confused with `repeat … times` / `repeat i from … to …` inside `object`
  scripts (a RUNTIME loop, executed every frame).
- **`def <name> = <expr>`**: a named **compile-time** constant (columns, margins, counts…).
  Declared anywhere (the line is removed at compile time), usable in any scene coordinate via
  `$()`, including `repeat` bounds. A `def` may reference earlier ones.
  ```
  def colL = 120
  def gap  = 40
  def n    = 2
  scene { layer "L" {
    repeat i from 0 to n { circle $(colL + i*gap) 80 6 fill #ffd98a }
  } }
  ```
  `def`s resolve **everywhere**: scene coordinates AND behavior expressions (`object`/`each`,
  e.g. `x = 20 + t * $(vmax)`). ⚠️ Compile-time only: `def`s are NOT runtime variables (no
  `var`), they vanish from the model (like `repeat`); for a value that changes at runtime,
  use `var`. (Avoid naming a `def` like a symbol parameter — collision.)
- **`at center` anchor**: positions an item at the canvas center. `at center` (both axes),
  `at center,540` (x centered, y = 540), `at 120,center` (x = 120, y centered). Sugar
  resolved at parse from `size` (re-serialized as coords, like `def`). Composes with `$()`.
- **`align <point> of "Name" [offset dx,dy]` anchor**: puts an item's **origin** on a point
  of **another item's bbox** (center inside a frame, hang a counter under a pit, snap a sign
  to an edge). 9 points: `center`, `top`, `bottom`, `left`, `right`, `topleft`, `topright`,
  `bottomleft`, `bottomright` (an edge point = centered on the cross axis). Optional
  `offset dx,dy`.
  ```
  group "Counter" align bottom of "Pit" offset 0,18 { … }
  group "Tag" align top of "Bin" { … }
  ```
  ⚠️ **STATIC bbox** (scene transforms, WITHOUT expression channels — same as drop zones).
  Anchoring only (NO adjacency/flow: deliberate — stacking is done with `repeat`+`$()`,
  e.g. `at $(120 + i*84),540`). Positions in **root** space (place source and target at the
  same level). Missing target = error. Sugar resolved at parse (re-serialized as coords).
- **Parameterized symbols**: `symbol "Name"(p, q = default) { … }` + `instance "Name"(args)
  [as "X"] at x,y`. Reuse a VISUAL while varying values (label, tint, size). `$(param)`
  substitution in the body — params can be **numbers AND text/color** (`text "$(label)"`,
  `fill $(tint)`).
  ```
  symbol "Card"(label, tint = "#ffffff") {
    layer "c" { rect -40 -40 80 80 fill $(tint)
                text "$(label)" font "sans-serif" size 20 align center line 1.2 color #000 box 80 80 as "lbl$(label)" }
  }
  scene { layer "L" {
    repeat i from 0 to 4 { instance "Card"($(i+1)) as "C$(i)" at $(80 + i*90),200 }
  } }
  ```
  - **Defaults**: a param can gain a default without breaking existing calls (the signature
    doubles as documentation).
  - **Per-instance ids**: `as "lbl$(label)"` in the body → each card exposes its own
    `text("lblFire")` for `send` payloads.
  - Each `instance(...)` becomes a concrete **`group`** (substitution at PARSE time, **zero
    runtime cost**).
  - ⚠️ A param is **frozen** (≠ `var`: it is not a runtime variable). The body sees ONLY its
    params (not the `i` of an outer `repeat` — pass it as an argument). Wrong arity / unknown
    param = error.
  - ⚠️ Compile-time sugar (re-serialized as groups, like `def`/`repeat`). For shared
    BEHAVIOR, see `each` below.
- **`each "Symbol" as i { … }`**: applies BEHAVIOR to every instance of a symbol, with
  index `i`.
  - **Channel bindings** on real instances (`each "Brick" as i { opacity = bricks[i] }`) →
    resolved at runtime (`vals[i]`, variable arrays).
  - **Handlers** on the instances of a **parameterized symbol** (`each "Key" as i { when
    clicked { … } }`) → unrolled at parse into one `object` per generated instance (index `i`
    substituted). The BEHAVIOR counterpart of parameterized symbols (the VISUAL): together
    they make a full keypad in ~10 lines.
    ⚠️ Give instances distinct names (`as "K$(i)"`) so each handler targets ITS tile.
- **Indexed assignment**: `arr[<expr>] = <value>` (the `set` keyword is optional). The index
  can be any expression, **including nested**: `occ[sl[i + 1]] = 0` works (balanced
  brackets). An unclosed bracket is a **hard error** (no more silent truncation).
- **`else if`**: supported (`} else if cond {`); no need to nest `else { if … }`.
- **`match` — declarative pairing** (factors the drag+drop boilerplate). Unrolled into
  `object` blocks.
  ```
  match Word1, Word2, Word3 onto NounBin, VerbBin, AdjBin {
    correct Word1 -> NounBin, Word2 -> VerbBin, Word3 -> AdjBin
    lock on wrong                                  // optional; absent = RETRYABLE (default)
    on correct as it { send "found", text(it) }    // optional GENERIC action hooks
    on wrong   as it { send "miss" }               // `it` = the current item's name
    on done            { send "done" }             // fires when all correct placements are in
  }
  ```
  Generates, per item: `drag <Item>_x, <Item>_y { enabled <Item>_placed == 0 }` + one
  `dropped on` per zone that sets the **exposed state**: `<Item>_placed` (0/1), `<Item>_ok`
  (0/1), `<Item>_zone` (index). **No event is imposed** (full host decoupling) — you decide
  what to send via the hooks. The **visual stays yours**: declare `var <Item>_x`/`var
  <Item>_y` (start positions) and write your expressions.

## Tooling (the generation loop)

- **`flatc --check <file>`**: semantic lint only. Exits ≠ 0 on ERROR; **warnings** print
  without blocking. Also covers **layout** (approximate, no rendering): text (without `wrap`)
  overflowing the canvas edge, image/text clipped at an edge, missing drop zone,
  **overlapping hitboxes**, never-used global variable.
- **`flatc --watch <file>`**: recompiles on every change in the folder.
- **`flatc --render <file> -o out.png [--frame N] [--at k=v[,k2=v2]] [--steps N] [--scale S]`**:
  renders a headless **PNG image** (skia backend, faithful to the browser: SVG, gradients,
  glow/shadow filters). This is how you **see what you draw** before playing. `--at` forces
  variables → capture a precise state (e.g. `--at step=2` for an escape-room stage); `--frame N`
  targets a frame. **`--steps N`** runs N fixed simulation steps (`every frame`, 60 Hz) *before*
  the capture, so a stateful act unfolds on its own — no need to force every derived ramp variable
  by hand in `--at`. (Bounded to 10 000 steps.) Requires the optional `skia-canvas` dependency
  (see the error message for the install steps).
- **`flatc --assets inline|external <file>`**: how media is baked. `inline` (default) embeds each
  asset as a base64 `data:` URI inside the `.flatpack` — one portable file. `external` keeps
  `asset.data` as a relative key and copies the files into a sidecar `<out>.assets/` folder; serve
  that folder and play with `sameOriginAssetResolver(<flatpackUrl>)`. Use `external` for big media
  (video, large audio) you do not want inflating the JSON.
- **`flatc --play <file.flatink|.flatpack> --script <gestures.json>`**: plays **headless**
  (no canvas), replays a gesture script and prints `{ sends, vars }` as JSON. Great in CI.
  Script format: an array of gestures. **Prefer SEMANTIC gestures** (by object NAME) —
  robust (coordinate-independent), readable, and the engine resolves the position:
  ```json
  [
    { "type": "drag",    "source": "Card1", "target": "ZoneA" },
    { "type": "wait",    "frames": 30 },
    { "type": "tap",     "target": "Button" },
    { "type": "scratch", "target": "Cover1" },
    { "type": "connect", "source": "Word", "target": "Picture" }
  ]
  ```
  `drag source→target` = the engine grabs `source` (at its RESOLVED position, expressions
  included) and releases it at the center of `target`; `tap target` = a click at the object's
  center; **`scratch target`** = the engine sweeps the `reveal` target's whole bbox for you
  (boustrophedon at the brush spacing) so its coverage reaches ~1 — no more dozens of hand-typed
  `move`s; **`connect source→target`** = pulls a `link` wire from `source` and releases over
  `target`, resolving the target index. Unknown object → **hard error** (not a silent miss). The
  generator describes the INTENT; the engine guarantees the interaction.
  LOW-LEVEL gestures (scene coords) remain available for special cases:
  ```json
  [
    { "type": "down", "x": 50, "y": 50 }, { "type": "move", "x": 60, "y": 60 }, { "type": "up", "x": 60, "y": 60 },
    { "type": "set",  "name": "unlocked", "value": 1 }, { "type": "wait", "frames": 60 }
  ]
  ```
  (`set` drives a variable from the "host"; `wait` lets the simulation run N fixed 60 Hz
  steps — required to "wait out" `every frame` physics, time does not advance on its own in
  headless mode.)
- **`flatc --play … --trace`**: instead of the final JSON, a **human-readable log per
  gesture** — the emitted `send`s + the **variable diff** at each step. Step-by-step
  inspection to understand/debug a script (a headless debug-player):
  ```
  drag Word1→Bin1   sends:[found]          vars{Word1_placed:undefined→1 Word1_ok:undefined→1}
  wait 5
  drag Word2→Bin2   sends:[found, win]     vars{Word2_placed:undefined→1 Word2_ok:undefined→1}
  ```
- **`expect` — self-verification in CI**: a gesture `{ "type": "expect", "sends": ["done"],
  "vars": { "score": 3 } }` in the script compares and makes **`flatc --play` exit ≠ 0** on
  mismatch (each mismatch listed on stderr). `sends` = the **sequence of names** emitted
  SINCE the last `expect`; `vars` = current state. No more eyeballing: the script becomes a
  test. Works with or without `--trace`.
- **Gesture recording**: `player.startRecording()` / `stopRecording(): Gesture[]` capture
  gestures played BY HAND (down/up/cancel + the `move`s during a drag, with `wait`s for
  elapsed time) → a script **directly replayable by `--play`**. No more hand-written coords.
- **Canonical file name**: `.flatpack` (JSON inside; `.flatpack.json` is a legacy alias that
  `--play` tolerates).

## `filter` performance

- A `filter glow`/`shadow` = **one offscreen canvas recomposited** per group carrying the
  filter. The engine automatically **caches** *static* filtered subtrees (decor with no
  expression or animation): they are only re-rendered on zoom/pan or asset load. So a filter
  on **static decor** is nearly free in steady state.
- A filter on an **animated** element (channel expression, `bind`, timeline) is recomposited
  every frame. Keep filters on animated elements **small**.
- Cheap alternative for decor shadows: a **"baked" shadow** = the same path offset by a few
  px in `#00000028` UNDER the cutout (no offscreen canvas). Ideal for large planes.
- Drop-shadow cost ∝ area × blur: a large blurred plane is expensive when not cached.

## Audio

- `sound "assetId" at <frame> [gain <g>] [loop]` on the timeline, and the `sound "assetId"`
  action in a handler, ARE wired (WebAudio). Declare the asset like images:
  `asset "ding" "ding.mp3" sound`. Media (mp3/wav/ogg/m4a) are embedded as data URIs by
  `flatc`. (No sample sounds ship for now — bring your own.)
