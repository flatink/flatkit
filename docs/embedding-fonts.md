# Embedding the player: loading embedded fonts

A `.flatink` can **embed its fonts** so a deck is self-contained:

```
asset "Archivo Black" "ArchivoBlack.woff2" font
scene { layer "L" { text "Déçu où ? ÇÀ" at 20,40 font "Archivo Black" size 48 } }
```

`flatc` inlines the face into the compiled doc as a base64 data-URI:

```jsonc
// doc.assets
[{ "id": "Archivo Black", "kind": "font", "mime": "font/woff2",
   "data": "data:font/woff2;base64,…", "family": "Archivo Black" }]
```

## The host owns font loading

`FlatPlayer` draws text with `ctx.font = "<family>"` on the canvas it was given. It does **not** register
the doc's `kind:'font'` assets itself — loading a face is environment-specific (a browser `FontFace`, a
skia `FontLibrary`, …) and asynchronous, while the player's render is synchronous. So **the host that embeds
the player is responsible for registering the embedded fonts before rendering.** Skip this and text silently
falls back to a system font.

> The `family` to register is **`asset.family || asset.id`** — it's exactly what the text targets via
> `font "<…>"`. Wrap loading in `try/catch`: a corrupt face should degrade to a fallback, never crash.

### Browser (`<canvas>`)

`@flatkit/player` exports the helper — `import` it, no need to reimplement:

```js
import { FlatPlayer, loadEmbeddedFonts } from '@flatkit/player'

await loadEmbeddedFonts(doc) //            ← BEFORE new FlatPlayer
const player = new FlatPlayer(canvas, doc)

// Optional safety net (FOIT): redraw once any late face settles.
document.fonts?.ready.then(() => player.render())
```

`loadEmbeddedFonts(doc)` registers each `asset kind:'font'` (base64 data-URI) as a `FontFace` under
`asset.family || asset.id`, **no-ops outside a DOM** (SSR / Node), and **skips a corrupt face** (graceful
fallback, never throws). It's a tiny tree-shakeable export — it pulls in no extra dependency (uses the
browser's own `FontFace` / `document.fonts`). Calling it again (e.g. a remount) is harmless: a family
already on `document.fonts` is not re-registered.

> **Security.** Only embedded `data:` URIs are honored, and the bytes are decoded and handed to `FontFace`
> directly — `asset.data` is never spliced into a CSS `src` string. So an untrusted doc can neither point a
> face at a remote origin (no network fetch) nor inject extra CSS `src` descriptors via `url()`/`local()`.
> This is the same "no arbitrary fetch" contract the player's image/audio paths enforce.

### Node / headless (`skia-canvas`)

`FontLibrary` reads **file** paths, so materialize each base64 data-URI to a temp file, then register it.

```js
import { FlatPlayer } from '@flatkit/player'
import { FontLibrary } from 'skia-canvas'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function useEmbeddedFonts(doc) {
  for (const a of doc.assets ?? []) {
    if (a.kind !== 'font' || !/^data:[^;]*;base64,/.test(a.data ?? '')) continue
    const base64 = a.data.slice(a.data.indexOf(',') + 1)
    const ext = (a.mime || '').includes('woff2') ? 'woff2' : (a.mime || '').includes('woff') ? 'woff' : 'ttf'
    const file = join(mkdtempSync(join(tmpdir(), 'fk-fonts-')), `${(a.family || a.id).replace(/[^a-z0-9]+/gi, '_')}.${ext}`)
    writeFileSync(file, Buffer.from(base64, 'base64'))
    try {
      FontLibrary.use(a.family || a.id, [file]) // 2-arg form forces the family alias
    } catch {
      /* invalid font → fallback */
    }
  }
}

useEmbeddedFonts(doc) //                    ← BEFORE the first render
const player = new FlatPlayer(canvasEl, doc, { input: false, audio: false })
```

`FontLibrary` is a **global, idempotent** registry for the process — registering the same family twice is
harmless (you may memoize by family to avoid re-writing temp files).

## What's already handled for you

- **`flatc --render`** (the CLI, used for preview/OG images) registers embedded fonts **internally** before
  drawing — CLI users and render pipelines get correct text for free. The host glue above is only needed when
  you drive `@flatkit/player` **directly**.

- The **browser** path ships as `loadEmbeddedFonts` (exported above). The **skia/Node** path stays a snippet:
  it would drag the optional `skia-canvas` dependency into the package, so it's left to the host (and the
  `flatc --render` CLI already covers headless rendering).
