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

## Events (attach to an object or to the scene)
when loaded { }      // once, on start
every frame { }      // every frame
at frame N { }       // when the playhead reaches frame N
when clicked|hovered|unhovered|pressed|dragged|released|held { }

## Actions
play · pause · go to frame N [and play|and pause] · go to "label"
name = expr            // set a variable
arr[i] = expr          // write an array slot
if cond { } else { } · repeat N times { } · repeat i from A to B { }
myProc() · send "event"[, expr] · sound "assetId"

## Expressions (drive a channel, or compute in an action)
channel = expr         channels: ${EXPR_CHANNELS.join(' ')}   (expression wins over keyframes)
rotationDeg = expr     // sugar for rotation = rad(expr) — author angles in DEGREES (rotation & sin/cos/atan2 are RADIANS)
operators: + - * / %   < > <= >= == !=   && || !   cond ? a : b
context: time frame value · mouse.x mouse.y mouse.dx mouse.dy · keys.Space keys.ArrowLeft … (keys are 1/0, use directly: keys.Space ? … : …)
Name.x Name.y Name.rotation Name.scaleX Name.scaleY Name.opacity   // any named object (identifier name), live on-screen value (read-only)
self.x self.y self.rotation self.scaleX self.scaleY self.opacity   // the object's own channels, in its bindings (no mirror variable)

## Spaces (local vs world)
self & channels (x, y, rotation…) = LOCAL (relative to parent — what x = … sets). Name.x, mouse.x = WORLD (the stage).
At the scene root, local = world (the common case → nothing to think about). If an object is NESTED in a group and you
relate it to a world position, convert: toLocalX(x, y) toLocalY(x, y) (world → your space) · toGlobalX/Y (your space → world).
constants: ${STD_CONSTANTS.join(' ')}
functions: ${STD_FUNCTIONS.join(' ')}

## Direct manipulation (interactors)
drag x, y                      // object follows the pointer while held → writes vars x, y (bind them: x = vx, y = vy)
dragX vx · dragY vy            // single-axis
drag x, y { confine to Zone  snap 10 }   // bound to a named object's box · grid snap
turn a around cx,cy { snap 15 }    // dial/knob → a = pivot→cursor angle in RADIANS (pair: rotation = a)
turnDeg a around cx,cy { snap 15 } // same in DEGREES (pair: rotationDeg = a) · snap is degrees on both
when dropped on Zone { … }     // fires on release when the object's center is inside the named zone

## Declarations
let name = 0 · let arr = fill(n, v) · let arr = [a, b, c]
fn name(a, b) = expr                       // value function (use in expressions)
fn name() { … }                            // procedure (block of actions)
each "Symbol" as i { opacity = data[i] }   // bind every instance of a symbol (i = index)
use "package"          packages: ${PACKAGES.join(' ')}

## Example
let score = 0
every frame { score = score + 1 }
object "Ball" {
  when clicked { score = score + 1 }
  rotation = atan2(Target.y - self.y, Target.x - self.x)   // aim at another object by name
}`
}
