# Animating a symbol (`.flat`)

> How a `.flat` symbol moves over time: the **timeline / cel / pose** model (Flash-style), the `pose`
> keywords (`rotate`, `scale`, `opacity`, `spin`…), pivots, tweens, and how to preview the result.
> If you only need static composition, see [Scene & drawing](scene-and-drawing.md).

## The model in one paragraph

A symbol owns a **timeline** (`timeline <fps> <durationFrames>`). Each animated **layer** is a time
track: a sequence of **cels** (layer-wide keyframes). A cel lists the **poses** of the containers
present at that frame (a `pose` per roster item) and, optionally, the **matter** (static drawing) at
that key. Between two cels the layer either **holds** the last key or **tweens** toward the next one.

```
symbol "Wheel" {
  timeline 24 24                 ← 24 fps, 24 frames (loops once per second)
  layer "spin" {
    group "Rim" at 100,100 pivot 0,0 {   ← the roster: declared ONCE, posed by the cels below
      layer "art" { circle 0 0 40 nofill stroke #333 8 }
    }
    cel 0 tween { pose "Rim" rotate 0 }
    cel 24       { pose "Rim" rotate 360 }   ← one full turn around the pivot, in DEGREES
  }
}
```

Preview it without authoring a wrapper:

```
flatc --preview Wheel.flat --render -o wheel.png   # a PNG (frame 0)
flatc --preview Wheel.flat -o wheel.flatpack        # a playable .flatpack for the browser player
```

## `pose` — the keyframe of a container

```
pose "Name" [at <x>,<y>] [rotate <deg>] [scale <s> | scaleX <sx> scaleY <sy>]
            [opacity <o>] [tint <#color> <amount>] [spin cw|ccw] [turns <n>] [filter …]
```

- **`rotate <deg>` and `scale`/`scaleX`/`scaleY` are in human units** (degrees, multipliers) and apply
  **around the group's `pivot`** — no matrices, no radians, no trigonometry. `rotate 90` is a quarter
  turn; `scale 2` is double size.
- **`at <x>,<y>`** places the container's local **origin** in parent space. `rotate`/`scale` then turn
  and scale around the `pivot` point (see below), keeping it anchored.
- **`matrix(a,b,c,d,e,f)`** is still accepted as an escape hatch, but you almost never need it.

### Patch semantics — a pose only overrides what it states

A pose **inherits** every channel it does not mention from the container's resting pose (its declaration
in the roster) — position, rotation, scale, opacity, tint, filters. So:

```
pose "Boat" opacity 0.5        ← keeps the Boat's declared position/rotation/scale; only dims it
pose "Boat" rotate 3           ← keeps its position and scale; only tilts it 3°
```

You do **not** re-state `at x,y` in every cel just to change opacity. (This is a change from older
builds where a partial pose snapped to `0,0`.)

## Pivot vs `at` — where things turn

- **`pivot <x>,<y>`** (set on the container in the roster, in its **local** coordinates) is the center
  of rotation **and** scale **and** tween interpolation. Default is the local origin `0,0`.
- **`at <x>,<y>`** (on the pose) is where the local origin lands in the parent.

**Rule of thumb:** set the group's `pivot` to its visual center, then `rotate`/`scale`/`spin` turn it in
place. A wheel whose art is centered on its local origin needs no pivot; a wheel drawn off-origin must
set `pivot` to its hub, or it will **orbit** instead of spin.

```
group "Hand" at 200,200 pivot 0,-60 {   ← pivot at the clock center, 60px below the hand's tip
  layer "art" { rect -4 -60 8 60 fill #111 }
}
…
cel 0 tween { pose "Hand" rotate 0 }
cel 60       { pose "Hand" rotate 360 }  ← sweeps around the pivot, not its own middle
```

## Tweens, easing, spin

- **`cel N tween { … }`** interpolates this cel → the next for every container present in both. Without
  `tween`, the cel **holds** until the next key.
- **`ease <curve>`** on the cel: `linear` · `easeIn` · `easeOut` · `easeInOut` · `cubic(a,b,c,d)`.
- **`spin cw|ccw`** + **`turns <n>`** force the rotation **direction** and add full turns across the
  tween, so a 350° → 10° move can go the short way (`ccw`) or wind several times (`turns 2`). The spin
  is **around the pivot**, like every other rotation.
- **`morph`** on a cel tweens the *shape* of the `matter` (drawing) toward the next key.

## Presence across cels — a cel is a full snapshot

Each `cel` is a **keyframe = the full set of containers present at that instant** (Flash style). A container
is shown only on the cels that **pose** it; one omitted from a cel **disappears** there. So a container
visible across a span must be posed on **each cel of that span** (it's per-*keyframe*, not per-frame — three
keyframes ⇒ three poses, not one per frame). This is also how a symbol **exits**: stop posing it.

Two ways to avoid re-typing an unchanged container:

- **Static element → its own layer WITHOUT cels.** A cel-less layer renders its items at every frame, so a
  static base/background is declared **once** and never flickers. (Same idea as the render-order note below.)
- **`cel N hold { … }`** — carry the previous cel's poses forward for every container this cel does *not*
  mention, then apply the stated overrides. Pure authoring sugar (the compiler expands it to full cels), so
  you only write what changes:

```
cel 0  tween { pose "Base" at 0,0   pose "Ring" scale 1 }
cel 30 hold tween { pose "Ring" scale 4 }   # Base carried automatically
cel 60 hold       { pose "Ring" scale 1 }
```

`hold` is opt-in per cel; without it the default (an omitted container is removed) is unchanged — so
exits still work.

## Driving a channel with an expression (`expr`)

Instead of keyframes you can bind a channel to an expression on the container itself:

```
group "Fan" pivot 0,0 expr rotation "turns(time)" { … }   ← one turn per second
```

- The animatable channels are `x`, `y`, `scaleX`, `scaleY`, `rotation`, `opacity`.
- **`rotation` is in RADIANS** (like `sin`/`cos`/`atan2`). Use the helpers to stay in degrees:
  - `rad(deg)` → radians, e.g. `expr rotation "rad(45)"`
  - `turns(n)` → `n` full turns in radians, e.g. `expr rotation "turns(time)"` or `"turns(time * 0.5)"`
  - `deg(rad)` → the inverse, for readouts.

## Looping & instancing

The timeline loops over `[0, durationFrames)`. An `instance` of a symbol chooses **how its own timeline
advances** (Flash's symbol-instance models), written after the instance's attributes:

```
instance "Walk" as "legs"                # synced (default)
instance "Walk" as "legs" loop           # independent (MovieClip)
instance "Splash" as "fx" once           # play once, then hold the last frame
```

| mode | clock | behavior |
|---|---|---|
| *(default)* / `synced` | the parent's frame | **Graphic symbol**: scrubbed and *truncated* by the parent — if an ancestor's timeline is shorter than (or not a multiple of) the sub-loop, it snaps mid-cycle. Best for lip-sync, deterministic scrub. |
| `loop` (`independent`) | the runtime's monotone clock | **MovieClip**: loops on its *own* duration, immune to any ancestor's loop length. Use for state-loops and idles that must keep their phase across the parent's wrap. |
| `once` | the monotone clock, clamped | plays through **once**, then **holds** the last frame — a one-shot (a splash, an explosion, a pose that stays). |
| `singleFrame` | — | frozen on a fixed frame. |

A `loop`/`once` instance runs on the global heartbeat, so it never needs its parent padded to a common
multiple ("LCM") of its sub-loops. In the **editor** it shows frame 0 (MovieClip-style authoring); it plays
at runtime — edit its keyframes by opening the symbol itself. `--preview` sizes its window to show a nested
`loop`/`once` looping cleanly, without touching the previewed symbol's own authored duration.

## Exposed parameters (`params`)

A symbol can publish a small, named **interface** instead of exposing its internals — useful for restyling
an asset (hull/sail colors), tuning an animation (amplitude, speed), or toggling a detail, including
"after the fact" by a small model.

```
symbol "Boat" {
  params {
    color  hull = #c0392b           "Hull color"
    color  sail = #2980b9           "Sail color"
    number wave = 1   range 0 2     "Bob amplitude"
    bool   flag = true              "Show the pennant"
  }
  layer "body" {
    path "…" fill hull                                  # a color param used as a fill
    group "Deck" expr y "sin(time*3) * wave" { … }      # a number param read in an expression
    group "Flag" expr opacity "flag ? 1 : 0" { … }      # a bool param as a toggle
  }
}
```

- `params { <type> <name> = <default> [range <min> <max>] ["doc"] … }` — `<type>` is `color`, `number`,
  or `bool`. The default, range, and doc string make the interface self-describing.
- **`color` params** are used as a paint — `fill hull`, `stroke hull <width>`, a **gradient stop**
  (`0:hull@0.8`, optional `@alpha`), or a **`tint hull <amount>`** (anywhere a `#color` literal goes).
  Resolved per instance at render; *not* available in numeric expressions.
- **`number` / `bool` params** become **variables in the symbol's expressions** (`wave`, `flag`). `bool`
  reads as `1`/`0`. (`flatc --check` knows them — reading a declared param in an `expr` is not an "unknown
  variable".)

> The `timeline`, `params`, and `states` header blocks may appear in **any order** before the layers.

Set params at the instance **call-site** (literals), in `--preview`, or — for `number`/`bool` — at
runtime (`Boat.wave = 1.5`, see below):

```
instance "Boat" as "Hero" at center { hull = #1a5f3a, wave = 1.5, flag = false }
flatc --preview Boat.flat --render --set hull=#1a5f3a,wave=1.5 -o boat.png
```

> A `state` (below) is just another exposed param — same call-site/preview/runtime surface.

## Named states (`states`)

A symbol can expose **named states** — points on its own timeline — and let a consumer switch between
them. A door is the canonical case: the symbol animates from `closed` (frame 0) to `open` (frame 24),
and exposes that as a single param.

```
symbol "Door" {
  timeline 24 24
  states door { closed at 0   open at 24   initial closed   transition 12 ease easeInOut }
  layer "panel" {
    group "Panel" at 60,10 pivot 0,0 { layer "art" { rect 0 0 40 80 fill #884422 } }
    cel 0 tween { pose "Panel" rotate 0 }      # closed
    cel 24       { pose "Panel" rotate 80 }    # open
  }
}
```

- `states <param> { <name> at <frame> … }` declares the state machine. `<param>` is the exposed
  variable (`door`); each `<name> at <frame>` anchors a state to a frame of the symbol's timeline.
- `initial <name>` is the resting state (default: the first). `transition <n> [ease <e>]` is the default
  move between states.
- **The param drives the symbol's local playhead.** `door = 0` (or `closed`) → frame 0; `door = 1`
  (or `open`) → frame 24; a fractional `door = 0.5` → frame 12, i.e. the authored in-between animation.
  So **animating the variable from 0→1 plays the open animation** — states live inside the ordinary
  variable system, no special runtime.

Select a state in a preview (a state name or a number):

```
flatc --preview Door.flat --render --set door=open -o open.png
flatc --preview Door.flat --render --set door=0.5  -o half.png   # mid-transition
```

### Driving a state from a program (`set Name.param = state`)

In a `.flatink` program, address an instance **by name** and set its state — the player plays the
declared `transition` automatically. Each instance keeps its **own** state, so two doors are independent.

```
scene {
  layer "stage" { instance "Door" as "FrontDoor" at 100,100 }
}
object "FrontDoor" {
  when clicked { FrontDoor.door = open }   # animates closed → open over `transition` frames
}
```

The right-hand side is a **state name** (`open`) or an expression (`FrontDoor.door = score > 5 ? open : closed`
isn't valid — names aren't expressions; use a number there, e.g. `… ? 1 : 0`). `transition 0` snaps instantly.

> **Scope note:** the state value drives the instance's playhead and is visible to that instance's own
> expressions. Reading another object's state back by name (`FrontDoor.door` in an unrelated expression)
> and the broader typed `params {}` interface (colors/numbers/toggles, `fill hull`) are still to come.

## Render order (a real caveat)

Within **one animated layer**, the **matter (static drawing) always renders behind the posed
containers** — declaration order between a bare `path` and an animated `group` is **not** preserved,
because the cel model stores matter and the container roster separately.

**If a static shape must sit IN FRONT of an animated group**, give it its own group (so it becomes a
posed container too) or, simpler, **put it on its own layer** above. Layers always honor their stacking
order. This is the reliable way to control z-order around animation.

## Previewing without clipping

`flatc --preview` auto-sizes the stage to the symbol's bounds. By default (`--bbox all`) it measures the
**union over every frame** (sub-timelines unfrozen), so a part that drifts, rotates, or grows is **never
clipped**. Use `--bbox frame0` for the old frame-0-only measure, and `--pad N` to add a margin.

```
flatc --preview Boat.flat --render -o boat.png            # union bbox (default) — full motion fits
flatc --preview Boat.flat --bbox frame0 --pad 40 -o b.png # frame-0 bounds + 40px margin
```

See also: [Tooling](tooling.md) for the full `flatc` reference, and
[Gotchas](dsl-gotchas.md) for sharp edges.
