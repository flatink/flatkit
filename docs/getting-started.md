# Getting started

> Prerequisite: the `flatc` CLI — `pnpm add -D @flatkit/compiler` (or run it from this repo with
> `pnpm flatc …`). See [Tooling](tooling.md) for the full CLI.

## 1. Your first scene

Create `hello.flatink`:

```
size 320 240
background #0a0e1c

scene {
  layer "main" {
    circle 160 120 48 fill #ffcc00
    text "Hello, FlatInk" font "sans-serif" size 24 align center line 1.2 color #ffffff box 320 40 at 0,190
  }
}
```

- `size` is **required and must come first** (the canvas, in scene units).
- `scene { … }` holds **layers**; layers hold **items** (`circle`, `text`, `path`, `image`, `group`…).
- Coordinates are plain numbers; the origin is the top-left of the canvas.

Compile and look at it:

```sh
flatc hello.flatink -o hello.flatpack     # → a single playable file
flatc hello.flatink --render -o hello.png  # → a PNG, to see what you drew (needs skia-canvas)
```

## 2. Make it move

Animation comes from **channel expressions** in a behavior block. Give the circle a name (`as "Sun"`),
then drive a channel:

```
scene {
  layer "main" {
    circle 160 120 48 fill #ffcc00 as "Sun"
  }
}

object "Sun" {
  scaleX = 1 + sin(time * 3) * 0.1   # gentle pulse
  scaleY = 1 + sin(time * 3) * 0.1
}
```

`time` is seconds elapsed; `sin`/`cos` and friends are built in (see [Expressions](expressions-and-stdlib.md)).
Channels you can bind: `x`, `y`, `scaleX`, `scaleY`, `rotation`, `opacity`.

## 3. Make it react

Add state (`var`) and an event handler:

```
var score = 0

scene {
  layer "main" {
    circle 160 120 48 fill #ffcc00 as "Sun"
    text "Score: {}" bind "score" box 320 40 at 0,10 font "sans-serif" size 20 align center line 1.2 color #fff
  }
}

object "Sun" {
  when clicked { score = score + 1 }
  scaleY = self.grabbed ? 0.92 : 1     # squash while pressed
}
```

- `var score = 0` declares interactive state.
- `when clicked { … }` runs actions on click.
- `text "… {}" bind "score"` shows the live value (the `{}` slot).
- `self.grabbed` is this object's own interaction state — see [feedback](behavior-and-interactions.md#feedback).

## 4. Play it

In a web page:

```js
import { FlatPlayer } from '@flatkit/player'

const canvas = document.querySelector('canvas')
const doc = await fetch('hello.flatpack').then((r) => r.json())
const player = new FlatPlayer(canvas, doc, { autoplay: true })
```

Or verify it headlessly (great in CI) without a browser — see [Tooling → headless play](tooling.md#headless-play--play).

## Where next

- Draw richer scenes → **[Scene & drawing](scene-and-drawing.md)**
- Drag/drop, interactors, feedback → **[Behavior & interactions](behavior-and-interactions.md)**
- The full `flatc` CLI → **[Tooling](tooling.md)**
