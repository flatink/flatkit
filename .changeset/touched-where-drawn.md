---
'@flatkit/types': minor
'@flatkit/engine': minor
'@flatkit/compiler': minor
'@flatkit/player': minor
---

Touch and input: an object is touched where it is drawn, by as many fingers as there are, and the
keyboard has names for its physical keys.

- **An instance is touched where it is drawn.** The hit test entered an instance with its parent's scope:
  an inner group moved by `expr x "pos"` was touched where it stands with `pos` unset, and a state-driven
  symbol where its initial state puts it. It now enters with the instance's params (declared, given at
  the instance, written at runtime), like the renderer.
- **`hitbox` is also where an object is touched** -- clicked, pressed, dragged, hovered -- whenever
  nothing drawn inside it is hit first. A stroke-only ring is clicked in its middle, a small handle gets
  a finger-sized target, an empty group becomes a touch area. The rectangle follows the object, and what
  is drawn above it keeps the pointer. BEHAVIOR CHANGE: an object with handlers and a `hitbox` larger
  than its drawing now reacts in the whole rectangle. `hitbox` is kept on an `instance` too (it used to
  be parsed and dropped), for touch and for drops.
- **Each pointer has its own gesture.** Two fingers can press, hold and drag two objects at once. With a
  single gesture for everyone, lifting one finger released what the other was holding, and that one's
  own release was lost.
- **`keys.<Code>`: the physical key.** A key answers to its `KeyboardEvent.code` as well as its `key`:
  `keys.ShiftLeft` / `keys.ShiftRight` are two keys, the digit row is `keys.Digit1`, the keypad
  `keys.Numpad1`. A `key` name is released with the key that set it, even if the character changed
  meanwhile (Shift let go first used to leave "A" held).
- **The first `sound` is heard, and on time.** Sound assets are decoded when the document loads (through
  an OfflineAudioContext, so no AudioContext is opened before a gesture) instead of in the frame that
  first plays them. A sound asked for while its asset is still decoding plays when it lands; a timeline
  clip in the same case starts then, not on the next loop.
- A pointer the browser refuses to capture (a synthetic event) no longer swallows the press.
