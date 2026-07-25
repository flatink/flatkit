# @flatkit/player

A tiny runtime that loads a [FlatInk](http://flatink.zwyk-studio.com/) `.flatpack` and plays it in a
`<canvas>` — animations *and* interactivity (drags, drop zones, scratch-to-reveal, dials, physics, sound).
**No editor, no heavy dependencies**, small enough to drop into someone else's bundle.

## Install

```sh
pnpm add @flatkit/player
```

## Usage

```js
import { FlatPlayer, loadEmbeddedFonts } from '@flatkit/player'

const doc = await fetch('scene.flatpack').then((r) => r.json())

await loadEmbeddedFonts(doc) // register the doc's embedded fonts (browser) — BEFORE mounting
const player = new FlatPlayer(canvas, doc, { autoplay: true })
```

- `loadEmbeddedFonts(doc)` registers a doc's embedded `font` assets so text uses the authored faces (no-op
  outside a DOM, never throws). See
  [docs/embedding-fonts.md](https://github.com/flatink/flatkit/blob/main/docs/embedding-fonts.md).
- Subpath entries: `@flatkit/player/debug` (headless playback + gesture trace), `@flatkit/player/render`
  (canvas drawing primitives), `@flatkit/player/hit` (hit-testing).

## Talking to the scene

A scene emits events with the DSL's `send`, and exposes its state variables both ways:

```js
const player = new FlatPlayer(canvas, doc, {
  onEvent: (e) => {
    // e = { name, value? , fields? } — `value` for `send "s", <expr>` / `text("…")`,
    //                                  `fields` for the record form `send "s", { a = …, b }`
    if (e.name === 'save') setState((s) => ({ ...s, ...e.fields }))
  },
})

player.setVar('difficulty', 2)   // host → scene
player.getVar('score')           // scene → host
player.destroy()                 // on unmount: releases the listeners
```

Full contract (payload shapes, keyboard, teardown, security) →
[docs/host-integration.md](https://github.com/flatink/flatkit/blob/main/docs/host-integration.md).

## Security

A `.flatpack` is **untrusted input**: the player loads embedded `data:` assets only by default (no arbitrary
fetch), with an opt-in `sameOriginAssetResolver` for local files. See
[SECURITY.md](https://github.com/flatink/flatkit/blob/main/SECURITY.md).

## License

[MIT](https://github.com/flatink/flatkit/blob/main/LICENSE) (c) Zwyk Studio — part of
[flatkit](https://github.com/flatink/flatkit).
