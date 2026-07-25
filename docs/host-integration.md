# Host integration — embedding the player in an app

A `.flatpack` is not a video: it has **state** and it can **talk back**. This guide is the receiving
end — how the page that mounts `@flatkit/player` listens to a scene, drives it, and tears it down.

The scene side of the contract lives in
[Behavior & interactions](behavior-and-interactions.md#send--talking-to-the-host).

## Mount

```js
import { FlatPlayer, loadEmbeddedFonts } from '@flatkit/player'

const doc = await fetch('activity.flatpack').then((r) => r.json())
await loadEmbeddedFonts(doc)                    // BEFORE mounting (see embedding-fonts.md)

const player = new FlatPlayer(canvas, doc, {
  autoplay: true,
  onEvent: (e) => handle(e),                    // the `send` channel
})
```

| Option | Default | What it does |
|---|---|---|
| `autoplay` | `false` | starts the timeline on mount |
| `loop` | `true` | loops the timeline |
| `padding` | `0` | margin around the page, in CSS px |
| `audio` | `true` | `false` mutes `sound "…"` and audio tracks |
| `input` | `true` | `false` = non-interactive preview: it animates but ignores pointer **and keyboard** |
| `render` | `true` | `false` = headless (logic + `send`s only, no Canvas API needed) |
| `resolveAsset` | embedded only | maps an asset to a URL. Default: embedded `data:` URIs only — see [Security](#security) |
| `onEvent` | — | called on every `send` |

## Receiving events (`send` → `onEvent`)

`onEvent` gets **one object per `send`**, synchronously, during the tick that fired it. The type is
exported — `import type { SendEvent } from '@flatkit/player'`:

```ts
type SendEvent = {
  name: string                          // the event name, e.g. "save"
  value?: number | string               // number payload, or text("…") content
  fields?: Record<string, number>       // record payload — named numbers
}
```

Which key is present depends on the payload form the scene used:

| In the scene | The host receives |
|---|---|
| `send "win"` | `{ name: 'win' }` |
| `send "score", lives * 100` | `{ name: 'score', value: 300 }` |
| `send "answer", text("txtCard")` | `{ name: 'answer', value: 'Bonjour' }` |
| `send "save", { x = px, y = py, doors }` | `{ name: 'save', fields: { x: 12, y: 40, doors: 3 } }` |

`value` and `fields` are mutually exclusive today — a record carries no positional `value`. Write the
handler so an unknown/absent key is simply ignored, and it stays forward-compatible:

```js
function handle(e) {
  switch (e.name) {
    case 'score': setScore(e.value ?? 0); break
    case 'save':  setState((s) => ({ ...s, ...e.fields })); break   // a record IS a state patch
    case 'win':   finish(); break
  }
}
```

Three properties worth relying on:

- **Fire-and-forget.** Nothing is returned to the scene; the return value of `onEvent` is ignored.
- **Exception-safe.** If your callback throws, the player catches, logs, and keeps playing — a broken
  host handler never freezes the activity. (So do your own error reporting inside it.)
- **Vetted.** Everything crossing the boundary is validated by the player, not trusted from the
  document: the event name matches `[A-Za-z_][A-Za-z0-9_-]{0,63}`, numbers are finite (`NaN`/`Infinity`
  → `0`), text is truncated at 4096 characters, and a record carries at most 32 fields whose names are
  plain identifiers — never `__proto__`, `constructor` or `prototype`. Spreading `e.fields` into your
  own state cannot pollute a prototype.

## Driving the scene from the host

The state variables (`var` in the DSL, "Layer B") are readable and writable both ways:

```js
player.setVar('difficulty', 2)        // host → scene (redraws immediately; arrays are cloned)
player.getVar('score')                // scene → host: number | number[] | undefined (arrays copied)
player.allVars()                      // snapshot of everything, for debugging/save states
```

`getVar`/`allVars` return **copies**: mutating the result never touches the running scene. Symmetrically
`setVar` clones what you pass in.

Playback control mirrors the DSL actions: `play()`, `pause()`, `toggle()`, `stop()`, `seek(frame)`,
plus the read-only `currentFrame`, `isPlaying`, `fps`, `duration`. `load(doc)` swaps the document in
place, and `render()` forces a repaint (useful after a late font settles).

## Keyboard

`keys.<Key>` in an expression is `1` while the key is held. The name is the browser's
`KeyboardEvent.key` value — `keys.ArrowRight`, `keys.a`, `keys.Escape` — plus one alias: the space bar
(`key === ' '`) is also exposed as **`keys.Space`**.

The listeners are attached to the **window** (a scene reacts immediately, with no click-to-focus step),
but the player is a good citizen about it — you should not have to do anything:

- **It never steals what you are typing.** A keystroke headed to an `<input>`, `<textarea>`, `<select>`
  or any `contenteditable` element of the host page is ignored by the scene.
- **It only consumes the keys the scene actually declares.** The player scans the document for
  `keys.<Name>` and calls `preventDefault()` on those alone: an activity bound to the arrows stops
  scrolling the page under it, while every other key keeps its native behavior. Browser/OS shortcuts
  (any `Ctrl`/`Cmd`/`Alt` combination), `Tab` and the function keys are never consumed, whatever the
  scene declares.
- **A key never stays stuck.** Losing the window (alt-tab, an iframe taking the focus) releases the
  held keys, even though the browser delivers no `keyup` in that case.

`input: false` remains the total opt-out: no pointer and no keyboard listener at all.

**On-screen controls.** There is no keyboard on a phone, so a key can also be driven programmatically —
wire your own D-pad to `setKey`, and the scene cannot tell the difference:

```js
btn.addEventListener('pointerdown', () => player.setKey('ArrowRight', true))
btn.addEventListener('pointerup',   () => player.setKey('ArrowRight', false))
```

A key stays held until released, so pair every `true` with a `false` (a `pointercancel`/`pointerleave`
handler too, or a finger sliding off the button leaves the scene running).

## Teardown

```js
player.destroy()   // pauses, releases the window/canvas listeners and the pending timers
```

Always call it when unmounting (a React `useEffect` cleanup, a route change…). Skipping it leaves
`keydown`/`resize` listeners attached to the window.

## Security

A `.flatpack` is **untrusted input** — treat it like third-party HTML, not like your own code. The
player is built for that: no `eval`, bounded per-tick work, and **no network access by default** (only
the assets embedded as `data:` URIs are loaded). To serve external assets, pass an explicit resolver so
the *host* picks the origin:

```js
import { FlatPlayer, sameOriginAssetResolver } from '@flatkit/player'
new FlatPlayer(canvas, doc, { resolveAsset: sameOriginAssetResolver('/activities/42/') })
```

Read [SECURITY.md](../SECURITY.md) for the full threat model.

## Testing the integration without a browser

`flatc … --play --script gestures.json` replays a gesture script headlessly and prints the `sends` (with
their `value`/`fields`) plus the final variables — the same objects your `onEvent` would receive. It is
the cheapest way to lock the host contract in CI. See [Tooling](tooling.md).

## See also

- What the scene can emit → **[Behavior & interactions](behavior-and-interactions.md#send--talking-to-the-host)**
- Registering the doc's embedded fonts → **[Embedding fonts](embedding-fonts.md)**
- Headless replay and CI → **[Tooling](tooling.md)**
