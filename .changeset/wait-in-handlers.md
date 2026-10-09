---
'@flatkit/engine': minor
'@flatkit/player': minor
'@flatkit/compiler': minor
'@flatkit/types': minor
---

`wait` in a handler: "do this, wait, do that" without a hand-written state machine in `every frame`.

```
object "Door" {
  when clicked {
    opened = 1
    wait 1.5
    sound "creak"
    wait until Player.x > 400
    opened = 0
  }
}
```

- `wait <seconds>` suspends the handler it is written in; the duration is an expression, counted in steps of the simulation (60 per second), never in real time, so `flatc --play` replays it exactly. A `wait` lasts one step at least.
- `wait until <cond>` reads the condition once per step; already true when reached, it does not pause.
- Allowed in object events, `when loaded` and `at frame <n>`, inside `if` and `repeat` too. In `every frame` and in a `fn` it is a compile error that says what to write instead.
- A handler triggered again while it waits starts over: the waiting run is dropped. Different handlers wait side by side.
- Waiting handlers are resumed at the start of each step, in the order they started, before `every frame`. They share the step's action budget. The player keeps at most 256 of them; `--check` warns when a document declares more.
- The host's `pause()` freezes them, its `seek()` and `load()` drop them; a script's own `pause` and `go to` do not.
- `wait(1.5)` reads as `wait 1.5`.
- `--check` warns on an `at frame <n>` script that waits longer than a lap of a timeline nothing holds: the playhead is back on the frame first, so the script starts over for ever and what follows the wait never runs.
- Nothing changes for a program that does not wait: such a handler runs through the same interpreter as before. `wait` remains usable as a variable name.

New in the model: the actions `{ do: 'wait', seconds }` and `{ do: 'waitUntil', cond }`. Not in this release: `forever` and `repeat until`.
