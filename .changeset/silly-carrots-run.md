---
"@flatkit/compiler": minor
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/types": minor
---

Two `object "X"` blocks MERGE their bindings instead of one replacing the other.

Reported from a generated activity: the pieces stopped following the finger during a drag. Two blocks
targeted the same item - the one carrying `drag` with its `x`/`y` bindings, and a second adding a wobble -
and the second REPLACED the first's expressions wholesale. The interactor still wrote the variables,
nothing read them any more, and `--check` reported a clean program.

Handlers from several blocks already accumulated, so the same construct behaved two ways for its two
halves. Now both merge, later block wins per CHANNEL.

Binding the SAME channel from two blocks is still a loss, so it warns and points at the additive `dx`/`dy`
as the way to add motion without replacing a position. Different channels merge silently - that is the
normal way a skin adds life to something the rules already move.

⚠️ This CHANGES BEHAVIOUR for any program that already had duplicate blocks: bindings that were being
dropped now apply. Measured on a 58-activity corpus: 6 such collisions, in 3 activities, every one of
them a binding nobody could see was dead.
