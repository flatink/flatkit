---
'@flatkit/player': minor
---

On a phone, every drag was cancelled: the player now sets `touch-action` on its canvas (moiki-app/moiki-reloaded#135).

With no `touch-action`, a browser reads the first movement of a finger as a scroll and sends `pointercancel`, which the player reads as a release. Nothing could be dragged by finger, and nothing showed it with a mouse; pointer capture does not help, `touch-action` is decided first. Measured in Chromium with emulated touch, a 144 px drag: before, `pointerdown`, 2 `pointermove`, `pointercancel` and an object moved by 24 px; after, 12 `pointermove`, `pointerup` and the object where the finger left it.

The player takes the gesture when the scene needs it, as it does for the wheel and the keys:

- a scene that drags (an interactor, a `when pressed` / `dragged` / `released` / `held` handler, or one that reads `mouse.x` / `y` / `dx` / `dy`): `none`;
- a scene that is only clicked: `manipulation` -- taps without the double-tap wait, and the page still scrolls and zooms over the canvas;
- a scene with no pointer use: the canvas is left alone.

It follows `load()`, is not set with `input: false`, and `destroy()` takes it back. A canvas that already carries a `touch-action` when the player arrives (inline or from a CSS rule, any value but `auto`) is left alone: a host that had set `touch-action: none` itself sees no change. New option `touchAction`: a CSS value forces it, `false` never touches the canvas.
