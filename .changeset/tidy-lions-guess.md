---
'@flatkit/types': patch
'@flatkit/engine': patch
'@flatkit/player': patch
'@flatkit/compiler': patch
---

Scene-wide constructs inside an `object` block were dropped in silence -- now an error.

`object "X" { when loaded { … } }` compiled clean and did nothing: `unitsToObject` keeps the per-item
events and drops `load`, `enterFrame`, `at frame`, `label`, `each`, `use`, `fn` and `let` on the floor.
The parser made it worse -- its unknown-event message lists `loaded` among the events an object block
accepts. `when loaded` is the costly one: drawing a hidden value ONCE at start (`secret = floor(random() *
3)`) is what every guess-the-rule activity is built on, and it was a no-op with nothing on screen to say
so. `--check` now names the construct and says to move it to the top level.
