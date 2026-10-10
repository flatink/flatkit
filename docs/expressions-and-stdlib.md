# Expressions & stdlib

Expressions appear in channel bindings (`rotation = …`), conditions (`if …`, `enabled …`), `send`
payloads, `bind` text, text-on-path `start`/`spacing` (`text … along "…" start "time*0.1"`), and `$()`
interpolation. They are **pure and numeric** — no statements, no loops, no side effects (so they can't
hang and only touch the values the runtime provides).

## Operators

From lowest to highest precedence:

```
?:            ternary          a > 0 ? 1 : -1
|| &&         logical
== != < > <= >=   comparison    (a value ≠ 0 is "true")
+ - * / %     arithmetic
- !           unary
. []          member / index    mouse.x · slots[i]
fn(…)         call
```

There are no booleans — comparisons and logic yield `1` / `0`.

## Built-in functions

```
sin cos tan  asin acos atan atan2
abs sqrt pow exp log  floor ceil round sign
min max  hypot  clamp(x, lo, hi)  lerp(a, b, t)  mod(a, b)  between(x, lo, hi)
rad(deg)  deg(rad)  turns(n)
```

Constants: `PI`, `TAU` (2π), `E`, and **`DT`** — the duration of one `every frame` step, in seconds: 1/60,
whatever the timeline's fps (`v = v + a * DT`). See [how a frame runs](behavior-and-interactions.md#how-a-frame-runs).

> **`lerp` is the exponential smoother.** `lerp(v, target, k)` = `v + (target - v) * k` — so
> `niv = lerp(niv, target, 0.1)` in `every frame` eases `niv` toward `target` (no new helper needed; the
> target and rate stay explicit). For a timed 1→0 feedback ramp, see `pulse(since, dur)` in `use "feedback"`.

**Angles are RADIANS** (the `rotation` channel, `sin`/`cos`/`atan2`). Author in degrees with the helpers:
`rad(45)` (degrees → radians), `turns(n)` (n full turns → radians, e.g. `rotation = turns(time)` spins once
per second), `deg(r)` (the inverse, for readouts). Or bind the **`rotationDeg`** channel (sugar for
`rotation = rad(…)`) and use the **`turnDeg`** interactor — both work in degrees, for when that reads better.

## Reserved names

| Name | Meaning |
|---|---|
| `time` | seconds elapsed — **resets to 0 every `durationFrames`** (the timeline loops). Fine for motion tuned to the loop; for free-running ambiance use `clock`. |
| `clock` | seconds elapsed, **monotone** (never wraps). Use for ambient motion in a looping/interactive scene so `sin(clock * f)` doesn't jump on each loop. |
| `frame` | current frame (0-based; also wraps at `durationFrames`) |
| `value` | the channel's current value (in a channel binding) |
| `mouse.x` `mouse.y` | pointer position (scene units) |
| `mouse.dx` `mouse.dy` `mouse.wheel` | pointer movement and wheel delta accumulated **this frame** (0 at rest) — see [pointer gestures](behavior-and-interactions.md#pointer-gestures-drag-delta-finger-scroll-tap-vs-drag) |
| `toLocalX(x, y)` `toLocalY(x, y)` `toGlobalX(x, y)` `toGlobalY(x, y)` | a scene point in the object's own space, and back (in an object's handlers) |
| `random()` | a number in `[0, 1[`, a new one at each call. Reproducible when the player is given a `seed` (always the case under `flatc --play`, see `--seed`) — see [host integration](host-integration.md) |
| `keys.<Key>` | `1` while a key is held, `0` otherwise — `<Key>` is the browser `KeyboardEvent.key` value (`keys.ArrowRight`, `keys.a`, `keys.Escape`), plus the alias `keys.Space` for the space bar, **or** the physical key, `KeyboardEvent.code` (`keys.ShiftLeft`, `keys.Digit1`, `keys.Numpad1`, `keys.KeyA`) — the way to tell the two Shift keys apart and to read the digit row. Naming a key here also makes the player **consume** it (no page scroll) — see [host integration](host-integration.md#keyboard) |
| `self.x` `self.y` `self.scaleX` … | the object's own current pose (in its channel bindings) |
| `self.hovered` `self.grabbed` `self.pressed` `self.focused` | the object's own interaction state (`0`/`1`; `focused` = it holds the keyboard focus, see `focusable`) — see [feedback](behavior-and-interactions.md#feedback) |
| `<Name>.x` `<Name>.y` … | a named object's live channels (e.g. `Target.x`) |
| `<Instance>.<param>` | an instance's number/bool param or state, read by name: the live value, else the call site's, else the default — see [animating symbols](animating-symbols.md#exposed-parameters-params) |

## Arrays

```
var slots = [0, 0, 0]
object "P" { x = slots[i] }          // computed index
slots[i + 1] = 1                      // indexed assignment (in actions)
v = [10, 20, 30][i]                   // a table written in place, indexed at once
```

A table is also how a jump is chosen among many: `go to frame START[verse]` (the frame of `go to frame` is
an expression), rather than one `else if` per case.

An expression may nest 200 deep (parentheses, indexes, call arguments, stacked `-` / `!`); past that it is
refused, with a message.

A table written in place — `[a, b, c][i]` — saves a global array for a lookup used once. Its elements and
its index are expressions, only the element picked is evaluated, and it indexes as an array does (the
index is rounded; outside the table it is `NaN`, so the binding keeps its fallback). It is not a value on
its own: `[1, 2, 3]` without an index is an error — to keep a table, declare `var t = [1, 2, 3]`.

## Determinism

For someone replaying a simulation elsewhere (a Python replica, a test that compares to the bit), what can
be counted on. Numbers are IEEE 754 doubles, and an expression is evaluated in the order it is written,
one rounded operation at a time (no fused multiply-add).

- **Exact** — the same bits on every engine: the operators `+ - * / %` and the comparisons, and `abs`
  `floor` `ceil` `round` `sign` `min` `max` `sqrt` `clamp` `lerp` `mod` `between` `rad` `deg` `turns`.
  (`sqrt` is the IEEE square root, correctly rounded on every engine in use, although ECMAScript does not
  formally demand it. `rad`, `deg` and `turns` multiply by the double `PI`: exact, provided the replica
  does the same operations in the same order — `rad(d)` is `d * PI / 180`.)
- **Engine-dependent** — ECMAScript leaves the last bits to the implementation: `sin` `cos` `tan` `asin`
  `acos` `atan` `atan2` `pow` `exp` `log` `hypot`. Two browsers usually agree, and nothing guarantees
  it; a Python or C library need not agree with either. Integrated over thousands of steps, one bit
  becomes a visible gap. A replica that must match to the bit uses its own polynomial for these, on both
  sides.

Three spellings that differ from other languages:

- **`%`** is the remainder of the truncated division: it takes the sign of the LEFT operand (`-1 % 3` is
  `-1`), and works on decimals (`3.25 % 12` is `3.25`). It is C's `fmod`, Python's `math.fmod` — not
  Python's `%`. **`mod(a, b)`** is the positive one (`mod(-1, 3)` is `2`), Python's `%` for `b > 0`.
- **`round`** sends a half UP, toward +∞: `round(2.5)` is `3`, `round(-2.5)` is `-2`. Python's `round`
  sends it to the even neighbour. An array index is rounded the same way.
- **`random()`** draws from a seeded generator made of integer operations only: the same seed gives the
  same sequence on every engine. A replay is always seeded (`flatc --play`, seed `1`, or `--seed N`); a
  player in a page draws from the browser unless its host passes `seed`.

Time: one step of `every frame` is exactly **`DT`** = 1/60 s — integrate with it. `clock`, `time` and
`frame` follow real time in a browser and are exact only in a replay (see
[how a frame runs](behavior-and-interactions.md#how-a-frame-runs)).

## Functions (`fn`)

Define reusable helpers — a **value** function (an expression) or a **procedure** (actions):

```
fn dist(ax, ay, bx, by) = hypot(ax - bx, ay - by)      // value

fn reset() {                                           // procedure: one action per line
  score = 0
  go to frame 0
}
```

A procedure cannot `wait` (a compile error): the sequence belongs to the handler that calls it.

## Stdlib packages

Import bundled helpers with `use "<name>"`. They're embedded (no network, no files — a name that is not one of them is looked up as a
[local package](tooling.md) next to the program), referenced in the
`.flatpack`, and resolved by the player. Functions are available **bare** and **qualified**
(`boxHit(…)` or `collision.boxHit(…)` — the qualified form disambiguates collisions).

> **The `use` line is optional**: calling a package function imports its package automatically. A package
> is a vocabulary, not a module to wire up — `pulse(…)` works because you wrote it. Write `use` when you
> want the dependency stated, or to pick a side when two packages share a bare name. Your own `fn` of the
> same name always wins.

```
use "collision"   // boxHit(ax,ay,bx,by,hw,hh) · dist(ax,ay,bx,by) · near(ax,ay,bx,by,r)
use "easing"      // easeIn(t) · easeOut(t) · easeInOut(t) · smooth(t)        (t in 0..1; the first three = a cel's `ease` curves)
use "gesture"     // snap(v,step) · snapTo(v,target,r) · railT/railX/railY(px,py,ax,ay,bx,by) · angle(cx,cy,px,py) · inZone(px,py,x,y,w,h)
use "feedback"    // lift(h) · dim(h) · tilt(g) · sink(g) · shake(bad,t) · pulse(since,dur)  (channel reactions)
                  //   shake/pulse ride the MONOTONE `clock` → capture instants with `clock`, never `time`
```

Example:

```
use "collision"
object "Ball" {
  when dropped on Goal { won = near(self.x, self.y, Goal.x, Goal.y, 30) ? 1 : 0 }
}
```

## See also

- Where expressions are used (channels, interactors, feedback) → **[Behavior & interactions](behavior-and-interactions.md)**
- The `feedback` sugar that writes channel expressions for you → **[Feedback](behavior-and-interactions.md#feedback)**
- Sending computed values out to the embedding app → **[Host integration](host-integration.md)**
