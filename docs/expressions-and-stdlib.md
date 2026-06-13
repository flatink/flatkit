# Expressions & stdlib

Expressions appear in channel bindings (`rotation = …`), conditions (`if …`, `enabled …`), `send`
payloads, `bind` text, and `$()` interpolation. They are **pure and numeric** — no statements, no loops,
no side effects (so they can't hang and only touch the values the runtime provides).

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

Constants: `PI`, `TAU` (2π), `E`.

**Angles are RADIANS** (the `rotation` channel, `sin`/`cos`/`atan2`). Author in degrees with the helpers:
`rad(45)` (degrees → radians), `turns(n)` (n full turns → radians, e.g. `rotation = turns(time)` spins once
per second), `deg(r)` (the inverse, for readouts).

## Reserved names

| Name | Meaning |
|---|---|
| `time` | seconds elapsed |
| `frame` | current frame (0-based) |
| `value` | the channel's current value (in a channel binding) |
| `mouse.x` `mouse.y` | pointer position (scene units) |
| `keys.<Key>` | `1` while a key is held (e.g. `keys.ArrowRight`, `keys.Space`) |
| `self.x` `self.y` `self.scaleX` … | the object's own current pose (in its channel bindings) |
| `self.hovered` `self.grabbed` `self.pressed` | the object's own interaction state (`0`/`1`) — see [feedback](behavior-and-interactions.md#feedback) |
| `<Name>.x` `<Name>.y` … | a named object's live channels (e.g. `Target.x`) |

## Arrays

```
var slots = [0, 0, 0]
object "P" { x = slots[i] }          # computed index
slots[i + 1] = 1                      # indexed assignment (in actions)
```

## Functions (`fn`)

Define reusable helpers — a **value** function (an expression) or a **procedure** (actions):

```
fn dist(ax, ay, bx, by) = hypot(ax - bx, ay - by)      # value
fn reset() { score = 0  go to frame 0 }                 # procedure
```

## Stdlib packages

Import bundled helpers with `use "<name>"`. They're embedded (no network, no files), referenced in the
`.flatpack`, and resolved by the player. Functions are available **bare** and **qualified**
(`boxHit(…)` or `collision.boxHit(…)` — the qualified form disambiguates collisions).

```
use "collision"   # boxHit(ax,ay,bx,by,hw,hh) · dist(ax,ay,bx,by) · near(ax,ay,bx,by,r)
use "easing"      # easeIn(t) · easeOut(t) · easeInOut(t) · smooth(t)        (t in 0..1)
use "gesture"     # snap(v,step) · snapTo(v,target,r) · railT/railX/railY(px,py,ax,ay,bx,by) · angle(cx,cy,px,py) · inZone(px,py,x,y,w,h)
use "feedback"    # lift(h) · dim(h) · tilt(g) · sink(g) · shake(bad,t)      (drive channels from self.hovered/grabbed)
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
