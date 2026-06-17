---
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/compiler": minor
---

Two more "silent at runtime" footguns from the field, plus a new monotone clock:

- **`clock` — a monotone elapsed-seconds reserved name** (never wraps), alongside `time`. `time = frame/fps`
  resets to 0 every `durationFrames` (the timeline loops), so `sin(time * f)` jumps on each loop — and a
  `.flatink` with no `timeline` defaults to 60 frames (2.5 s @24fps). Use `clock` for free-running ambient
  motion: `sin(clock * f)` never jumps. (Friction V, fix c.)
- **`flatc --check` warns when a channel expression uses `time` under a short looping timeline**
  (`durationFrames ≤ 120`) — points at the loop reset and suggests `clock` / a longer `timeline`. (Friction
  V, fix b.)
- **`flatc --check` now also surfaces dropped parse errors in SCENE scripts** (`every frame`, timeline
  blocks), not just `object` blocks — e.g. two statements on one line (`{ a = 1  b = 2 }`), which used to
  pass silently with only a "variable never used" warning. (Friction U; completes the behavior-diagnostics
  coverage added previously for `object` blocks.)
