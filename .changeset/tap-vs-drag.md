---
"@flatkit/player": patch
---

fix(player): defer `click` to release with a movement threshold (tap vs drag)

`when clicked` fired on pointer-**down**, so a drag that *started* on a clickable element also fired its
`click` — you couldn't have "tap to pick" and "drag to scroll" on the same element. `click` is now deferred
to pointer-**up** and fires only if the pointer stayed within a small tolerance (`TAP_TOL`, 6 px) — a tap; a
press that travels past it is a **drag** and emits no `click`. A tappable and a draggable behavior can now
coexist on the same element with no phantom click.
