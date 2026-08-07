---
"@flatkit/compiler": minor
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/types": minor
---

Close the silent traps found while writing activity generators against 0.21 (moiki integration).

Four of these let a program compile clean, pass `--check`, and still not do what it says.

**`object "X"` that binds to nothing is now a compile ERROR.** Only a group/instance/text/image carries a
pose, so a block naming a SHAPE (`rect ... as "Eclat"`) or a LAYER was dropped in total silence: the
channel bindings vanished and the handlers got a dangling target no hit-test ever resolved. The message
names what was actually hit and how to fix it (wrap the shape in a group).

**`pulse` and `shake` now ride the monotone `clock`, not `time`.** `time` resets every `durationFrames`
(2.5 s by default), so a one-shot end-of-game `pulse` replayed for ever and a refusal wobble skipped on
every loop. MIGRATION: capture instants with `clock` -- `when wrong { shown = clock }`, not `= time`. The
existing `time`-wraps warning also follows `time` THROUGH a function now, and names it: it only grepped
the channel text before, so it said nothing at all in exactly the case that cost the most.

**A `link` gated off by `{ enabled ... }` resolves its target index to 0.** `enabled` gates the GESTURE,
not the handlers: `when released` keeps firing, and the index used to keep the last resolved value, so a
handler could count the same pair again on every further press. Documented alongside, since guarding the
handler body is still the author's job for every other output.

**A PROGRAM saved as `.flat` is refused instead of vacuously passing.** A `.flat` is read as a bag of
symbols, so a whole program under that name reported "0 symbol(s)" and exit 0 with nothing verified -- a
check written against the wrong extension always passed and looked like a safety net.

Diagnostics now point INTO the source file. `--check` on a `.flatink` reported line:col from a program
rebuilt out of the Doc (no `scene { ... }` block), so every position was off by that block's height and
every scope read `scene`. An error on line 13 was reported on line 4. The `feedback` sugar is
line-preserving now too, so it no longer shifts what follows it.

Also:

- Calling a stdlib function auto-imports its package. `pulse(...)` needed a `use "feedback"` that only the
  `feedback` sugar wrote, so a generator that emits `feedback` per element broke at the exact moment its
  last element was removed. An explicit `use` still works, and your own `fn` of the same name still wins.
- `--no-libs` skips the auto-discovery of the `.flat` files next to the program, and a lib that fails to
  parse is now NAMED (it is often a neighbour the author never mentioned).
- A swallowed non-assignment statement (`score = score + 1  send "correct", 1`) says "two statements on one
  line" and names what it swallowed, instead of `unexpected character """`.
- A misplaced `as` (`rect ... fill #fff as "N"`) states the ordering rule instead of `"layer" expected`.
- Docs: the idiom for drawing a `link` thread (rotate + stretch a bar of known length), what `enabled` does
  and does not gate, and that opacities multiply (an `opacity 0` shape cancels its group's animation).
- Docs, two pre-existing defects found while writing the above and fixed: the index page's headline example
  drove an `object "Star"` that named a bare `circle` -- it demonstrated the very bug above, and would now
  be a compile error; and every runnable example annotated with `#` could not be pasted, since `#` starts a
  COLOR and only `//` opens a comment. All 14 complete examples across the docs are now compiled as part of
  checking this change, and the comment rule is written down.
