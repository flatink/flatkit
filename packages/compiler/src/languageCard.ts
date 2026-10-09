// ─────────────────────────────────────────────────────────────────────────────
//  languageCard.ts — TERSE reference of FlatInk Script, "system-prompt" sized.
//
//  Single source of truth to steer an LLM (or a human in a hurry): condensed
//  grammar + built-ins, ~1k tokens. The function/constant/channel lists are
//  INTERPOLATED from expr/timeline/stdlib → never out of sync with the real engine.
//  To be paired with `docToManifest` (manifest.ts) for the names specific to a scene.
// ─────────────────────────────────────────────────────────────────────────────
import { STD_CONSTANTS, STD_FUNCTIONS } from '@flatkit/engine/expr'
import { EXPR_CHANNELS } from '@flatkit/engine/timeline'
import { PACKAGES } from '@flatkit/engine/stdlib'

/** Language reference card (static, kept in sync with the engine via STD_*). */
export function languageCard(): string {
  return `# FlatInk Script — reference
Numbers only (0 = false, anything else = true). No string type (only event/label/asset names in quotes). Comment: // to end of line.
One statement per line — a newline ends the statement (write \`x = 1\` then \`y = 2\` on separate lines, not \`x = 1  y = 2\`).

## Objects
object "Name" { … } attaches behavior BY NAME. The name must be a group / instance / text / image — the only things that carry a pose.
A SHAPE (\`rect … as "N"\`) or a LAYER cannot be animated: wrap the shape in \`group "N" { layer "art" { … } }\`. (Naming one is a compile error.)
Opacities MULTIPLY down the tree — do not set \`opacity 0\` on the shape to hide it at rest, or the group's fade-in stays invisible.

## Events
Scene-wide, at the TOP LEVEL only:
when loaded { }      // once, on start
every frame { }      // every frame (a fixed 60 Hz step)
at frame N { }       // when the playhead reaches frame N
label N "name"       // names frame N: the target of go to "name"
In an object "Name" { } only:
when clicked|hovered|unhovered|pressed|dragged|released|held { }
focusable            // Tab reaches it, Enter/Space fire when clicked

## Actions
play · pause · go to frame N [and play|and pause] · go to "label"
name = expr            // set a variable
arr[i] = expr          // write an array slot
arr = fill(n, v)       // replace a WHOLE array (the only array-valued assignment; expressions are scalar)
if cond { } else { } · repeat N times { } · repeat i from A to B { }
wait 1.5 · wait until cond   // suspend THIS handler (seconds, counted in 60 Hz steps), then go on. In an event / when loaded / at frame handler — not in every frame, not in a fn. Triggered again while waiting, the handler STARTS OVER
myProc() · send "event"[, expr | text("id") | { a = expr, b … }] · sound "assetId"

## Expressions (drive a channel, or compute in an action)
channel = expr         channels: ${EXPR_CHANNELS.join(' ')}   (expression wins over keyframes)
dx = expr · dy = expr  // ADDITIVE offset: final pos = at + (dx, dy) — oscillate AROUND the anchor (dx = 30*sin(clock)); absolute x/y REPLACE at
rotationDeg = expr     // sugar for rotation = rad(expr) — author angles in DEGREES (rotation & sin/cos/atan2 are RADIANS)
operators: + - * / %   < > <= >= == !=   && || !   cond ? a : b
context: time frame clock value · mouse.x mouse.y mouse.dx mouse.dy · keys.Space keys.ArrowLeft … (keys are 1/0, use directly: keys.Space ? … : …)
  time WRAPS every durationFrames (2.5 s by default) — clock is MONOTONE. Timestamps you capture and compare later MUST use clock
  (\`when dropped on Bad { shown = clock }\` + \`opacity = pulse(shown, 4)\`): captured on time, a pulse NEVER fires and a hand-written ramp replays on every loop.
  keys.<Key> is the typed key (keys.a) or the physical one (keys.ShiftLeft, keys.Digit1) · random() = a number in [0, 1[
Name.x Name.y Name.rotation Name.scaleX Name.scaleY Name.opacity   // any named object (identifier name), live on-screen value (read-only)
self.x self.y self.rotation self.scaleX self.scaleY self.opacity   // the object's own channels, in its bindings (no mirror variable)
self.hovered self.grabbed self.focused                             // its own interaction state, 1/0 (grabbed needs a when pressed / an interactor on it)
spring rotationDeg = expr { stiffness 0.08 damping 0.8 } · smooth x = expr { k 0.2 }   // a channel that CHASES its target, in an object block

## Spaces (local vs world)
self & channels (x, y, rotation…) = LOCAL (relative to parent — what x = … sets). Name.x, mouse.x = WORLD (the stage).
At the scene root, local = world (the common case → nothing to think about). If an object is NESTED in a group and you
relate it to a world position, convert: toLocalX(x, y) toLocalY(x, y) (world → your space) · toGlobalX/Y (your space → world).
constants: ${STD_CONSTANTS.join(' ')}
functions: ${STD_FUNCTIONS.join(' ')}

## Direct manipulation (interactors)
drag x, y                      // object follows the pointer while held → writes vars x, y (bind them, one per line: x = vx then y = vy)
{ enabled <expr> } gates the GESTURE only — when/pressed/released/clicked STILL fire. Guard the body: when released { if done == 0 { … } }
dragX vx · dragY vy            // single-axis
drag x, y {                    // options: ONE PER LINE
  confine to Zone              // bound to a named object's box
  snap 10                      // grid snap
}
turn a around cx,cy { snap 15 }    // dial/knob → a = pivot→cursor angle in RADIANS (pair: rotation = a)
turnDeg a around cx,cy { snap 15 } // same in DEGREES (pair: rotationDeg = a) · snap is degrees on both
trace p along Route {          // follow a named guide → p = 0..1 by ARC LENGTH (pair: draw "p")
  tolerance 30
  step 40                      // a TRACE, not a cursor: without it one press near the finish reports ~1
}
reveal c {                     // scratch → c = cleared fraction
  brush 32                     // the finger
  grain 8                      // the resolution
  erase                        // the runtime rubs the target out
  cells grid                   // grid[row*cols+col] = 1 says WHERE
}
group "Zone" at x,y hitbox W H { … }   // an explicit touch + drop rectangle, CENTRED on the group's origin
when dropped on Zone { … }     // fires on release when the object's center is inside the named zone

## Declarations
var name = 0 · var arr = fill(n, v) · var arr = [a, b, c]   // document state: readable EVERYWHERE (bindings included)
let name = 0                               // the same thing at the top level of a program; inside a scope it stays local
fn name(a, b) = expr                       // value function (use in expressions)
fn name() { … }                            // procedure (block of actions)
each "Symbol" as i { opacity = data[i] }   // bind every instance of a symbol (i = index); handlers under each need a PARAMETERIZED symbol "X"(…)
use "package"          packages: ${PACKAGES.join(' ')}   // OPTIONAL: calling a package function imports it automatically

## Example
var score = 0
var lit = 0
every frame { score = score + 1 }
object "Ball" {
  when clicked { lit = 1 }
  opacity  = lit == 1 ? 1 : 0.4                            // a binding READS the document's state
  rotation = atan2(Target.y - self.y, Target.x - self.x)   // aim at another object by name
}`
}
