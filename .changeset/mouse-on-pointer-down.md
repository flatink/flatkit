---
"@flatkit/player": patch
---

fix(player): sync `mouse.x/y` on pointer-down/up so press/click/release handlers read the real pointer

`mouse.*` was refreshed only on `pointermove`, so on the **first touch** (no hover precedes a touch) a
`when pressed` / `when clicked` / `when released` handler saw a **stale** `mouse` (0,0) — breaking
grab-anchor capture and relative finger-drag. `onPointerDown`/`onPointerUp` now sync `mouse.x/y` to the
event point before firing handlers, which enables **relative drag / finger-scroll** (`anchor = mouse.x` on
press, `mouse.x - anchor` on drag) and a release-based **tap-vs-drag** check. Desktop was unaffected (the
preceding hover masked it).
