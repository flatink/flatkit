---
'@flatkit/compiler': patch
'@flatkit/engine': patch
'@flatkit/player': patch
---

A pass over every guide, README and agent prompt, each example compiled and each claim run against the code, and the defects it turned up.

Fixes in the code:

- `sameOriginAssetResolver('/activities/42/')` -- the example of the host guide -- resolved nothing, embedded assets included: a relative base is now resolved against the page it runs in. In Node, give an absolute URL as before.
- An unresolved `$(name)` in path data is always a compile error. It was one only when nothing in the name read as an SVG command: `$(trace)` compiled to a path of NaN with a mere warning.
- `feedback lift   // dim later` no longer turns `dim` on: the tokens are read before the comment.
- `flatc --render` warns when it finds skia-canvas 3, which is npm's `latest` tag and what a bare `pnpm add -D skia-canvas` installs; the install hint now says `skia-canvas@next`.

In the guides (they ship with the compiler under `docs/` and `prompts/`):

- Examples that did not compile, mostly `#` used as a comment after the header: fixed, and written with `//` throughout.
- Guide layers (`guide layer`, `orient`) and the `blend`, `opacity`, `hitbox` item attributes were documented nowhere.
- `self.grabbed` is 1 only on an object that can be grabbed (a `when pressed` or an interactor): said, with the empty `when pressed { }` that makes a click-only button squash.
- The thread of a `link`: the example read `self.grabbed` on the wrong object and never showed.
- `reveal ... cells`: the grid follows `grain`, not `brush`, once a grain is given.
- The `turn` gesture of `--play` leaves a wrapped direction, not an accumulated angle; the `wheel` gesture and the pointer `id` were missing.
- `repairLoop` from code needs a first pass on a source that does not parse, as `flatc --fix` does.
- Host guide: what `seek`, `stop`, `toggle` and `load` do precisely, handlers that `wait`, `when loaded` running again on a restore, `setAudio`, `warmHitCache`, the `image` option, the browser bundle.
- Prompts and `languageCard`: interactor options one per line, `tint` not on a bare shape, `when wrong` (not an event) replaced, `each` handlers need a parameterized symbol, the `hitbox` centred on the origin, `label`, `random()`, `keys.<Code>`, `valign`, `stroke ... fixed`, and a `pulse` captured on `time` never fires (it used to say it replays).
