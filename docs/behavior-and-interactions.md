# Behavior & interactions

Everything after the `scene { … }` block is behavior. It attaches to named scene items via
`object "Name" { … }`, or runs scene-wide via `every frame { … }` and timeline hooks.

```
var score = 0

object "Coin" {
  when clicked { score = score + 1 }     # an EVENT handler (actions)
  rotation = time * 90                    # a CHANNEL binding (expression, every frame)
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
`label <frame> "name"`.

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
send "<event>" [, <expr> | , text("<id>")]   # emit an event to the host
sound "<assetId>"                        # one-shot audio
```

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
  rotation = atan2(mouse.y - 160, mouse.x - 240)   # point at the cursor (RADIANS)
  opacity  = lit ? 1 : 0.3
}
```

`rotation` is in **radians** (like `sin`/`cos`/`atan2`). To author in **degrees**, bind **`rotationDeg`**
instead — sugar for `rotation = rad(<expr>)`: `rotationDeg = 45`, `rotationDeg = handAngle`.

`x`/`y` are **absolute** — they REPLACE the item's declared `at X,Y`. For motion **around** the anchor,
bind the additive offsets **`dx`/`dy`** instead: `pos = at + (dx, dy)`, so `dx = 30*sin(time)` wobbles a
group `at 620,150` around 620 with no base to re-inject (and `dx`/`dy` add on top of `x`/`y` if both are
bound). Offsets are binding-only — no keyframe/`spring`/`smooth` form. See the
[absolute-vs-offset gotcha](dsl-gotchas.md).

`self.x`/`self.y`/… is the item's own current pose; `mouse.x`/`mouse.y` (and `mouse.wheel`, the per-frame
scroll delta), `time`, `frame`, variables and named objects (`Target.x`) are all available — see
[Expressions](expressions-and-stdlib.md).

## Drag & drop

```
object "Piece" {
  drag px, py                            # follow the pointer, writing into px/py (use them: x = px, y = py)
  x = px   y = py
  when dropped on Slot at pointer { placed = 1 }
}
```

- `drag x, y` / `dragX x` / `dragY y` — the gesture writes the position into your variables.
- `{ confine to <Zone> }` clamp · `{ snap <grid> }` pixel-snap · `{ enabled <expr> }` active only while the expression ≠ 0 (a dynamic lock — no ternary needed).
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
reveal <progress> [{ brush <px> }]                 # scratch/wipe the grabbed area → fraction 0..1 (cumulative across grabs)
link  <endX>, <endY>, <target> to <Group>          # pull a thread → end follows the pointer; <target> = hit index 1..n on release (0 = none)
```

Each output also accepts an **array element** (`drag hx[i], hy[i]`, `reveal seen[2]`) — the natural form
under `each` (see below).

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
    off = base + (mouse.y - a)   # `off` scrolls by the finger delta
  }
}
```

**Mouse-wheel scroll** (desktop) — `mouse.wheel` is the wheel delta accumulated **this frame** (0 when the
wheel is still), read in an `every frame` accumulator — the same idiom as the finger drag:

```
every frame {
  off = clamp(off + mouse.wheel, 0, max)   # one notch ≈ tens of px; scale/clamp to taste
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
  when clicked { picked = id }                 # fires on a TAP only
  when dragged { off = base + (mouse.y - a) }  # a DRAG scrolls — `clicked` does not fire
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
  feedback lift tilt dim shake(wrongZone)   # lift=hover grow · tilt=grab squash · dim=hover opacity · shake=refusal wobble
}
```

Or call the [`feedback` stdlib](expressions-and-stdlib.md#stdlib-packages) functions by hand
(`lift`/`dim`/`tilt`/`sink`/`shake`).

**Timed feedback** (a message/flash that fades over a readable duration) — `pulse(since, dur)` from
`use "feedback"` is a linear `1→0` ramp over `dur` seconds since the instant `since`. Capture the instant
in a handler so nothing is hidden:

```
var shown = -999
object "Hint" { opacity = pulse(shown, 4) }     # visible 4 s after each trigger, then gone
object "Piece" { when dropped on Wrong { shown = time } }
```

(A multiplicative decay like `v * 0.86` is fine for a quick flash but vanishes before TEXT can be read —
`pulse` gives a duration you state.)

## Reuse / factoring

Cut repetition with compile-time sugar (all resolved at parse → zero runtime cost):

```
def gap = 70                              # a compile-time constant (removed at parse), used via $(…)
scene { layer "L" {
  repeat i from 0 to 4 { circle $(40 + i*gap) 80 6 fill #ffd98a }   # generate N items; $(expr) interpolates
} }
```

**Parameterized symbols** (a reusable visual) + **`each`** (shared behavior):

```
symbol "Key"(label) { layer "c" { rect -28 -28 56 56 fill #e8e8e8
  text "$(label)" font "sans-serif" size 24 align center line 1.2 color #111 box 56 56 } }

scene { layer "Pad" {
  repeat i from 0 to 8 { instance "Key"($(i+1)) as "K$(i)" at $(70 + (i%3)*80),$(80 + floor(i/3)*80) }
} }

each "Key" as i { when clicked { input = input * 10 + (i + 1) } }   # one handler per generated key
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
- Test interactions headlessly (gesture scripts, `scratch`/`connect`) → **[Tooling](tooling.md)**
- Pitfalls (event order, monotone reveal, `$()` in `each`…) → **[Gotchas](dsl-gotchas.md)**
