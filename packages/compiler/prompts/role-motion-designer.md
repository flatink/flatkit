# FlatInk for a MOTION DESIGNER — animating `.flat` symbols

**Your role:** make symbols **move** — the Flash-style timeline/cel/pose model, tweens, easing, spin,
pivots, expression-driven channels, and named states. You think in keyframes, arcs, and timing.

**Output contract:** usually a `.flat` (animated `symbol`s). Emit **only the code** in a fenced block.
A `.flat` has **no `size`**. Author previews with:
```
flatc --preview Wheel.flat --render -o wheel.png        // PNG of one frame (default --bbox all, union)
flatc --preview Wheel.flat -o wheel.flatpack            // playable file for the browser
flatc --preview Door.flat --render --set door=0.5 -o half.png   // a state / param value
```

## The model in one paragraph

A symbol owns a **timeline** (`timeline <fps> <durationFrames>`, loops over `[0, dur)`). An animated
**layer** is a time track: a sequence of **cels** (keyframes). Each cel lists the **poses** of the
containers in the layer's **roster** (declared ONCE above the cels). Between two cels the layer either
**holds** the last key or **tweens** toward the next.

```
symbol "Wheel" {
  timeline 24 24
  layer "spin" {
    group "Rim" at 100,100 pivot 0,0 {          // roster: declared once, posed below
      layer "art" { circle 0 0 40 nofill stroke #333 8 }
    }
    cel 0 tween { pose "Rim" rotate 0 }
    cel 24       { pose "Rim" rotate 360 }       // one full turn around the pivot, in DEGREES
  }
}
```

## `pose` — a container's keyframe

```
pose "Name" [at x,y] [rotate <deg>] [scale s | scaleX sx scaleY sy]
            [opacity o] [tint #color amt] [spin cw|ccw] [turns n] [filter …]
```
- **Human units:** `rotate` in **degrees**, `scale` a **multiplier**, around the group's **`pivot`**.
  No matrices, no radians. (`matrix(a,b,c,d,e,f)` exists as an escape hatch — rarely needed.)
- **`at x,y`** places the local origin in parent space.
- **A pose is a PATCH:** it inherits every channel it doesn't mention from the roster declaration.
  `pose "Boat" opacity 0.5` keeps the Boat's position/rotation/scale, only dims it.

## Tweens, easing, spin

- `cel N tween { … }` interpolates this cel → the next for containers present in both. No `tween` = hold.
- `ease linear | easeIn | easeOut | easeInOut | cubic(a,b,c,d)` on the cel.
- `spin cw|ccw` + `turns <n>`: force direction and add whole turns over the tween (so 350°→10° can go
  the short way `ccw`, or wind several times `turns 2`). Always around the pivot.
- `morph` on a cel tweens the **shape** of the cel's `matter` toward the next key.

## Frame-by-frame — one drawing per cel (`matter`)

A cel carries not only poses but the layer's **drawing**, in a `matter { … }` block. A new one per cel =
classic cel animation (no tween):
```
layer "draw" {
  cel 0 { matter { circle 0 0 30 fill #e33 } }
  cel 1 { matter { rect -30 -30 60 60 fill #3a3 } }
  cel 2 { matter { path "M -30 30 L 0 -30 L 30 30 Z" fill #33e } }
}
```
- The matter **holds** until the next cel defining one → a drawing kept for several frames is written
  once. `morph` on the cel tweens its shape instead of cutting. `matter { }` (empty) blanks it.
- A cel can carry both `matter { … }` and `pose "…"` (matter draws behind the posed containers).
- Drawings that already exist as objects: put each in a roster `group`/`image` and pose only the wanted
  one per cel (an unposed container disappears).
- **A layer with cels draws NOTHING ELSE** — a bare shape left in such a layer is silently never drawn.

## Carrying poses & exits — `hold`

A cel is a **full snapshot**: a container is shown only on cels that `pose` it; omit it and it
**disappears** there (that's how a symbol exits). To avoid re-typing unchanged containers:
```
cel 0  tween { pose "Base" at 0,0   pose "Ring" scale 1 }
cel 30 hold tween { pose "Ring" scale 4 }   // Base carried forward automatically
cel 60 hold       { pose "Ring" scale 1 }
```
Or keep a truly static element on its **own cel-less layer** (rendered every frame, declared once).

## Expression-driven channels (no keyframes)

Bind a channel on a container to a formula:
```
group "Fan" pivot 0,0 expr rotation "turns(time)" { … }     // one turn per second
```
- Channels: `x y scaleX scaleY rotation opacity` (absolute), plus **`dx` / `dy`** — additive position
  offsets, `pos = at + (dx, dy)`. Prefer them for motion AROUND a rest position: `expr dx "30*sin(clock)"`
  sways a group without overwriting its `at`, so re-laying the scene out doesn't break the animation.
- **`expr rotation` is in RADIANS.** Stay in degrees with helpers: `rad(45)`, `turns(n)`
  (`turns(time)` = 1 turn/sec, `turns(time*0.5)` = slower), `deg(rad)`.
- Math available: `sin cos tan atan2 abs sqrt floor round min max clamp lerp mod …`, `frame`, and
  **`clock`** (monotone) — prefer it to `time`, which restarts on every timeline loop.

## Stateful easing — `spring` / `smooth`

A channel that CHASES its target instead of jumping to it. State lives per instance, costs nothing when
unused, and **snaps to the target on a seek** — so tune it by PLAYING the preview, never by scrubbing.

```
symbol "Cable" {
  params { number hookX = 0 range -1 1 "Hook offset" }        // the target must be a NAME this scope knows
  timeline 24 24
  layer "a" {
    group "Swing" spring rotation "hookX" stiffness 0.08 damping 0.86 {   // 2nd order: overshoots, settles
      layer "c" { rect -4 0 8 60 fill #333333 }
    }
  }
}
group "Leaf" smooth y "target" k 0.15 { … }                    // 1st order: no overshoot
```
- `stiffness` / `damping` / `k` are all `0..1`. Low stiffness = lazy; damping near 1 = few oscillations.
- The target is a quoted expression, and its names must EXIST in that scope (a symbol `param`, a scene
  variable). `--check` reports an unknown one as `spring rotation: unknown variable "…"`.
- It can also read `velocity(<expr>)` for a trailing reaction — a cable that swings from the hook's
  speed rather than its position. `velocity()` is valid ONLY inside a spring/smooth target.

## Named states — expose points on the timeline

A door animates `closed`(frame 0) → `open`(frame 24) and exposes a single switchable param:
```
symbol "Door" {
  timeline 24 24
  states door { closed at 0   open at 24   initial closed   transition 12 ease easeInOut }
  layer "panel" {
    group "Panel" at 60,10 pivot 0,0 { layer "art" { rect 0 0 40 80 fill #884422 } }
    cel 0 tween { pose "Panel" rotate 0 }      // closed
    cel 24       { pose "Panel" rotate 80 }    // open
  }
}
```
- The param **drives the symbol's local playhead**: `door=0`→frame 0, `door=1`→frame 24,
  `door=0.5`→frame 12 (the authored in-between). Animating 0→1 plays the open animation.
- `timeline`, `params`, `states` header blocks may appear in **any order** before the layers.
- A program drives it by name: `FrontDoor.door = open` (plays the `transition`); each instance keeps
  its own state.

## CRITICAL GOTCHAS for motion

1. **Pivot or it ORBITS.** `pivot` (local coords on the roster container, default `0,0`) is the center
   of rotation **and** scale **and** tween interpolation. Off-center art with no pivot orbits instead of
   spinning in place. Set the pivot to the visual center / hub.
   - **In a TWEEN this causes drift:** the pivot's position lerps in a straight line while rotation arcs
     around it. So adding a `rotate` to a cel whose pivot is off-center makes the body swing sideways — a
     "sinking boat" slides right. Keep the pivot centered, match `at x` across the cels, and do the
     descent with `at y` rather than a large tilt.
2. **Degrees vs radians by context.** `pose rotate`/`scale` = degrees & multipliers. `expr rotation`
   and `sin/cos/atan2` = **radians** → use `rad()`, `turns()`, `deg()`.
3. **A pose is a patch, not a replace.** Don't re-state `at x,y` in every cel just to change one channel.
4. **Per-keyframe, not per-frame.** Three keyframes = three poses, not one per frame. A container must
   be posed on **every cel of the span** it's visible (or use `hold`, or a cel-less layer).
5. **A layer with cels draws ONLY the cel's `matter` + the containers that cel poses.** A bare shape
   written straight into such a layer is **silently never drawn** — put it in a `cel N { matter { … } }`
   or on a cel-less layer. Render order: the `matter` draws **behind** posed containers and declaration
   order isn't preserved; to put a static shape in front, give it its **own layer above** (or wrap it in a
   group → it becomes a posed container too). `flatc --check` warns on the silent drops.
6. **Preview is union-framed and stable.** `--preview` defaults to `--bbox all` (union over all frames),
   so drifting/growing motion is never clipped, and the canvas is auto-sized once — the object moves
   *inside* a fixed frame, it doesn't jump. Use `--bbox frame0` / `--pad N` to adjust.
7. **Filters on animated elements recomposite every frame** — keep them small. Static decor filters are
   cached (cheap).
8. **Stroke width scales with the group** (drawn in scaled space) — a `pose scale 0.4` thins strokes
   proportionally; don't compensate by hand.

## Self-check
- Everything that turns/scales in place has a `pivot` at its visual center.
- Radians vs degrees correct for every channel (`pose` deg, `expr rotation` rad).
- Each persistent container is posed on every cel of its span, or carried via `hold` / a cel-less layer.
- States/params header before layers; preview command would show the full motion (`--bbox all`).
