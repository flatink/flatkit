---
'@flatkit/types': minor
'@flatkit/engine': minor
'@flatkit/compiler': minor
'@flatkit/player': minor
'@flatkit/sugarflat': minor
---

Keyboard access is built in: `focusable` objects are reached with Tab, clicked with Enter or Space, and
ringed by the player.

- **`focusable [order <n>] [noring]`** in an `object` block. Tab and Shift+Tab walk the focusable objects
  (ranked ones first, then document order; an object that is not shown is skipped), Enter and Space fire
  the focused object's `when clicked`, and `self.focused` is 1 on it.
- **The player draws the focus ring** (around the object's `hitbox` when it has one). `noring` on an
  object, or the `focusRing: false` option, leave the drawing to the scene.
- **A stop, not a trap.** The canvas joins the page's tab order (`tabindex="0"` when the scene has
  focusable objects); Tab is handled only while the canvas has the page's focus, and past either end it is
  left to the page. Using the pointer drops the keyboard focus.
- **Host API**: `player.focused`, `player.focusNext(1 | -1)`, and the `focusRing` option.
- **Testable**: under `flatc --play`, a `key` gesture named `Tab` moves the focus and `Enter` clicks.
- **sugarflat**: every element of `place`, `compose` and `steps` is focusable. `place` gains a second way
  in besides dragging: pick an item (Enter, or a tap), then pick its target. A picked item is scaled up
  a little; `<block>_sel` holds its 1-based index.
