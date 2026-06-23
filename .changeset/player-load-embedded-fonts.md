---
"@flatkit/types": patch
"@flatkit/engine": patch
"@flatkit/player": patch
"@flatkit/compiler": patch
---

player: `loadEmbeddedFonts(doc)` -- register a doc's embedded fonts in the browser before mounting, so text
uses the AUTHORED faces instead of a system fallback. Previously every consumer reimplemented the same
`FontFace` glue; now it ships as a tiny tree-shakeable export:

  import { FlatPlayer, loadEmbeddedFonts } from '@flatkit/player'
  await loadEmbeddedFonts(doc)            // BEFORE new FlatPlayer
  const player = new FlatPlayer(canvas, doc)

It registers each `asset kind:'font'` under `family || id`, no-ops outside a DOM (SSR / Node), skips a
corrupt face (graceful fallback, never throws), and is idempotent across remounts (a family already on
`document.fonts` is not re-registered).

Security: only embedded `data:` URIs are honored, and the bytes are decoded and handed to `FontFace`
directly -- `asset.data` is never spliced into a CSS `src` string. So an untrusted doc can neither point a
face at a remote origin (no network fetch / SSRF) nor inject extra CSS `src` descriptors via
`url()`/`local()`. This is the same "no arbitrary fetch" contract the player's image/audio paths enforce.

Docs: new `docs/embedding-fonts.md` covers the browser helper and the skia/Node (`FontLibrary`) snippet.
