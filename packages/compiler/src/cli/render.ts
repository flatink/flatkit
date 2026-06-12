// -----------------------------------------------------------------------------
//  render.ts -- HEADLESS PNG rendering of a Doc (skia-canvas backend), for `flatc --render`.
//
//  Gives agents/CI an IMAGE of what they author (the "blind positioning" safeguard). We replay the
//  real `FlatPlayer` on a skia canvas: same paths, gradients, filters (glow/shadow via `ctx.filter`)
//  and SVG as the browser. skia-canvas is loaded through a DYNAMIC import with a NON-LITERAL specifier,
//  so it is never part of the public build graph -- install it on demand only when `--render` is used.
// -----------------------------------------------------------------------------
import { FlatPlayer } from '@flatkit/player'
import type { Doc } from '@flatkit/types'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type RenderOpts = { frame?: number; vars?: Record<string, number>; scale?: number; steps?: number }

/** Cap on `--steps` (anti-DoS: an untrusted doc must not freeze the render host). One step = 1/60 s of sim. */
const MAX_RENDER_STEPS = 10_000

/** Minimal structural view of the `skia-canvas` surface we use. Kept local so the public build needs
 *  no native binary; the real module is resolved at runtime only when `--render` runs. */
interface SkiaCanvas {
  Canvas: new (w: number, h: number) => HTMLCanvasElement & { toBuffer(fmt: string): Promise<Uint8Array> }
  loadImage: (src: string) => Promise<unknown>
  Path2D: typeof Path2D
  /** Global font registry. `use(paths)` reads each file's intrinsic name-table family; the 2-arg
   *  `use(family, paths)` form FORCES that alias (fixes variable-font statics whose name table lies). */
  FontLibrary: {
    use(fontPaths: readonly string[]): Array<{ family: string }>
    use(family: string, fontPaths: readonly string[]): Array<{ family: string }>
  }
}

/** Map a font asset's MIME (or its data-URI) to a file extension skia-canvas can parse. */
const FONT_EXT: Record<string, string> = {
  'font/woff2': '.woff2', 'font/woff': '.woff', 'font/ttf': '.ttf', 'font/otf': '.otf',
  'font/collection': '.ttc', 'application/font-woff': '.woff', 'application/x-font-ttf': '.ttf',
}

/** Registers every embedded `font` asset with skia's FontLibrary so headless text uses the authored
 *  faces (not host fallbacks). Fonts are baked as base64 data-URIs by flatc; FontLibrary only reads
 *  FILE paths, so we materialize each into a temp dir, register it, and return that dir for cleanup. */
function registerFonts(doc: Doc, FontLibrary: SkiaCanvas['FontLibrary']): { dir: string | null; families: string[] } {
  const fonts = (doc.assets ?? []).filter((a) => a.kind === 'font' && /^data:/.test(a.data ?? ''))
  if (fonts.length === 0) return { dir: null, families: [] }
  const dir = mkdtempSync(join(tmpdir(), 'flatc-fonts-'))
  const families: string[] = []
  for (const a of fonts) {
    const b64 = a.data.slice(a.data.indexOf(',') + 1)
    const ext = FONT_EXT[a.mime] ?? `.${(a.mime.split('/')[1] || 'ttf').replace(/[^\w]/g, '')}`
    const file = join(dir, a.id.replace(/[^\w.-]/g, '_') + ext)
    try {
      writeFileSync(file, Buffer.from(b64, 'base64'))
      // `family` alias (from `asset … font "Name"`) forces the registered name, so the face matches the
      // text's `font "Name"` even when the file's own name table is wrong (variable-font static export).
      const used = a.family ? FontLibrary.use(a.family, [file]) : FontLibrary.use([file])
      for (const f of used) if (!families.includes(f.family)) families.push(f.family)
    } catch (e) {
      process.stderr.write(`flatc: skipped font asset "${a.id}" (${a.mime}): ${(e as Error).message}\n`)
    }
  }
  return { dir, families }
}

/** Render `doc` to a PNG (Buffer). `frame` = target image; `vars` = state override (`--at`); `scale` = x-px (default 2). */
export async function renderDocToPng(doc: Doc, opts: RenderOpts = {}): Promise<Uint8Array> {
  // Non-literal specifier: tsc does not resolve it, so skia-canvas is not a build dependency.
  const skiaPkg: string = 'skia-canvas'
  let skia: SkiaCanvas
  try { skia = (await import(skiaPkg)) as unknown as SkiaCanvas }
  catch {
    throw new Error(
      'skia-canvas is required for --render. Install it as a dev dependency: `npm i -D skia-canvas` ' +
      '(pnpm users: also allow its build script with `pnpm approve-builds` or add "skia-canvas" to ' +
      'pnpm.onlyBuiltDependencies, then reinstall). If the native binary is still missing afterwards, ' +
      'run `node node_modules/skia-canvas/lib/prebuild.mjs download`.',
    )
  }
  const { Canvas, loadImage, Path2D, FontLibrary } = skia
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 2
  const W = doc.width, H = doc.height

  // Register embedded fonts up front so the player's `ctx.font` resolves to the authored faces.
  const { dir: fontDir, families } = registerFonts(doc, FontLibrary)
  if (families.length) process.stderr.write(`flatc: registered ${families.length} font famil${families.length > 1 ? 'ies' : 'y'}: ${families.join(', ')}\n`)

  // Pre-decode the image assets (skia reads SVG/PNG/... from the data-URIs embedded by flatc).
  const images = new Map<string, CanvasImageSource>()
  for (const a of doc.assets ?? []) {
    if (a.kind === 'svg' || a.kind === 'image' || /^data:image\//.test(a.data ?? '')) {
      try { images.set(a.id, (await loadImage(a.data)) as unknown as CanvasImageSource) } catch { /* unreadable asset: ignored (placeholder) */ }
    }
  }

  // Globals the player/rendering expects under Node (restored on exit).
  const g = globalThis as Record<string, unknown>
  const saved: Record<string, unknown> = {}
  const set = (k: string, v: unknown) => { saved[k] = g[k]; g[k] = v }
  set('Path2D', Path2D)
  set('window', { addEventListener() {}, removeEventListener() {}, devicePixelRatio: scale })
  set('addEventListener', () => {})
  set('removeEventListener', () => {})
  set('requestAnimationFrame', () => 0)
  set('cancelAnimationFrame', () => {})
  set('document', { createElement: (t: string) => (t === 'canvas' ? new Canvas(1, 1) : {}) }) // off-screen canvas (filters/tint)

  const canvas = new Canvas(Math.max(1, Math.round(W * scale)), Math.max(1, Math.round(H * scale)))
  const el = canvas as unknown as HTMLCanvasElement & { toBuffer(fmt: string): Promise<Uint8Array> }
  Object.assign(el, {
    getBoundingClientRect: () => ({ width: W, height: H, left: 0, top: 0, right: W, bottom: H }),
    addEventListener: () => {}, removeEventListener: () => {}, style: {},
  })

  try {
    const pl = new FlatPlayer(el, doc, { input: false, audio: false, padding: 0, image: (id) => images.get(id) ?? null })
    if (opts.vars) for (const [k, v] of Object.entries(opts.vars)) pl.setVar(k, v)
    pl.seek(opts.frame ?? 0) // applies frame + state
    if (opts.steps && opts.steps > 0) {
      const n = Math.min(Math.floor(opts.steps), MAX_RENDER_STEPS)
      if (opts.steps > MAX_RENDER_STEPS) process.stderr.write(`flatc: --steps clamped to ${MAX_RENDER_STEPS} (was ${opts.steps})\n`)
      pl.stepSim(n) // run N fixed sim steps (onEnterFrame) so a stateful act unfolds before capture
    }
    const png = await el.toBuffer('png')
    pl.destroy()
    return png
  } finally {
    for (const k in saved) { if (saved[k] === undefined) delete g[k]; else g[k] = saved[k] }
    // skia keeps the parsed faces in memory after `use()`, so the temp files are safe to drop now.
    if (fontDir) try { rmSync(fontDir, { recursive: true, force: true }) } catch { /* best-effort cleanup */ }
  }
}
