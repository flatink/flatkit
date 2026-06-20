---
"@flatkit/types": minor
"@flatkit/engine": minor
"@flatkit/player": minor
"@flatkit/compiler": minor
---

States no longer freeze nested timelines. A symbol's `states` block used to pin its whole subtree's frame, so any timeline nested inside a state (a sub-loop, an idle) froze. The pinned POSE frame is now decoupled from the playback CLOCK handed to children: a state pins the symbol's own pose while the timelines nested inside it keep playing. This lets a state host a running loop (e.g. a `marche`/`panique` cycle selector) or an idle that runs during a state — authored entirely in keyframes, no `expr` scripting. Looping is opt-in: a frozen pose with no nested loop stays frozen, so existing state assets render unchanged.
