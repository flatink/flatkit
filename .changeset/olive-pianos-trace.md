---
'@flatkit/types': minor
'@flatkit/engine': minor
'@flatkit/player': minor
'@flatkit/compiler': minor
---

`trace` can be a TRACE and not a cursor (`step`), `erase` stops looking like stamps, and a scratched veil
stops recompositing forever.

**`trace <p> along <G> { step <px> }`** -- without it, the progress is where the finger PROJECTS on the
path, so a press three pixels from the finish reports the exercise as finished (measured: 1.000 on a
straight line, from one press and a 10 px move). That is a cursor: right for a slider, wrong for a writing
drill. `step` says the progress may only grow through what the finger passes, by at most `step` px of arc
length between two frames, and everything else follows from that single rule:

- it must be ENTERED at an end -- nothing else is within `step` of a progress of 0 (that same press now
  advances nothing);
- a leap ahead does not count: the progress waits where it was until the finger comes back within `step`;
- the progress belongs to the OBJECT, not to the grab, so lifting the finger and putting it back where it
  was RESUMES (a child stops mid-letter). Putting it back somewhere else advances nothing.

`both ends` makes the far end a legal entry too -- the run is measured from the end that was entered, and
the direction locks on the first advance, so a closed shape can be walked either way round. `point <x>,<y>`
writes the WORLD position of the current progress into two variables: the pen tip while tracing, and where
to put the finger back after a pause. It is placed on the path's start as soon as the scene loads, so a
marker never sits at the origin. Restart with `<p> = 0` -- the variable stays the truth, and the trace
re-seats itself on what the scene wrote.

**`reveal ... { brush <px> grain <px> }`** -- the two numbers are now independent: `brush` is how wide a
touch clears (a gameplay setting), `grain` how finely the runtime tracks and rubs it out (absent = the
brush, i.e. the old behavior). A wide finger with a fine edge is `brush 48` + `grain 12`. And the erased
edge is BLURRED rather than cut: hard discs read as stamps -- a lone touch left a perfect circle and the
border of a scratched area was a scallop at the mesh of the grid. `--check` warns when the grain is coarser
than the brush, where a touch can fall between two cell centres and clear nothing.

**A scratched `erase` composite is cached** on its screen placement and the number of cells that have
fallen. Until now, one cleared cell meant that for the rest of the activity every frame paid a bbox
accumulation over the subtree, an off-screen canvas, a full re-render of the veil, N arcs and a blit back --
while the child was busy elsewhere on the board. While the scratching happens the work still happens; the
moment it stops, a frame is one blit.

Also: `both ends` without `step` is reported (it picks which end a run is measured from, and a `trace`
without `step` has no run), and the `point` variables count as used by the dead-global pass.
