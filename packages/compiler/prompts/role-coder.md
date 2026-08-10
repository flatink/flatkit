# FlatInk for a CODER — interactive `.flatink` programs

**Your role:** build **interactive scenes** — state, events, drag/drop, gesture interactors, scoring,
and the declarative factoring sugar. You wire behavior to named scene items.

**Output contract:** a `.flatink` program. Emit **only the code** in a fenced block. Verify and test
headlessly (no browser):
```
flatc game.flatink --check                              // semantic + layout lint (exit ≠0 on ERROR)
flatc game.flatink --play --script gestures.json --trace // replay gestures, see sends + var diffs
```

## File shape — TWO grammars, one file

```
size 480 320              // REQUIRED, first line
background #0a0e1c
use "collision"           // stdlib: collision | easing | gesture | feedback
var score = 0             // global runtime state (top of file)

scene {                   // -- HALF 1: composition (what you see) --
  layer "game" {
    group "Sun" at 240,160 { layer "art" { circle 0 0 40 fill #ffcc00 } }
  }
}

object "Sun" {            // -- HALF 2: behavior, attaches by name --
  when clicked { score = score + 1 }
  rotationDeg = clock * 90   // channel binding, evaluated every frame
}
every frame { if score >= 10 { send "win" } }
```
**Drawing keywords (`circle`, `path`, `group`…) live ONLY in `scene`. Logic keywords (`var`, `when`,
`object`, `fn`, `if`) live ONLY after it.** They don't share a grammar.

## State, events, actions

```
var score = 0    var slots = [0,0,0]    var seen = fill(8, 0)     // arrays via literal or fill(n,v)
```
Events (in `object "Name"`): `when clicked | hovered | unhovered | pressed | released | dragged | held
| dropped on <Zone> [at pointer]`. Scene-wide: `when loaded`, `every frame`, `at frame <n>`.

Actions — **one per line**:
```
<var> = <expr>          arr[<expr>] = <expr>          // `set` keyword optional; nested indices ok
if <c> { … } [else if <c> { … }] [else { … }]
repeat <n> times { … }          repeat i from a to b { … }      // RUNTIME loops (bounded)
play   pause   go to frame <n> [and play|and pause]   go to "<label>" [and play]
send "<evt>" [, <expr> | , text("<id>") | , { a = <expr>, b }]   sound "<assetId>"   <fn>(<args>)
```

## Channel bindings & expressions

Drive `x y scaleX scaleY rotation opacity` (absolute) every frame, plus `dx dy` — additive position
offsets, `pos = at + (dx, dy)`:
```
object "Needle" {
  rotation = atan2(mouse.y - 160, mouse.x - 240)   // RADIANS
  opacity  = lit ? 1 : 0.3
  dx = 30 * sin(clock)                             // sways AROUND its declared at — no base to re-inject
}
```
Chase a target with inertia instead of snapping to it:
```
object "Dial" { spring rotation = aim { stiffness 0.08 damping 0.86 } }   // smooth y = target { k 0.15 }
```
Pure numeric expressions (no booleans — logic/compares yield `1`/`0`). Operators `?: || && == != < >
<= >= + - * / % - ! . [] fn()`. Built-ins: `sin cos tan atan2 abs sqrt pow exp log floor ceil round
sign min max hypot clamp(x,lo,hi) lerp(a,b,t) mod(a,b) between(x,lo,hi) rad deg turns`. Constants
`PI TAU E`. Reserved: `time` (s), `frame`, `value`, `mouse.x/y`, `keys.<Key>`, `self.*`, `<Name>.*`.

Functions: `fn dist(ax,ay,bx,by) = hypot(ax-bx, ay-by)` (value) · `fn reset() { score = 0 }` (procedure).

## Drag, drop & interactors (each writes into your vars; all take `{ enabled <expr> }`)

```
object "Piece" {
  drag px, py {
    confine to Board
    snap 20
  }                                               // one option per LINE. dragX / dragY for one axis
  x = px   y = py                                 // USE the vars it writes
  when dropped on Slot at pointer { placed = 1 }
}
turn    <angle> around x,y [{ snap <deg> }]       // → RADIANS → rotation = <angle> directly
turnDeg <angle> around x,y [{ snap <deg> }]       // → DEGREES → pair with rotationDeg = <angle>
trace <progress> along <Group> [{ tolerance <px> }]  // follow path → 0..1 monotone
reveal <progress> [{ brush <px> }]                // scratch/wipe grabbed area → 0..1 cumulative
link  endX,endY,target to <Group>                 // elastic thread; target = hit index 1..n (0=none), WORLD coords
```

## Feedback (reactions without handlers)

```
object "Tile" {
  x = tx   y = ty
  feedback lift tilt dim shake(wrongZone)   // lift=hover grow · tilt=grab squash · dim=hover dim · shake=wobble
}
```
Or read state directly: `scaleX = self.hovered ? 1.06 : 1`, `scaleY = self.grabbed ? 0.94 : 1`.

## Factoring — compile-time, zero runtime cost

```
def gap = 70
repeat i from 0 to 4 { circle $(40 + i*gap) 80 6 fill #ffd98a }      // $(…) = compile-time math
symbol "Key"(label) { layer "c" { rect -28 -28 56 56 fill #e8e8e8
  text "$(label)" font "sans-serif" size 24 align center line 1.2 color #111 box 56 56 } }
scene { layer "Pad" {
  repeat i from 0 to 8 { instance "Key"($(i+1)) as "K$(i)" at $(70 + (i%3)*80),$(80 + floor(i/3)*80) }
} }
each "Key" as i { when clicked { input = input*10 + (i+1) } }        // one handler per generated instance
```
`match` factors a whole drag+drop matching activity:
```
match Word1, Word2 onto Good, Bad {
  correct Word1 -> Good, Word2 -> Bad
  lock on wrong                              // optional; absent = retryable
  on correct as it { send "found", text(it) }
  on done { send "win" }
}
```
It generates per item `<Item>_placed` / `<Item>_ok` / `<Item>_zone`; you keep the visual
(`var <Item>_x`/`_y` + your channel expressions).

## CRITICAL GOTCHAS

1. **`size W H` first line, required.** Then `scene { … }`, then behavior.
2. **Two grammars — don't cross them.** No `var`/`when`/`if` inside `scene`; no `circle`/`path` inside
   `object`. Drawing in the scene half, logic in the behavior half.
3. **One action per line.** `x = 1  y = 2` errors. `send "evt", x = 1` is a footgun error (a `send`
   carries at most one payload: `send "evt"`, `send "evt", <expr>`, `send "evt", text("id")`, or the
   record `send "evt", { a = <expr>, b }` — several NAMED numbers in one event, `{ b }` = `{ b = b }`).
4. **Radians by default; `*Deg` twins for degrees.** `rotation`, `sin/cos/atan2`, `gesture.angle`, and the
   **`turn`** interactor are radians — wire directly: `rotation = angle(self.x, self.y, mouse.x, mouse.y)`,
   or `turn a around c` then `rotation = a`. To author in degrees, bind **`rotationDeg`** (sugar for
   `rotation = rad(…)`) and use **`turnDeg`** (writes degrees). Ad-hoc convert with `rad()`/`deg()`/`turns()`.
5. **`def` / `repeat … from`(scene) / `$()` / parameterized symbols are COMPILE-TIME** — they vanish from
   the model. For runtime state use `var`. ⚠️ `repeat … times` / `repeat i from..to` **inside `object`**
   is a *runtime* loop (different thing). A symbol param body sees only its params, not an outer `repeat`'s `i`.
   A `def` is **not** a runtime variable — don't use it bare in a behavior expression; inject with
   `$(name)` (`angle($(hubx), $(huby), …)`) or a literal.
6. **Use the vars an interactor writes.** `drag px, py` only moves the object if you bind `x = px  y = py`.
   Outputs accept array elements (`drag hx[i], hy[i]`) — the natural form under `each` (array must exist).
7. **Drop test = object CENTER** by default. `when dropped on Zone at pointer` tests the pointer;
   `group "Zone" … hitbox W H { … }` sets an explicit drop rectangle. Several `when dropped on` per
   object run in declaration order (right-zone / wrong-zones pattern).
8. **Event order on release:** `when released` fires **BEFORE** the drop test; `link`/`drag` write their
   output vars before `released`/`dragged`, so a release handler can read `<target>` already.
9. **`reveal`/`trace` progress is monotone** (never decreases; reveal is cumulative across grabs).
   `link` is in WORLD coords — place sources and targets at the scene root.
10. **Distinct instance names** under `each`/`repeat` (`as "K$(i)"`) so each handler targets its own item.
11. **`object "X"` must name a group / instance / text / image.** A shape *can* take `as "N"` (addressable,
    e.g. `text … along "N"`) but carries no pose and can never be animated; a LAYER can't either — naming
    one is a **compile error**. Wrap the shape: `group "N" { layer "art" { … } }`. Opacities MULTIPLY, so an
    `opacity 0` shape cancels its group's fade-in. `as "…"`/`at x,y` go **right after the geometry/content**,
    before `font`/`box`/`fill` (`text "…" at x,y box W H`, not `… box W H at x,y`). Stable text id for
    payloads: `text "…" as "txt_id" …`.
12. Test with `--play --script` using **semantic gestures** (by name): `{"type":"drag","source":"Card1",
    "target":"ZoneA"}`, `tap`, `scratch`, `connect`, `wait`(frames), `key`(name/frames = hold a key),
    `expect`(sends/vars). Unknown name = hard error.
13. **`x`/`y` REPLACE the group's `at` — they are not deltas.** `object "G" { x = bump }` overwrites the
    local x of a group declared `at X,Y` (x → `bump` ≈ 0, so it snaps to the edge). To move **around** the
    anchor bind the additive offsets: **`dx = bump`** (`pos = at + (dx, dy)`) — no base to re-inject, and it
    survives a re-layout. Re-injecting (`x = $(X) + bump`) is only for a genuinely absolute position. The
    most common "anim shows up in the wrong place."
14. **`time` WRAPS every `durationFrames` (2.5 s by default); `clock` is monotone.** Any instant you capture
    and compare later must use `clock` — `when wrong { shown = clock }` + `opacity = pulse(shown, 4)`.
    On `time`, a one-shot end-of-game ramp replays for ever and a `shake` skips on every loop.
15. **`{ enabled <expr> }` gates the GESTURE, not the handlers** — `when pressed`/`released`/`clicked` keep
    firing. Guard the body: `when released { if done == 0 { … } }`. (A `link`'s target index resolves to 0.)
16. **Check the program as `.flatink`** — a `.flat` is a symbol library, so a program under that name is not
    verified at all (`flatc` refuses it now). `--no-libs` ignores the `.flat` scratch files next to it.

## Self-check
- First line `size`; drawing vs logic in the correct half; one action per line.
- Every behavior target (`object "X"`, drop zones, `align/link/trace` groups) is a named scene item
  **and is a group / instance / text / image** — never a bare shape or a layer.
- Instants captured with `clock`, not `time`; `{ enabled … }`-gated handlers guard their own body.
- Interactor output vars are actually consumed by channel bindings; arrays pre-allocated.
- Radians where required; compile-time (`def`/`$()`) vs runtime (`var`) used correctly.
