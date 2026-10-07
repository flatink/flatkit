// flatink/flatink demos on 0.45 — `reveal … erase` in REAL pixels (skia-canvas): the op-recording tests of
// the player cannot see a residue or measure an edge. Two defects were reported on a scratch card with
// `brush 44 grain 11`: faint rings left INSIDE the rubbed area, and an edge soft over 15 to 20 units where
// the documentation says about half a grain.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { parseProgramFull } from '@flatkit/engine/flatFormat'
import { resolveLayerAt } from '@flatkit/engine/cel'
import { renderItems } from '@flatkit/player/render'

type Ctx2D = CanvasRenderingContext2D
const W = 400, H = 300
const VEIL = `size ${W} ${H}\nscene {\n  layer "L" {\n    group "Veil" at 200,150 { layer "c" { rect -180 -120 360 240 fill #000000 } }\n  }\n}`

const g = globalThis as Record<string, unknown>
const saved: Record<string, unknown> = {}
let newCanvas: (w: number, h: number) => { getContext(k: '2d'): Ctx2D }

beforeAll(async () => {
  const skia = (await import('skia-canvas')) as unknown as { Canvas: new (w: number, h: number) => { getContext(k: '2d'): Ctx2D }; Path2D: unknown; DOMMatrix: unknown }
  newCanvas = (w, h) => new skia.Canvas(w, h)
  for (const k of ['document', 'Path2D', 'DOMMatrix']) saved[k] = g[k]
  g.document = { createElement: () => new skia.Canvas(1, 1) }
  g.Path2D = skia.Path2D
  g.DOMMatrix = skia.DOMMatrix
})
afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete g[k]; else g[k] = v } })

/** Scratch a horizontal stroke across a black veil over a white page, one frame per pointer step — the way
 *  a finger does it: a few cells fall each frame. Returns how much VEIL is left at a point (0 = gone, 1 = whole). */
function scratchAcross(cell: number, brush: number, scale = 1): (x: number, y: number) => number {
  const doc = parseProgramFull(VEIL)
  const veil = doc.layers[0].items[0]
  const minX = 20, minY = 30, cols = Math.ceil(360 / cell)
  const cells = new Set<number>()
  const scratched = new Map([[veil.id, { cells, minX, minY, cell, cols, version: 0 }]])
  const filterCache = new Map()
  const ctx = newCanvas(W * scale, H * scale).getContext('2d')
  const paint = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W * scale, H * scale)
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    renderItems(ctx, doc, resolveLayerAt(doc.layers[0], 0, {}), 0, null, new Set(), { fps: 60, scratched, filterCache })
  }
  paint()
  for (let px = 80; px <= 320; px += 5) { // the finger moves 5 units a frame along y = 150
    for (let r = 0; r * cell < 240; r++) for (let c = 0; c < cols; c++) {
      const cx = minX + (c + 0.5) * cell, cy = minY + (r + 0.5) * cell
      if (Math.hypot(cx - px, cy - 150) <= brush / 2) cells.add(r * cols + c)
    }
    paint()
  }
  paint() // the settled frame (baked)
  return (x, y) => 1 - ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data[0] / 255
}

/** Width of the erased edge along the vertical through x: distance between "veil 95% there" and "5% there". */
function edgeWidth(left: (x: number, y: number) => number, x: number): number {
  let top = NaN, bottom = NaN
  for (let y = 150; y > 60; y -= 0.5) { const v = left(x, y); if (Number.isNaN(bottom) && v > 0.05) bottom = y; if (v > 0.95) { top = y; break } }
  return bottom - top
}

describe('`reveal … erase` in pixels — what is rubbed is gone, and its edge is the one documented', () => {
  for (const [cell, brush] of [[11, 44], [4, 34], [28, 28]] as const) {
    it(`brush ${brush} grain ${cell}: nothing of the veil is left inside the stroke`, () => {
      const left = scratchAcross(cell, brush)
      let worst = 0
      // Well inside: every cell centre within a third of the brush of the stroke's axis is ticked for sure.
      for (let x = 100; x <= 300; x += 1) for (let y = 150 - brush / 6; y <= 150 + brush / 6; y += 1) worst = Math.max(worst, left(x, y))
      expect(worst).toBeLessThan(0.01)
    })
    it(`brush ${brush} grain ${cell}: the edge is soft over about half a grain, not a fog`, () => {
      const w = edgeWidth(scratchAcross(cell, brush), 200)
      expect(w).toBeGreaterThan(0)
      expect(w).toBeLessThanOrEqual(Math.max(2, cell * 0.75))
    })
  }
  it('at density 2 the edge is the same width in scene units', () => {
    expect(edgeWidth(scratchAcross(11, 44, 2), 200)).toBeLessThanOrEqual(11 * 0.75)
  })
})
