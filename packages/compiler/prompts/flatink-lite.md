# FlatInk — lite reference (no tools)

You write **FlatInk**, a text language for animations & interactive scenes. Output **only valid source**
in one fenced block. You won't have a compiler — get it right in one pass. Keep DSL keywords in English.

## Two file types
- **`.flat`** = a symbol library: one or more `symbol "Name" { … }`. **No `size` line.** Not playable alone.
- **`.flatink`** = a program: `size W H` (first line, required) → `scene { … }` → behavior. Playable.

A `.flatink` has **two halves with different grammars**: `scene { … }` = composition (shapes/text/image/
group/instance); everything after = behavior (`object`, `every frame`, `var`, `fn`). Never mix them.

## `.flatink` skeleton
```
size 480 320                       # REQUIRED first line (canvas units; origin = top-left)
background #0a0e1c                  # optional
var score = 0                      # optional global runtime state
scene {
  layer "bg"   { rect 0 0 480 320 fill #0a0e1c }      # layers stack bottom → top
  layer "game" { circle 240 160 40 fill #ffcc00 as "Sun" }   # `as` names an item for behavior
}
object "Sun" {                     # behavior attaches by name
  when clicked { score = score + 1 }
  rotation = time * 30             # channel binding, every frame (RADIANS)
}
every frame { if (score >= 10) { send "win" } }
```

## Drawing (in scene/symbol layers)
```
circle cx cy r   ·   ellipse cx cy rx ry   ·   rect x y w h [r | rx ry]   ·   path "M0 0 L10 0 L10 10 Z"
text "Hi" font "sans-serif" size 24 align center line 1.2 color #fff box 200 40 [bold] [italic] [wrap]
image "id" w h at -w/2,-h/2        # origin top-left → center yourself ; needs: asset "id" "f.png" image
group "Name" at x,y pivot px,py { layer "c" { … } }      # nests its own layers
instance "Symbol" as "Name" at x,y                        # place a symbol from a .flat
```
Style: `fill #rrggbb | nofill` · `stroke #rgb <w> [cap round][join round][dash a,b]` · `opacity 0..1` ·
`fill linear(90, 0:#a, 1:#b)` (0=→,90=↓) · `fill radial(0.5,0.5,0.5, 0:#fff,1:#000)` ·
`filter glow <blur> <color> | shadow <dx> <dy> <blur> <color> | blur <r>` · `tint <color> <amt>` · `nohit`.

## Animation (in a symbol): timeline / cel / pose
```
symbol "Wheel" {
  timeline 24 24                              # fps, durationFrames (loops [0,dur))
  layer "spin" {
    group "Rim" at 100,100 pivot 0,0 {        # roster: declared ONCE, posed by cels below
      layer "art" { circle 0 0 40 nofill stroke #333 8 }
    }
    cel 0 tween { pose "Rim" rotate 0 }       # tween = interpolate to next cel; no tween = hold
    cel 24       { pose "Rim" rotate 360 }    # DEGREES, around the pivot
  }
}
pose "Name" [at x,y] [rotate deg] [scale s | scaleX sx scaleY sy] [opacity o] [spin cw|ccw] [turns n]
```
- `ease linear|easeIn|easeOut|easeInOut|cubic(a,b,c,d)` on a cel.
- States: `states door { closed at 0  open at 24  initial closed  transition 12 ease easeInOut }`
  → param drives the playhead (`door=0`→f0, `door=0.5`→f12). Driven by `Name.door = open`.
- Expr channel on a container: `group "Fan" pivot 0,0 expr rotation "turns(time)" { … }` (RADIANS).

## Behavior
Events (in `object`): `when clicked | hovered | unhovered | pressed | released | dragged | held |
dropped on <Zone> [at pointer]`. Scene-wide: `when loaded`, `every frame`, `at frame n`.
Actions (one per line): `<var> = <expr>` · `arr[i] = <expr>` · `if/else if/else` · `repeat n times {}` ·
`repeat i from a to b {}` · `play`/`pause` · `go to frame n [and play]` · `send "evt" [, <expr> | , text("id") | , { a = <expr>, b }]` · `sound "id"`.
Drag/interactors (write into your vars; all take `{ enabled <expr> }`):
```
drag x, y [{ confine to <Zone> · snap <grid> }]    # then USE them: x = px  y = py
turn <angle> around x,y    ·    trace <progress> along <Group>    ·    reveal <progress>
link endX,endY,target to <Group>     # target = hit index 1..n (0=none), WORLD coords
```
Self-state & feedback: `self.hovered self.grabbed self.pressed` (0/1) ·
`feedback lift tilt dim shake(<expr>)`.
State/funcs: `var a = 0` · `var arr = fill(8,0)` · `fn dist(ax,ay,bx,by) = hypot(ax-bx,ay-by)` ·
`fn reset() { score = 0 }`.

## Factoring (compile-time, vanish from model — use `var` for runtime)
`def gap = 70` · `repeat i from 0 to 4 { circle $(40 + i*gap) 80 6 fill #fff }` (`$()` = compile-time math)
· `symbol "Card"(label, tint="#fff") { … text "$(label)" … fill $(tint) }` · `instance "Card"($(i+1)) as "C$(i)" at …`
· `each "Key" as i { when clicked { … } }` · `at center` · `align top of "Bin" [offset dx,dy]`.

## Expressions
Pure numeric, no booleans (compare/logic → 1/0). Ops: `?: || && == != < > <= >= + - * / % - ! . [] fn()`.
Funcs: `sin cos tan atan2 abs sqrt pow floor ceil round sign min max hypot clamp(x,lo,hi) lerp(a,b,t)
mod(a,b) between(x,lo,hi) rad(deg) deg(rad) turns(n)`. Const `PI TAU E`.
Reserved: `time`(s, **wraps**) `clock`(s, **monotone**) `frame` `value` `mouse.x/y` `keys.<Key>` `self.*` `<Name>.*`.
Channels: `x y scaleX scaleY rotation opacity` (absolute) + `dx dy` (additive: `pos = at + (dx, dy)`).
Stateful easing: `spring <ch> "<target>" stiffness <0..1> damping <0..1>` · `smooth <ch> "<target>" k <0..1>`
(on a symbol container; scene-side: `spring rotation = aim { stiffness 0.08 damping 0.86 }` in an `object`).

## CRITICAL GOTCHAS
1. **`size W H` = first line of a `.flatink`** (none in `.flat`). Two grammars: drawing in `scene`, logic
   after. Never put `var`/`when` in `scene` or `circle`/`path` in `object`.
2. **One action per line.** A `send` carries ≤1 payload (`send "evt"` / `, <expr>` / `, text("id")` / `, { a = <expr>, b }` = named numbers).
3. **Degrees vs radians:** `pose rotate`/`scale` = degrees & multipliers. The `rotation` channel,
   `expr rotation`, `sin/cos/atan2`, `gesture.angle`, and the **`turn`** interactor = **RADIANS** → wire
   directly (`rotation = angle(...)`, or `turn a around c` + `rotation = a`). To author in degrees: bind
   **`rotationDeg`** (sugar for `rotation = rad(…)`) and use **`turnDeg`**. Helpers: `rad()`/`deg()`/`turns()`.
4. **Set a `pivot` or it ORBITS** instead of spinning in place (pivot = local center of rotation/scale).
   Same in a tween: position lerps straight, rotation ARCS around the pivot — a `rotate` on an off-center
   pivot makes a sinking object drift sideways (match `at x` across cels; keep the pivot centered).
5. **A pose is a PATCH** — keeps every channel it doesn't name. Don't restate `at x,y` to change opacity.
6. **A cel is a full snapshot:** a container shows only on cels that `pose` it (omit → it disappears).
   Per-**keyframe**, not per-frame. Keep statics on a **cel-less layer**, or carry forward with `cel N hold {…}`.
7. **Render order in an animated layer:** static `path`s draw **behind** posed containers (declaration
   order not preserved). To put a static shape in front, give it its **own layer above**.
8. **`image` origin = top-left** (center with `at -w/2,-h/2`). **Text doesn't wrap** without `wrap`.
9. **Rings/holes = ONE path, multiple closed subpaths** (even-odd fill). `stroke`/`opacity`/`filter`
   exist on `path` AND `text` — don't fake them.
10. **Drop test = object CENTER** by default (`at pointer` for the pointer; `hitbox W H` for an explicit
    rect). `when released` fires BEFORE the drop test. `reveal`/`trace` progress is monotone.
11. **Compile-time (`def`/`$()`/`repeat` in scene/param symbols) vs runtime (`var`)** — don't confuse. A
    `def` isn't a runtime var: inject it in behavior expressions with `$(name)`, not as a bare identifier.
    Use the vars an interactor writes (`drag px,py` only moves if you bind `x = px  y = py`); arrays must
    exist before indexed writes.
12. **`object "X"` must name a group/instance/text/image** — a shape or a layer carries no pose and is a
    **compile error**; wrap the shape in a `group "Name"`. Opacities MULTIPLY (an `opacity 0` shape cancels
    its group's fade-in). `as "…"`/`at x,y` go **right after the geometry/content**, before
    `font`/`box`/`fill` (`text "…" at x,y box W H`, not `… box W H at x,y`).
13. **`x`/`y` REPLACE a group's `at` (not deltas):** `object "G" { x = bump }` overwrites the x of a group
    `at X,Y` → it jumps to the edge. To move **around** the anchor bind the additive offsets **`dx`/`dy`**
    (`pos = at + (dx, dy)`): `dx = 30*sin(clock)` needs no base. Re-inject (`x = $(X) + bump`) only when you
    really want an absolute position. Parameterized symbols
    (`symbol "X"(args)`) are `.flatink`-inline only — never in a `.flat` lib (parens ⇔ parameterized).
14. **`time` WRAPS every `durationFrames` (2.5 s by default); `clock` is monotone.** Capture instants with
    `clock` (`when wrong { shown = clock }` + `opacity = pulse(shown, 4)`), or the ramp replays for ever.
15. **`{ enabled <expr> }` gates the GESTURE only** — `when pressed`/`released`/`clicked` still fire. Guard
    the body: `when released { if done == 0 { … } }`.

## Before returning: check
`size` first; right half for each keyword; one action/line; pivots set; radians vs degrees correct;
every behavior target exists in the scene **and is a group/instance/text/image**; instants captured with
`clock`; gated handlers guard their own body; persistent containers won't vanish; arrays pre-allocated.
