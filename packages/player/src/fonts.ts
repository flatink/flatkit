// -----------------------------------------------------------------------------
//  fonts.ts -- load a Doc's EMBEDDED fonts in the BROWSER, so the player's text uses the authored faces.
//  The player draws text via `ctx.font` but does NOT load fonts itself (loading is async and
//  environment-specific). In Node/headless, use skia-canvas `FontLibrary.use` instead (see docs).
// -----------------------------------------------------------------------------
import type { Doc } from '@flatkit/types'

/**
 * Register a doc's embedded fonts (`asset kind:'font'`, base64 data-URIs baked by `flatc`) as `FontFace`
 * on `document.fonts`, so the player's text resolves to the AUTHORED faces instead of a system fallback.
 *
 * Call it (and `await` it) BEFORE mounting/rendering a `FlatPlayer` in the browser:
 *
 * ```js
 * import { FlatPlayer, loadEmbeddedFonts } from '@flatkit/player'
 * await loadEmbeddedFonts(doc)
 * const player = new FlatPlayer(canvas, doc)
 * // optional FOIT net: document.fonts?.ready.then(() => player.render())
 * ```
 *
 * No-op outside a DOM (SSR / Node). A corrupt face is skipped (graceful fallback, never throws). The
 * registered family is `asset.family || asset.id` — exactly what the text targets via `font "<…>"`.
 *
 * SECURITY: only EMBEDDED `data:` URIs are honored, and the bytes are decoded here and handed to
 * `FontFace` directly — `asset.data` is never spliced into a CSS `src` string. So an untrusted doc can
 * neither point a face at a remote origin (no network fetch / SSRF) nor inject extra CSS `src`
 * descriptors via `url()`/`local()`. This mirrors the player's image/audio "no arbitrary fetch" contract
 * (see `sameOriginAssetResolver` / `isEmbeddedData` in player.ts).
 */
export async function loadEmbeddedFonts(doc: Doc): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return
  const fonts = (doc.assets ?? []).filter(
    (a) => a.kind === 'font' && typeof a.data === 'string' && a.data.startsWith('data:'),
  )
  if (fonts.length === 0) return
  // Skip families already registered (e.g. a remount of the same doc) — `document.fonts.add` is not
  // idempotent, so without this each call would accumulate duplicate faces.
  const have = new Set<string>()
  document.fonts.forEach?.((f) => have.add(f.family))
  await Promise.all(
    fonts.map(async (a) => {
      const family = a.family || a.id
      if (have.has(family)) return
      try {
        const buf = dataUriToBytes(a.data)
        if (!buf) return // not a base64 data: URI we can decode → skip, keep the fallback
        const face = new FontFace(family, buf)
        await face.load()
        document.fonts.add(face)
      } catch {
        /* invalid/corrupt face → leave the fallback, don't break the mount */
      }
    }),
  )
}

/** Decode a base64 `data:` URI (the only shape `flatc` bakes for fonts) to its raw bytes; `null` for
 *  anything we can't decode. Keeping this in-house means `data` is never handed to a CSS `src` parser. */
function dataUriToBytes(uri: string): ArrayBuffer | null {
  const comma = uri.indexOf(',')
  if (comma < 0 || !/;base64/i.test(uri.slice(0, comma))) return null
  const bin = atob(uri.slice(comma + 1)) // throws on malformed base64 → caught by the caller
  const buf = new ArrayBuffer(bin.length)
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return buf
}
