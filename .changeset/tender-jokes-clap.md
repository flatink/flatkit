---
"@flatkit/compiler": minor
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/types": minor
---

Close the open integration reports: the prompts were shipping programs that do not compile.

- **All three complete programs in the shipped prompts were rejected by the compiler they document.**
  An `as` written after the style, `#` used as a comment inside `scene`, and an `object` on a bare shape
  that 0.23 had turned into a hard error. These files are exactly what an integrator hands a model, so
  the error rate they cause is paid at the far end. Fixed, and a test now compiles every complete program
  in `prompts/` - `drawingCard()` had that test from the day it was written; these files shipped without.
- **`#` is not a comment.** It opens a COLOUR, survives the header half of a program and breaks inside
  `scene` on a message about layers that points nowhere near it. The prompts now use `//` throughout and
  say so, and the parser names the character instead of the statement it displaced.
- **A missing `scene { ... }` said the cause once instead of the symptom N times.** Composition at the root
  produced one error per line - measured at 72 on a 75-line file, with not one of them containing the
  word `scene` - so the repair pass fed those errors returned the same program. It cannot infer a cause
  from seventy-two symptoms.
- **`--no-libs` is honoured by `--render` and `--play`.** It was parsed and then not passed on, so a
  render still auto-discovered a broken neighbour and failed advising the flag that had been given.
- **New: a warning when an item is drawn ENTIRELY off-canvas.** The clipped-at-the-edge pass tolerates
  straddling and only ever looked at text and images; a shape or a group wholly outside the canvas was
  silent. Items parked off the top-left corner on purpose (`at -999,-999`) and hairlines lying along an
  edge are left alone - measured against a 58-activity corpus to keep it quiet.
- **New: a warning when `--frame` is past the timeline.** The playhead wraps, so a render could answer
  frame 20 to a request for frame 200 and be read as a renderer bug. It was, once.
- **`renderDocToPng` and the prompt files are reachable**: new `./render` and `./prompts/*` subpaths.
  Rendering no longer requires spawning `flatc` - a binary to locate, a temp dir per render, a timeout.
