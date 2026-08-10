// -----------------------------------------------------------------------------
//  render.ts -- HEADLESS PNG rendering of a Doc (skia-canvas backend), for `flatc --render`.
//
//  Gives agents/CI an IMAGE of what they author (the "blind positioning" safeguard). We replay the
//  real `FlatPlayer` on a skia canvas: same paths, gradients, filters (glow/shadow via `ctx.filter`)
//  and SVG as the browser. skia-canvas is loaded through a DYNAMIC import with a NON-LITERAL specifier,
//  so it is never part of the public build graph -- install it on demand only when `--render` is used.
// -----------------------------------------------------------------------------
import { FlatPlayer } from '@flatkit/player'
import type { Doc, Item } from '@flatkit/types'
import { isGroup, isInstance } from '@flatkit/engine/layers'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type RenderOpts = { frame?: number; vars?: Record<string, number>; scale?: number; steps?: number; params?: Record<string, string> }

/** Cap on `--steps` (anti-DoS: an untrusted doc must not freeze the render host). One step = 1/60 s of sim. */
const MAX_RENDER_STEPS = 10_000

/** Minimal structural view of the `skia-canvas` surface we use. Kept local so the public build needs
 *  no native binary; the real module is resolved at runtime only when `--render` runs. */
interface SkiaCanvas {
  Canvas: new (w: number, h: number) => HTMLCanvasElement & { toBuffer(fmt: string): Promise<Uint8Array> }
  loadImage: (src: string) => Promise<unknown>
  Path2D: typeof Path2D
  /** Browser global under Node: the mask/clip path builder does `new DOMMatrix([...])` (drawScene). */
  DOMMatrix: typeof DOMMatrix
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

/**
 * A renderer held OPEN over a document: the expensive setup is paid once, then any number of frames.
 *
 * Every consumer that needed more than one image — a GIF, an MP4, a contact sheet, a loop check —
 * reimplemented this on top of the player, because the only thing on offer rendered a single frame and
 * paid the whole cost each time: the dynamic `skia-canvas` import, writing the embedded fonts to a temp
 * dir and registering them, decoding every image asset, building a `FlatPlayer`, installing ten globals.
 * Four such harnesses exist across two neighbouring repos, ~430 lines, each rediscovering the same
 * shims — including that `document` must exist or every `filter` and `tint` is dropped in SILENCE.
 */
export type Renderer = {
  /** PNG of one frame. `vars` overrides state for this frame; `steps` runs N sim steps before capture. */
  frame(frame: number, opts?: { vars?: Record<string, number>; steps?: number }): Promise<Uint8Array>
  /** The document's pixel size at the renderer's scale. */
  readonly width: number
  readonly height: number
  /** Restore the globals and drop the temp font files. Always call it — it is not optional. */
  close(): void
}

/**
 * Open a renderer over `doc`. The globals it installs (`document`, `Path2D`, `DOMMatrix`, …) stay in
 * place until `close()`, which is what makes a frame loop cheap; it also means one renderer at a time
 * per process. `params` sets a SYMBOL's exposed params (a state name or a number) before the first
 * frame — the reason a consumer had to write its own harness to preview anything with a state.
 */
export async function createRenderer(doc: Doc, opts: { scale?: number; params?: Record<string, string> } = {}): Promise<Renderer> {
  // Non-literal specifier: tsc does not resolve it, so skia-canvas is not a build dependency.
  const skiaPkg: string = 'skia-canvas'
  let skia: SkiaCanvas
  try { skia = (await import(skiaPkg)) as unknown as SkiaCanvas }
  catch {
    throw new Error(
      'skia-canvas is required for rendering. Install it as a dev dependency: `npm i -D skia-canvas` ' +
      '(pnpm users: also allow its build script with `pnpm approve-builds` or add "skia-canvas" to ' +
      'pnpm.onlyBuiltDependencies, then reinstall). If the native binary is still missing afterwards, ' +
      'run `node node_modules/skia-canvas/lib/prebuild.mjs download`.',
    )
  }
  const { Canvas, loadImage, Path2D, FontLibrary, DOMMatrix } = skia
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 2
  const W = doc.width, H = doc.height

  const withParams = opts.params ? applyParams(doc, opts.params) : doc

  // Register embedded fonts up front so the player's `ctx.font` resolves to the authored faces.
  const { dir: fontDir, families } = registerFonts(withParams, FontLibrary)
  if (families.length) process.stderr.write(`flatc: registered ${families.length} font famil${families.length > 1 ? 'ies' : 'y'}: ${families.join(', ')}\n`)

  // Pre-decode the image assets (skia reads SVG/PNG/... from the data-URIs embedded by flatc).
  const images = new Map<string, CanvasImageSource>()
  for (const a of withParams.assets ?? []) {
    if (a.kind === 'svg' || a.kind === 'image' || /^data:image\//.test(a.data ?? '')) {
      try { images.set(a.id, (await loadImage(a.data)) as unknown as CanvasImageSource) } catch { /* unreadable asset: ignored (placeholder) */ }
    }
  }

  // Globals the player/rendering expects under Node (restored by close()).
  const g = globalThis as Record<string, unknown>
  const saved: Record<string, unknown> = {}
  const set = (k: string, v: unknown) => { saved[k] = g[k]; g[k] = v }
  set('Path2D', Path2D)
  set('DOMMatrix', DOMMatrix) // mask/clip layers build their clip path with `new DOMMatrix([...])` (no browser global under Node)
  set('window', { addEventListener() {}, removeEventListener() {}, devicePixelRatio: scale })
  set('addEventListener', () => {})
  set('removeEventListener', () => {})
  set('requestAnimationFrame', () => 0)
  set('cancelAnimationFrame', () => {})
  set('document', { createElement: (t: string) => (t === 'canvas' ? new Canvas(1, 1) : {}) }) // off-screen canvas (filters/tint)

  const pxW = Math.max(1, Math.round(W * scale))
  const pxH = Math.max(1, Math.round(H * scale))
  const canvas = new Canvas(pxW, pxH)
  const el = canvas as unknown as HTMLCanvasElement & { toBuffer(fmt: string): Promise<Uint8Array> }
  Object.assign(el, {
    getBoundingClientRect: () => ({ width: W, height: H, left: 0, top: 0, right: W, bottom: H }),
    addEventListener: () => {}, removeEventListener: () => {}, style: {},
  })

  let player: FlatPlayer | null = new FlatPlayer(el, withParams, { input: false, audio: false, padding: 0, image: (id) => images.get(id) ?? null })

  return {
    width: pxW,
    height: pxH,
    async frame(frame, frameOpts = {}) {
      if (!player) throw new Error('renderer is closed')
      if (frameOpts.vars) for (const [k, v] of Object.entries(frameOpts.vars)) player.setVar(k, v)
      player.seek(frame) // applies frame + state
      const steps = frameOpts.steps ?? 0
      if (steps > 0) {
        const n = Math.min(Math.floor(steps), MAX_RENDER_STEPS)
        if (steps > MAX_RENDER_STEPS) process.stderr.write(`flatc: steps clamped to ${MAX_RENDER_STEPS} (was ${steps})\n`)
        player.stepSim(n) // run N fixed sim steps (onEnterFrame) so a stateful act unfolds before capture
      }
      return el.toBuffer('png')
    },
    close() {
      player?.destroy()
      player = null
      for (const k in saved) { if (saved[k] === undefined) delete g[k]; else g[k] = saved[k] }
      // skia keeps the parsed faces in memory after `use()`, so the temp files are safe to drop now.
      if (fontDir) try { rmSync(fontDir, { recursive: true, force: true }) } catch { /* best-effort cleanup */ }
    },
  }
}

/**
 * A copy of `doc` with the scene's instances carrying `params` — a state NAME or a number, the same
 * spelling `--preview --set` accepts, resolved by the renderer per the symbol's ParamDef / state
 * machines. Rendering a program could only override document `var`s, so previewing a door in its `open`
 * state meant writing a harness that mutated the symbol by hand. That was one of four such harnesses.
 *
 * Set on the INSTANCE, not on the symbol's defaults: that is where a call-site value belongs, and it is
 * what `--preview` already does.
 */
function applyParams(doc: Doc, params: Record<string, string>): Doc {
  const entries = Object.entries(params)
  if (!entries.length) return doc
  // Which names each symbol exposes: its typed params, plus the param each state machine drives.
  const exposed = new Map<string, Set<string>>()
  for (const sym of doc.symbols) {
    exposed.set(sym.id, new Set([...(sym.states ?? []).map((st) => st.param), ...(sym.params ?? []).map((p) => p.name)]))
  }
  const out = structuredClone(doc)
  const applied = new Set<string>()
  const visit = (items: Item[]): void => {
    for (const it of items) {
      if (isInstance(it)) {
        const known = exposed.get(it.symbolId)
        if (known) {
          for (const [k, v] of entries) {
            if (!known.has(k)) continue
            ;(it.params ??= {})[k] = v
            applied.add(k)
          }
        }
      }
      if (isGroup(it)) for (const l of it.layers) visit(l.items)
    }
  }
  for (const l of out.layers) visit(l.items)
  for (const sym of out.symbols) for (const l of sym.layers) visit(l.items)
  for (const [k] of entries) {
    if (!applied.has(k)) process.stderr.write(`flatc: no symbol exposes a param named "${k}"\n`)
  }
  return out
}

/** Render `doc` to a PNG (Buffer). `frame` = target image; `vars` = state override; `scale` = x-px (default 2).
 *  A one-shot convenience over `createRenderer` — reach for the renderer itself as soon as you want two. */
export async function renderDocToPng(doc: Doc, opts: RenderOpts = {}): Promise<Uint8Array> {
  const renderer = await createRenderer(doc, { scale: opts.scale, params: opts.params })
  try {
    return await renderer.frame(opts.frame ?? 0, { vars: opts.vars, steps: opts.steps })
  } finally {
    renderer.close()
  }
}
