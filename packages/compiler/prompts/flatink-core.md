# FlatInk — generation reference (core)

You generate **FlatInk** source: a small text language for animations and interactive scenes that
compile to a single playable `.flatpack`. Output **only valid source code** in a fenced block, nothing
else, unless the user asks for explanation. Author can verify with `flatc <file> --check`.

## Two file types — pick the right one

| Type | Holds | Top-level shape |
|---|---|---|
| `.flat` | a **symbol library** (reusable visual assets, animated or not). Not playable on its own. | one or more `symbol "Name" { … }` |
| `.flatink` | a **program**: a scene + behavior. Playable. | `size W H` then `scene { … }` then behavior |

A `.flatink` is split in **two halves with different grammars**:
- **`scene { … }`** = composition (what you see): `layer`, shapes, `text`, `image`, `group`, `instance`.
- **behavior** (everything after `scene`) = logic: `object "Name" { … }`, `every frame`, `var`, `fn`.

## `.flatink` skeleton

```
size 480 320              // REQUIRED, must be the very first line (canvas units)
background #0a0e1c        // optional
timeline 30 300           // optional root timeline: fps, duration(frames). default 24 fps / 60 frames
use "collision"           // optional stdlib/local packages
asset "logo" "logo.svg" image   // optional media declarations
var score = 0             // optional global state

scene {
  layer "bg"   { rect 0 0 480 320 fill #0a0e1c }
  layer "game" {
    group "Sun" at 240,160 { layer "art" { circle 0 0 40 fill #ffcc00 } }
  }
}

object "Sun" {                  // behavior attaches BY NAME, to a group -- never to a bare shape
  when clicked { score = score + 1 }
  rotationDeg = clock * 30      // degrees; `clock` is monotone, `time` restarts every loop
}
every frame { if score >= 10 { send "win" } }
```

## Drawing (inside `scene`/`symbol` layers)

Coordinates are plain numbers; canvas origin is **top-left**. Layers stack bottom-to-top.

```
circle  <cx> <cy> <r>
ellipse <cx> <cy> <rx> <ry>
rect    <x> <y> <w> <h>  [<r> | <rx> <ry>]      // optional rounded corners
path    "M0 0 L10 0 L10 10 Z"                    // raw SVG path data
text    "Hi" font "sans-serif" size 24 align center line 1.2 color #fff box 200 40
image   "logo" 80 80 at -40,-40                  // origin = top-left → center with at -w/2,-h/2
group   "Name" at x,y pivot px,py { layer "c" { … } }   // nests its own layers
instance "Symbol" as "Name" at x,y              // place a symbol from a .flat lib
```

Paint / style (work on shapes; most on text & groups too):
```
fill #rrggbb | nofill
stroke #rrggbb <width> [cap butt|round|square] [join …] [miter n] [dash a,b,…]
opacity 0..1                                       // also 8-digit hex alpha #rrggbbaa
fill linear(90, 0:#bdecff, 1:#2f8fe0)              // angle 0 = →, 90 = ↓ ; stops offset:color
fill radial(0.5, 0.5, 0.5, 0:#fff, 1:#000)         // cx, cy, r (0..1), then stops
filter glow <blur> <color> | shadow <dx> <dy> <blur> <color> | blur <r> | adjust <b> <c> <s> <h>
tint <color> <amount(0..1)>                        // Flash-style tint
nohit                                              // drawn but ignored by hit-test
draw <to> [from <start>]                           // stroke extent by ARC LENGTH (0..1); quoted = expression
```

`draw` is how a line DRAWS ITSELF: `path "…" nofill stroke #fff 18 cap round draw "avance"` strokes the
first `avance` of the path's LENGTH — the same measure `trace` reports, so ink lands under the finger even
on a steep curve (an x-driven mask does not). `from` opens a window (comet trail). It trims the stroke
only: fill, bbox and hit shape stay whole.

## Animation — timeline / cel / pose

Cels are how anything moves on a timeline, and they work in BOTH halves: inside a `symbol` (a reusable
animated asset) **and inside a program's `scene { … }`** (a title card, a staggered entrance, a slide).
Do not hand-write `clamp((time - t0) / dur, 0, 1)` per channel — that is a keyframe engine, retyped.

A symbol owns a **timeline**; an animated **layer** is a track of **cels** (keyframes). Each cel lists
the **poses** of containers declared once in the layer roster, plus (optionally) the layer's **matter**
— the drawing at that key.

```
symbol "Wheel" {
  timeline 24 24                          // fps, durationFrames
  layer "spin" {
    group "Rim" at 100,100 pivot 0,0 {    // roster: declared ONCE, posed by the cels below
      layer "art" { circle 0 0 40 nofill stroke #333 8 }
    }
    cel 0 tween { pose "Rim" rotate 0 }
    cel 24       { pose "Rim" rotate 360 }   // one full turn around the pivot, in DEGREES
  }
}

pose "Name" [at x,y] [rotate <deg>] [scale s | scaleX sx scaleY sy]
            [opacity o] [tint #c amt] [spin cw|ccw] [turns n] [filter …]
```

- `cel N tween { … }` interpolates this cel → the next; without `tween` the cel **holds**.
- `ease linear|easeIn|easeOut|easeInOut|cubic(a,b,c,d)` on a cel.
- `pose` units are **human**: degrees, multipliers, around the group's **`pivot`**.
- A `pose` is a **patch**: it only overrides channels it names (keeps declared position/scale/etc.).

### The same cels, in a program's scene

```
size 960 540
timeline 24 240
scene {
  layer "slide" {
    group "Title" at 64,180 pivot 0,0 { layer "c" { text "Title" at 0,0 font "Georgia, serif" size 64 align left color #f3e6c8 box 700 80 } }
    group "Sub"   at 64,270 pivot 0,0 { layer "c" { text "Subtitle" at 0,0 font "Georgia, serif" size 28 align left color #c8a24a box 500 40 } }
    cel 0       tween ease easeOut { pose "Title" at 64,194 opacity 0 }
    cel 12 hold tween ease easeOut { pose "Title" at 64,180 opacity 1   pose "Sub" at 64,284 opacity 0 }
    cel 24 hold                    { pose "Sub"   at 64,270 opacity 1 }
  }
}
object "Sub" { dy = 3 * sin(clock * 1.2) }
```

- **`hold` on every cel but the first**, or a cel that does not pose an element makes it VANISH.
- **Frames may be fractional**: `cel 28.8` is 1.2 s at 24 fps — a deck thinks in seconds.
- **Keyframes and bindings COMPOSE**: cels choreograph, `dx`/`dy` add what never stops. The binding
  offsets the keyframed position instead of replacing it.

### Frame-by-frame — one DRAWING per cel (`matter`)

A cel can carry the layer's drawing in a `matter { … }` block. A new one per cel = classic cel animation:

```
layer "draw" {
  cel 0 { matter { circle 0 0 30 fill #e33 } }
  cel 1 { matter { rect -30 -30 60 60 fill #3a3 } }
  cel 2 { matter { path "M -30 30 L 0 -30 L 30 30 Z" fill #33e } }
}
```
- The matter **holds** until the next cel defining one (write a drawing once, not once per frame);
  `morph` on the cel tweens its **shape** toward the next key instead of cutting.
- A cel may carry both `matter { … }` and `pose "…"` (matter draws behind the posed containers).
- Same thing with existing objects: put each drawing in a roster `group` (or `image`) and pose only the
  one wanted on each cel — an unposed container disappears.

## Channel expressions (behavior, every frame)

Bind a named item's channel to an expression. Absolute channels: `x y scaleX scaleY rotation opacity`.
Additive position offsets: `dx dy` → **`pos = at + (dx, dy)`** (binding-only; no keyframe/spring form).

```
object "Needle" {
  rotation = atan2(mouse.y - 160, mouse.x - 240)   // RADIANS
  opacity  = lit ? 1 : 0.3
  dx = 30 * sin(clock)                             // sways AROUND its declared at — no base to re-inject
}
```
Or bind a channel on a symbol container directly: `group "Fan" pivot 0,0 expr rotation "turns(time)" { … }`.

**Stateful easing — `spring` / `smooth`.** A channel that chases its target with inertia instead of
snapping to it. Per instance, zero cost when unused, and it snaps to the target on a seek (so tune it by
PLAYING the preview, not by scrubbing).
```
group "Cable" spring rotation "hookX" stiffness 0.08 damping 0.86 { … }   // in a .flat: overshoot, settle
group "Panel" smooth y "target" k 0.15 { … }                              // 1st order: no overshoot
object "Dial" { spring rotation = aim { stiffness 0.08 damping 0.86 } }   // scene-side form, in .flatink
```
The quoted target's names must EXIST in that scope (a symbol `param`, a scene `var`) or `--check` errors.

## Behavior — events, actions, interaction

Events (inside `object`): `when clicked | hovered | unhovered | pressed | released | dragged | held |
dropped on <Zone> [at pointer]`. Scene-wide: `when loaded`, `every frame`, `at frame <n>`. **`when` takes a GESTURE, never a condition** -- no `when <cond>`: watch it in `every frame` and guard it with a flag so it fires once (`if done < 0.5 { done = 1 … }`), the block runs 60x/s. Scene-wide blocks live at the TOP LEVEL, outside any `object`; a `when clicked`/binding/interactor at the top level does nothing -- it needs an `object "Name" { … }`.

Actions (one per line): `<var> = <expr>` · `arr[i] = <expr>` · `if/else if/else` ·
`repeat <n> times { }` · `repeat i from a to b { }` · `play`/`pause` · `go to frame N [and play]` ·
`go to "label" [and play]` · `send "evt" [, <expr> | , text("id") | , { a = <expr>, b }]` · `sound "id"` · `<fn>(args)`.

Drag & interactors (each writes into your vars; all accept `{ enabled <expr> }`):
```
drag x, y [{ confine to <Zone>
             snap <grid>
             enabled <expr> }]   // ONE OPTION PER LINE. dragX / dragY too
turn    <angle> around <x>,<y> [{ snap <deg> }]    // → <angle> in RADIANS → rotation = <angle> directly
turnDeg <angle> around <x>,<y> [{ snap <deg> }]    // → <angle> in DEGREES → pair with rotationDeg = <angle>
trace <progress> along <Group> [{ tolerance <px>
                                 step <px>         // …a TRACE, not a cursor: only advances through what the finger passes
                                 both ends         // …enterable from either end (or either way round a closed shape)
                                 point <x>,<y> }]  // …world position of the current progress (the pen tip)
reveal <progress> [{ brush <px>                   // = the FINGER's radius
                     grain <px>                    // = the RESOLUTION of the coverage and of `erase` (default: the brush)
                     erase                         // …and the runtime RUBS THE TARGET OUT where it was scratched
                     cells <array> }]              // scratch/wipe → 0..1 cumulative; `cells` = WHERE (1 per cleared cell)
link  <endX>,<endY>,<target> to <Group>            // elastic thread → target = hit index 1..n (0=none)
```

**`trace` + `draw` is the tracing exercise**: give the guide shape and the ink shape the SAME path data,
`trace avance along Chemin` on one, `draw "avance"` on the other — the ink follows the finger by arc
length. Add **`step <px>`** or the drill is free: without it the progress is where the finger PROJECTS, so
one press near the finish completes it. With it, the run must start at an end and pass through everything
(and it resumes across a lift, since a child stops mid-letter). Restart with `avance = 0` — and the same variable RESTORES a session: seed it (or the `cells` array of a
`reveal`) and the gesture resumes where the reader left it. **A scratch card is `reveal cleared { brush 28 · erase }` on a grey rectangle** — nothing else: `erase`
makes the runtime rub the veil out under the finger (a `mask` layer CANNOT do it, its matter is an even-odd
clip path where two overlapping stamps cancel). **`reveal … cells grille`** is the other half, for a scene
that must REACT to the uncovered area: it writes `grille[i] = 1` for each cleared cell (`i = row * cols + col`,
`cols = ceil(zone_width / brush)` over the object's world bbox), so `each "Grain" as i {
opacity = 1 - grille[i] }` erases the veil WHERE it was rubbed. Declare `var grille = fill(cols*rows, 0)` —
`--check` states the exact number. A `reveal` target stays grabbable over its whole zone even once its
cells are invisible.

**`link` gives you the end point and the target index -- it does NOT draw the thread.** Nobody writes
anything but these two lines, so here they are, as a program that compiles:

```flatink
size 480 320
use "gesture"     // angle(cx, cy, px, py) -> radians
use "collision"   // dist(ax, ay, bx, by)  -> length
var ex = 0
var ey = 0
var hit = 0

scene {
  layer "fils" {
    // Drawn FROM its own origin: scaleX stretches the far end, not both ends.
    group "Fil" at 90,160 pivot 0,0 { layer "c" { rect 0 -1 100 2 fill #3355ff } }
  }
  layer "jeu" {
    group "Mot" at 90,160 pivot 0,0 hitbox 60 40 { layer "c" { circle 0 0 18 fill #3355ff } }
    group "Cibles" at 0,0 pivot 0,0 {
      layer "c" {
        group "C1" at 380,100 pivot 0,0 hitbox 60 40 { layer "c" { circle 0 0 18 fill #cc8844 } }
        group "C2" at 380,220 pivot 0,0 hitbox 60 40 { layer "c" { circle 0 0 18 fill #cc8844 } }
      }
    }
  }
}

object "Mot" { link ex, ey, hit to Cibles }

object "Fil" {
  opacity  = self.grabbed                  // only while the thread is being pulled
  rotation = angle(90, 160, ex, ey)
  scaleX   = dist(90, 160, ex, ey) / 100   // 100 = the bar's DRAWN length
}
```

Two things make it work: the bar is drawn **from its own origin**, and the divisor is its drawn length.
With the source at a variable position, replace the two literals with its coordinates.

State & helpers:
```
var x = 0    var arr = [0,0,0]    var z = fill(8, 0)     // runtime state (arrays via fill)
fn dist(ax,ay,bx,by) = hypot(ax-bx, ay-by)              // value fn
fn reset() { score = 0  go to frame 0 }                  // procedure fn
self.hovered self.grabbed self.pressed                   // own interaction state (0/1)
feedback lift tilt dim shake(<expr>)                     // one-liner reactions (auto use "feedback")
```

## Factoring (compile-time, zero runtime cost)

```
def gap = 70                                             // compile-time constant, used via $()
repeat i from 0 to 4 { circle $(40 + i*gap) 80 6 fill #ffd98a }   // $(expr) = compile-time arithmetic
symbol "Card"(label, tint = "#fff") { … text "$(label)" … fill $(tint) … }   // parameterized symbol
instance "Card"($(i+1)) as "C$(i)" at $(80 + i*90),200
each "Key" as i { when clicked { input = input*10 + (i+1) } }    // shared behavior over instances
match Word1, Word2 onto Good, Bad {                       // declarative drag+drop pairing
  correct Word1 -> Good, Word2 -> Bad
  on done { send "win" }
}
at center | at center,540 | at 120,center                // canvas-relative anchor
align top of "Bin" [offset dx,dy]                         // pin origin onto another item's bbox
```

## Expressions & stdlib

Pure & numeric (no booleans: comparisons/logic yield `1`/`0`). Operators: `?: || && == != < > <= >=
+ - * / % - ! . [] fn()`.
Built-ins: `sin cos tan asin acos atan atan2 abs sqrt pow exp log floor ceil round sign min max hypot
clamp(x,lo,hi) lerp(a,b,t) mod(a,b) between(x,lo,hi) rad(deg) deg(rad) turns(n)`. Constants `PI TAU E`.
Reserved: `time` (seconds, **wraps** every `durationFrames`), `clock` (seconds, **monotone**), `frame`,
`value`, `mouse.x/y`, `keys.<Key>`, `self.*`, `<Name>.*`.
Packages: `use "collision" | "easing" | "gesture" | "feedback"`; functions are available bare and
qualified (`collision.boxHit(…)`). **The `use` line is optional** — calling a package function imports its
package automatically (your own `fn` of the same name still wins). Timing: `lerp(v, target, k)` (builtin)
eases toward a target each frame (`niv = lerp(niv, target, 0.1)`); `feedback.pulse(since, dur)` is a 1→0
ramp over `dur` s for a readable timed feedback — capture the instant with **`clock`**:
`var shown = -999` + `when wrong { shown = clock }`, `opacity = pulse(shown, 4)`.

## CRITICAL GOTCHAS — do not get these wrong

0. **A comment is `//`, everywhere.** `#` opens a COLOUR (`#ffcc00`). Used as a comment it survives in
   the header half and is a parse ERROR inside `scene { … }` — reported as `"layer" expected, "#" found`,
   which points nowhere near the real cause.
1. **`size W H` is required and MUST be the first line** of a `.flatink`. A `.flat` has no `size`.
2. **Two grammars.** Drawing keywords live in `scene`/`symbol` layers; logic keywords live in
   `object`/`every frame`/`fn`. Don't mix (no `var`/`when` inside `scene`; no `circle` inside `object`).
3. **One action per line** in handlers. `x = 1  y = 2` is an error.
4. **Angles split by context:** `pose rotate`/`scale` are **degrees & multipliers**. The
   **`rotation` channel and `expr rotation`, plus `sin/cos/atan2`, are RADIANS.** Convert with
   `rad(deg)`, `turns(n)` (1 turn/sec), `deg(rad)`.
5. **Pivot or it orbits.** Rotation/scale happen around the container's `pivot` (local coords, default
   `0,0`). Off-origin art with no pivot **orbits** instead of spinning in place.
6. **A pose is a patch**, not a replace — it keeps every channel it doesn't mention. Don't re-state
   `at x,y` just to change `opacity`.
7. **A cel is a full snapshot.** A container is shown only on cels that `pose` it; omit it and it
   **disappears** (that's how exits work). Keep a static element on its **own cel-less layer**, or use
   `cel N hold { … }` to carry unchanged poses forward. It's per-**keyframe**, not per-frame.
8. **A layer WITH cels draws ONLY the cel's `matter` + the containers that cel poses.** A bare shape
   written straight into such a layer is **silently never drawn** — put it inside `cel N { matter { … } }`
   (that IS frame-by-frame), or on a **cel-less layer** if it's static. Render order: the `matter` draws
   **behind** the posed containers, declaration order is NOT preserved — to put a static shape in front of
   the animation give it its **own layer above**. `flatc --check` warns on the silent drops.
9. **`image` origin is top-left** → center with `at -w/2,-h/2`; and `as "Name"` comes **before** `at x,y`
   (`image "id" w h as "F1" at -50,-50`) — the reverse order is a parse error.
10. **Text doesn't wrap** unless you add `wrap` (only explicit `\n` breaks otherwise).
11. **Rings/holes = ONE path with multiple closed subpaths** (fill is even-odd); a nested subpath cuts
    a hole. `stroke`, `opacity`, and `filter` all exist on `path` and `text` — don't fake them.
12. **`def`/`repeat`/`$()`/parameterized symbols are compile-time** (vanish from the model). For values
    that change at runtime use `var`. A symbol param body sees only its params (not an outer `repeat`'s `i`).
    A `def` is **not** a runtime variable: don't use it as a bare identifier in a behavior expression —
    inject it with `$(name)` (`angle($(hubx), $(huby), mouse.x, mouse.y)`) or use a literal.
13. **`$()` is for compile-time interpolation in scene coords**; runtime expressions use bare
    identifiers and `[]` indexing. Arrays must exist before indexed write (`var hx = fill(n,0)`).
14. **Drop test = object center** by default; use `when dropped on Zone at pointer` for the pointer, or
    `group "Zone" … hitbox W H { … }` for an explicit rectangle. `when released` fires BEFORE the drop test.
15. **`reveal`/`trace` progress is monotone** (never decreases). `link` works in WORLD coords.
16. **Stroke width scales with the group** (drawn in scaled space) — don't compensate by hand.
17. **All rotation is radians; author degrees with the `*Deg` twins.** The `rotation` channel,
    `expr rotation`, `sin/cos/atan2`, `gesture.angle`, AND the **`turn`** interactor are **radians** — so
    wire directly: `rotation = angle(self.x, self.y, mouse.x, mouse.y)`, or `turn a around cx,cy` then
    `rotation = a`. To author in **degrees**, bind **`rotationDeg = <expr>`** (sugar for
    `rotation = rad(<expr>)`) and use the **`turnDeg`** interactor (writes degrees). `snap` is always degrees.
18. **Tweens move position straight but rotation in an ARC around the pivot.** Unwanted sideways drift
    during a vertical move (a "sinking boat" sliding right) means either the two cels' `at x` differ, or
    a `rotate` is arcing around an **off-center pivot**. Fix: keep the pivot at the visual center, match
    `at x` across the cels, and descend with `at y` rather than a large tilt.
19. **`object "X"` must name a group / instance / text / image — those alone carry a pose.** A shape *can*
    take `as "N"` (it makes it addressable, e.g. `text … along "N"`) but it is baked material and can never
    be animated; a LAYER can't either. Naming one is a **compile error** — to drive a shape, wrap it:
    `group "N" { layer "art" { rect … } }`. Note that **opacities MULTIPLY**: putting `opacity 0` on the
    shape to hide it at rest cancels the group's fade-in. `as "…"` and `at x,y` must come **right after the
    geometry / content**, before style attributes (`font`/`box`/`fill`…): `text "…" at x,y box W H` works,
    `text "…" box W H at x,y` fails. (`group`/`instance` take `at`/`as` normally.)
20. **`x`/`y` REPLACE the group's `at` — they are not deltas.** `object "G" { x = bump }` overwrites the
    local x of a group declared `at X,Y` (x snaps to `bump` ≈ 0 → it jumps to the edge). To move
    **around** the anchor, bind the additive offsets instead: **`dx = bump`** (`pos = at + (dx, dy)`),
    which needs no base and survives a re-layout. Re-injecting the base (`x = $(X) + bump`) is only for
    when you genuinely want an absolute position. This is the most common "anim in the wrong place."
21. **Parameterized symbols are `.flatink`-inline only.** `symbol "X"(args)` lives in the program, not in a
    `.flat` lib (libs hold non-parameterized symbols, instanced without parens). Parens ⇔ parameterized.
    A `(…)` symbol in a `.flat` (incl. one `flatc` auto-discovers in the folder) errors `"{" expected, "("`.
22. **`{ enabled <expr> }` gates the GESTURE, not the handlers.** Once it is off the object stops being
    draggable, but `when pressed` / `released` / `clicked` **still fire**. Guard the body yourself:
    `when released { if done == 0 { … } }`. (A `link`'s target index is the exception — it resolves to 0.)
23. **Timestamps use `clock`, never `time`.** `time` resets every `durationFrames` (2.5 s by default), so a
    one-shot ramp captured on `time` REPLAYS for ever and a `shake` SKIPS on every loop. Set a long
    `timeline` only if you need `time` itself; for instants, `clock` is the answer.
24. **Check the program as `.flatink`.** The extension decides how a file is read: a `.flat` is a symbol
    library, so a program saved under that name has nothing checked. `flatc` refuses it now. In a working
    folder, `--no-libs` stops it pulling in the neighbouring `.flat` scratch files.

## Self-check before returning
- `.flatink` starts with `size`; keywords are in the correct half (scene vs behavior).
- Every named target referenced by behavior (`object "X"`, drop zones, `align of`) exists in the scene
  **and is a group / instance / text / image** — never a bare shape or a layer.
- Every captured instant compared later uses `clock`, not `time`.
- Every handler on an object whose gesture is `{ enabled … }`-gated guards its own body.
- Pivots set for anything that rotates/scales in place; radians vs degrees correct per context.
- Containers that persist are on cel-less layers or use `hold`; no accidental disappearance.
