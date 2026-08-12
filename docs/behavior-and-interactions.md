# Behavior & interactions

Everything after the `scene { … }` block is behavior. It attaches to named scene items via
`object "Name" { … }`, or runs scene-wide via `every frame { … }` and timeline hooks.

```
var score = 0

object "Coin" {
  when clicked { score = score + 1 }     // an EVENT handler (actions)
  rotation = clock * 90                   // a CHANNEL binding (expression, every frame)
}

every frame { if (score >= 10) { send "win" } }
```

## Events

Inside `object "Name" { … }`:

| Event | Fires when |
|---|---|
| `when clicked` | the item is **tapped** — press + release with no drag (fires on release, within a few px) |
| `when hovered` / `when unhovered` | the pointer enters / leaves |
| `when pressed` / `when released` | pointer down / up on the item |
| `when dragged` | the item is being dragged (grab in progress) |
| `when held` | a long press |
| `when dropped on <Zone> [at pointer]` | released over a drop zone (see [drag & drop](#drag--drop)) |

Scene-wide: `when loaded { … }` (once), `every frame { … }` (each tick), `at frame <n> { … }`,
`label <frame> "name"`. These live at the TOP LEVEL of the program, outside any `object` block — inside
one they do nothing, and `--check` says so.

> **`when` takes a GESTURE, never a condition.** There is no `when <condition>` in FlatInk, and
> `when biomasse > 55 { … }` is the reflex of anyone writing a rule-driven activity. A condition is
> watched in `every frame`, and it must be **guarded with a flag** — the block runs 60 times a second, so
> an unguarded `send` fires sixty events per second rather than one:
>
> ```flatink
> var done = 0
> every frame {
>   if biomasse > 55 {
>     if done < 0.5 {
>       done = 1
>       send "completed"
>     }
>   }
> }
> ```
>
> Symmetrically, a `when clicked`, a channel binding or an interactor written at the top level drives
> *one item* and there is none there: those belong in `object "Name" { … }`.

## Actions

In a handler body, one action per line:

```
play  ·  pause                          # timeline control
go to frame <n> [and play|and pause]
go to "<label>" [and play|and pause]
<name> = <expr>                          # set a variable (the `set` keyword is optional)
<arr>[<expr>] = <expr>                   # indexed assignment (nested indices ok: occ[sl[i]] = 0)
if <cond> { … } [else if <cond> { … }] [else { … }]
repeat <n> times { … }                   # runtime loop (bounded)
repeat i from <a> to <b> { … }           # runtime range loop
<fn>(<args>)                             # call a function
send "<event>" [, <payload>]             # emit an event to the host (see below)
sound "<assetId>"                        # one-shot audio
```

### `send` — talking to the host

`send` is the one-way channel from the scene to the page that embeds it. Four payload forms:

```
send "win"                               # bare — just the event
send "score", lives * 100                # a NUMBER (any expression)
send "answer", text("txtCard")           # the live TEXT of a text item
send "save", { x = px, y = py, doors }   # a RECORD: named numbers (a state patch)
```

In a record, `{ doors }` is shorthand for `{ doors = doors }` — handy when the field and the variable
share a name. Fields hold **numbers only**, at most 32 per `send`, and each name must be a plain
identifier (`[A-Za-z_]\w*`, 64 characters max, and never `__proto__`/`constructor`/`prototype`).

The host receives one object: `{ name, value?, fields? }` — `value` for the number/text forms, `fields`
for the record. Nothing comes back: `send` is fire-and-forget and never blocks the scene. See
**[Host integration](host-integration.md)** for the receiving end.

## Variables

```
var score = 0                # scalar (declared at the top of the file, Layer B state)
var slots = [0, 0, 0]        # array literal
var seen = fill(8, 0)        # array of 8 zeros
```

Read/write them in expressions and actions. `var`s are runtime state — distinct from `def` (a
compile-time constant, see [factoring](#reuse--factoring)).

## Channel bindings

Drive an item's pose every frame with an expression. Channels: `x`, `y`, `scaleX`, `scaleY`,
`rotation`, `opacity` (absolute), plus the additive position offsets `dx`, `dy` (`pos = at + (dx, dy)`).

```
object "Needle" {
  rotation = atan2(mouse.y - 160, mouse.x - 240)   // point at the cursor (RADIANS)
  opacity  = lit ? 1 : 0.3
}
```

`rotation` is in **radians** (like `sin`/`cos`/`atan2`). To author in **degrees**, bind **`rotationDeg`**
instead — sugar for `rotation = rad(<expr>)`: `rotationDeg = 45`, `rotationDeg = handAngle`.

`x`/`y` are **absolute** — they REPLACE the item's declared `at X,Y`. For motion **around** the anchor,
bind the additive offsets **`dx`/`dy`** instead: `pos = at + (dx, dy)`, so `dx = 30*sin(clock)` wobbles a
group `at 620,150` around 620 with no base to re-inject (and `dx`/`dy` add on top of `x`/`y` if both are
bound). Offsets are binding-only — no keyframe/`spring`/`smooth` form. See the
[absolute-vs-offset gotcha](dsl-gotchas.md).

`self.x`/`self.y`/… is the item's own current pose; `mouse.x`/`mouse.y` (and `mouse.wheel`, the per-frame
scroll delta), `time`, `clock`, `frame`, variables and named objects (`Target.x`) are all available — see
[Expressions](expressions-and-stdlib.md). Prefer **`clock`** (monotone) over `time` (restarts on every
timeline loop) for free-running motion and for any instant you capture and compare later.

## Drag & drop

```
object "Piece" {
  drag px, py                            // follow the pointer, writing into px/py (use them: x = px, y = py)
  x = px   y = py
  when dropped on Slot at pointer { placed = 1 }
}
```

- `drag x, y` / `dragX x` / `dragY y` — the gesture writes the position into your variables.
- **One option per LINE** inside the block — they are statements, not a comma list:
  ```
  drag px, py {
    confine to Board
    snap 20
    enabled locked == 0
  }
  ```
  `confine to <Zone>` clamps to a named item, `snap <grid>` snaps in pixels, `enabled <expr>` is active only while the expression is not 0 (a dynamic lock — no ternary needed).
- ⚠️ **`enabled` gates the GESTURE, not the handlers.** Once it is off the object stops being draggable, but
  `when pressed` / `when released` / `when clicked` **still fire** on it. Guard the handler body yourself
  (`when released { if done == 0 { … } }`) whenever it must run only while the gesture is live. (A `link`'s
  target index is the exception: it resolves to `0` — "no target reached" — on a gated-off release, so it
  can never hand you the previous gesture's answer.)
- **Drop zones**: by default the object's **center** is tested against the zone; `at pointer` tests the
  pointer instead. Define an explicit rectangle with `group "Zone" … hitbox <w> <h> { … }`.
- Several `when dropped on` per object are evaluated in declaration order (the right-zone / wrong-zones pattern).
- **`match` sugar** factors the whole drag+drop boilerplate — see [factoring](#reuse--factoring).

## Interactors

Higher-level pointer behaviors (each writes into your variables; all accept `{ enabled <expr> }`):

```
turn    <angle> around <x>,<y> [{ snap <deg> }]    # dial / clock hand → angle in RADIANS → rotation = angle
turnDeg <angle> around <x>,<y> [{ snap <deg> }]    # …in DEGREES → rotationDeg = angle  (rotationDeg = sugar for rotation = rad(…))
trace <progress> along <Group> [{ tolerance <px> }]# follow a path → progress 0..1 (monotone)
reveal <progress> [{ brush <px> · erase · cells <array> }]  # scratch/wipe the grabbed area → fraction 0..1 (cumulative across grabs)
link  <endX>, <endY>, <target> to <Group>          # pull a thread → end follows the pointer; <target> = hit index 1..n on release (0 = none)
```

Each output also accepts an **array element** (`drag hx[i], hy[i]`, `reveal seen[2]`) — the natural form
under `each` (see below).

### Drawing what a `trace` traced

`trace` gives you **how far** along the path the finger got, in arc length. Feed it to a shape's
[`draw`](scene-and-drawing.md#drawing-a-stroke-progressively-draw) — the same path, the same measure — and
the ink appears exactly under the finger:

```
scene { layer "Ink" {
  group "Route" { layer "c" { path "M60 300C220 120 340 480 500 300" nofill stroke #dddddd 18 cap round } }
  path "M60 300C220 120 340 480 500 300" nofill stroke #2255ff 18 cap round draw "progress" nohit
} }

object "Route" { trace progress along Route { tolerance 30 } }
```

The guide and the ink carry the **same path data**: `trace` measures on it, `draw` cuts on it. (Driving a
rectangular mask by `scaleX` instead ties the ink to *screen x*, which drifts from path length wherever the
curve is steep.)

### Rubbing a veil out (`reveal … erase`)

`reveal <p>` reports how MUCH of the zone was cleared. Add **`erase`** and the runtime *shows* it: the
grabbed object is drawn minus what the finger rubbed out. A scratch card is then a grey rectangle:

```
scene { layer "Jeu" {
  text "BRAVO" at 90,120 font "sans-serif" size 64 align left line 1.2 color #10141c
  group "Veil" at 200,150 { layer "c" { rect -180 -120 360 240 fill #8a94a6 } }
} }

object "Veil" {
  reveal cleared {
    brush 28
    erase              // the veil disappears under the finger — no cell artwork to author
  }
}
```

Nothing else to write: no grid of tiles, no `each`, no array. What disappears is exactly what the fraction
counts (one disc per cleared cell, sized to merge with its neighbours), so `cleared` and the picture always
agree. Erasing is **visual only** — the zone stays grabbable where it has been cleared, which is what lets
the scratching continue there.

> **Why not a `mask` layer?** Because a mask is an even-odd **clipping path**: two overlapping brush stamps
> *cancel* instead of accumulating, and nothing in the language creates a stamp at the pointer anyway
> (the scene's geometry is fixed; only channels move). `erase` does the accumulation in the runtime, where
> the gesture already keeps the state.

### Seeing WHERE it was scratched (`reveal … cells`)

`erase` rubs the veil out for you. `cells <array>` is the other half: it hands you the grid behind the
number — **where** — for when the scene has to *react* to the uncovered area rather than just show it
(score a region, light up the object underneath, drive your own cell artwork):

```
var cleared = 0
var scratched = fill(551, 0)         # one slot per cell; --check tells you the count

object "Veil" {
  reveal cleared {
    brush 32
    cells scratched                  # scratched[i] = 1 once cell i is cleared
  }
}

each "Cell" as i { opacity = 1 - scratched[i] }    # …and the veil disappears where it was rubbed
```

The grid is derived from the zone, so it is reproducible on paper: it covers the object's **world bbox**,
each cell is a **`brush` × `brush`** square, `cols = ceil(width / brush)`, `rows = ceil(height / brush)`,
and **`i = row * cols + col`** (cell `(col,row)` is centred at `minX + (col + 0.5) * brush`,
`minY + (row + 0.5) * brush`). A cell is cleared once its **centre** falls within `brush` of the pointer —
so a single touch clears a small plus-shape, not one square. Cells are written **once**, never back to 0:
the grid is as monotone as the fraction, and both agree. (The array is yours to read *and* write, but the
coverage behind it has no reset — so each new grab re-syncs the array from the interactor's own state,
rather than letting a scene show an intact cell over a zone counted as cleared.)

Declare the array at exactly `cols * rows` — `flatc --check` states the geometry and the exact
`var … = fill(N, 0)` to write whenever the sizes disagree, because a short array drops the writes past its
end in silence.

> A `reveal` target is grabbable **over its whole zone**, whatever its content currently looks like — under
> `erase`, and equally when the cells you fade to `opacity 0` stop being hittable (invisible things let the
> pointer through). Without that rule the scratching would work on the first stroke and then stall on the
> cleared area — invisible in a static render, visible only in a replayed `down/move/up`.

### Drawing the thread of a `link`

`link` gives you the end position and the target index; **the visible wire is yours to draw**. The idiom:
draw a horizontal bar of a known length, anchored at the source, then rotate and stretch it onto the end.

```
use "gesture"    // angle(cx, cy, px, py)   → radians
use "collision"  // dist(ax, ay, bx, by)    → length

scene {
  layer "Fils" {
    // A 100 px bar whose LEFT edge sits on the origin → scaling it stretches it away from the anchor.
    group "Fil" at 120,300 { layer "c" { rect 0 -1 100 2 fill #3355ff } }
  }
  layer "Jeu" { group "Src" at 120,300 { layer "c" { circle 0 0 20 fill #3355ff } } }
}

object "Src" { link ex, ey, hit to Cibles }
object "Fil" {
  opacity  = self.grabbed          // only visible while the thread is being pulled
  rotation = angle(120, 300, ex, ey)
  scaleX   = dist(120, 300, ex, ey) / 100   // 100 = the bar's DRAWN length
}
```

Two things make it work: the bar is drawn **from its own origin** (so `scaleX` stretches the far end, not
both), and the divisor is the bar's drawn length. With the source at a variable position, replace the
literals with its coordinates.

## Pointer gestures (drag delta, finger-scroll, tap vs drag)

`mouse.x`/`mouse.y` hold the pointer position inside **any** handler — including `when pressed` /
`when clicked` / `when released` (the press/release point, on touch too), so you can capture a **grab
anchor**. A grab **keeps tracking the pointer after it leaves the object** (pointer capture), so a drag is
never lost at the object's edge.

**Relative drag / finger-scroll** — accumulate the delta from the press anchor (one action per line):

```
object "List" {
  when pressed {
    a = mouse.y
    base = off
  }
  when dragged {
    off = base + (mouse.y - a)   // `off` scrolls by the finger delta
  }
}
```

**Mouse-wheel scroll** (desktop) — `mouse.wheel` is the wheel delta accumulated **this frame** (0 when the
wheel is still), read in an `every frame` accumulator — the same idiom as the finger drag:

```
every frame {
  off = clamp(off + mouse.wheel, 0, max)   // one notch ≈ tens of px; scale/clamp to taste
}
```

The player consumes the wheel (keeps the page from scrolling over the canvas) **only when the scene reads
`mouse.wheel`** — a scene that ignores it lets the page scroll normally.

**Tap vs drag on the same element.** `when clicked` fires on **release**, and only if the pointer stayed
put — a press that travels past a few px is a **drag**, not a click. So the *same* element can be both
tappable and draggable: a tap fires `clicked`, a drag fires `dragged`/the interactor, with **no phantom
click** when you drag. That's what makes "tap a card to pick it, drag the list to scroll" work on one zone:

```
object "Card" {
  when clicked { picked = id }                 // fires on a TAP only
  when dragged { off = base + (mouse.y - a) }  // a DRAG scrolls — `clicked` does not fire
}
```

## Feedback

An object can read **its own interaction state** in channel expressions: `self.hovered`, `self.grabbed`,
`self.pressed` (each `0`/`1`). So hover-lift and grab-squash are just expressions — no mirror variable,
no handler:

```
object "Button" {
  scaleX  = self.hovered ? 1.06 : 1
  scaleY  = self.grabbed ? 0.94 : 1
  opacity = self.hovered ? 0.85 : 1
}
```

The **`feedback` one-liner** generates these for you (auto-importing `use "feedback"`), composing per
channel so it never clashes with your `x`/`y` bindings:

```
object "Tile" {
  x = tx   y = ty
  feedback lift tilt dim shake(wrongZone)   // lift=hover grow · tilt=grab squash · dim=hover opacity · shake=refusal wobble
}
```

Or call the [`feedback` stdlib](expressions-and-stdlib.md#stdlib-packages) functions by hand
(`lift`/`dim`/`tilt`/`sink`/`shake`).

**Timed feedback** (a message/flash that fades over a readable duration) — `pulse(since, dur)` from
`use "feedback"` is a linear `1→0` ramp over `dur` seconds since the instant `since`. Capture the instant
in a handler so nothing is hidden:

```
var shown = -999
object "Hint" { opacity = pulse(shown, 4) }     // visible 4 s after each trigger, then gone
object "Piece" { when dropped on Wrong { shown = clock } }
```

(A multiplicative decay like `v * 0.86` is fine for a quick flash but vanishes before TEXT can be read —
`pulse` gives a duration you state.)

> ⚠️ **Capture the instant with `clock`, not `time`.** `pulse` and `shake` ride the monotone `clock`
> precisely because `time` **resets every `durationFrames`** (2.5 s by default). Timed on `time`, a
> one-shot end-of-game ramp *replays for ever* and a refusal wobble *skips* on every loop — with nothing
> on screen, and nothing at `--check`, to say so. `--check` now names any function of yours that reads
> `time` from inside a channel expression.

## Reuse / factoring

Cut repetition with compile-time sugar (all resolved at parse → zero runtime cost):

```
def gap = 70                              // a compile-time constant (removed at parse), used via $(…)
scene { layer "L" {
  repeat i from 0 to 4 { circle $(40 + i*gap) 80 6 fill #ffd98a }   // generate N items; $(expr) interpolates
} }
```

**Parameterized symbols** (a reusable visual) + **`each`** (shared behavior):

```
symbol "Key"(label) { layer "c" { rect -28 -28 56 56 fill #e8e8e8
  text "$(label)" font "sans-serif" size 24 align center line 1.2 color #111 box 56 56 } }

scene { layer "Pad" {
  repeat i from 0 to 8 { instance "Key"($(i+1)) as "K$(i)" at $(70 + (i%3)*80),$(80 + floor(i/3)*80) }
} }

each "Key" as i { when clicked { input = input * 10 + (i + 1) } }   // one handler per generated key
```

**`match`** — declarative pairing (factors drag+drop for a matching activity):

```
match Word1, Word2 onto Good, Bad {
  correct Word1 -> Good, Word2 -> Bad
  on correct as it { send "found", text(it) }
  on done { send "win" }
}
```

It generates, per item, `<Item>_placed` / `<Item>_ok` / `<Item>_zone` state and the drag+drop handlers;
you keep the visual (`var <Item>_x`/`_y` + your channel expressions).

## See also

- The expression language and stdlib → **[Expressions & stdlib](expressions-and-stdlib.md)**
- Receive `send` events / drive variables from the page → **[Host integration](host-integration.md)**
- Test interactions headlessly (gesture scripts, `scratch`/`connect`) → **[Tooling](tooling.md)**
- Pitfalls (event order, monotone reveal, `$()` in `each`…) → **[Gotchas](dsl-gotchas.md)**
