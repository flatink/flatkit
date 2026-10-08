// flatink/flatink#69 — in REAL pixels (skia-canvas), the two fill behaviors reported on 0.46.0:
//  1. a `path` whose contours overlap is filled even-odd, so two contours of the SAME direction leave a hole
//     where they overlap (the "k" of a logo imported from SVG). `nonzero` asks for the SVG / Canvas rule.
//  2. in a `mask layer`, two shapes that overlap excluded each other: the mask is now their UNION.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Doc } from '@flatkit/types'
import { parseProgramFull } from '@flatkit/engine/flatFormat'
import { FlatPlayer } from '@flatkit/player'
import { hitChain } from '@flatkit/player/hit'

const g = globalThis as Record<string, unknown>
const saved: Record<string, unknown> = {}
let Canvas: new (w: number, h: number) => HTMLCanvasElement

beforeAll(async () => {
  const skia = (await import('skia-canvas')) as unknown as Record<string, unknown>
  Canvas = skia.Canvas as typeof Canvas
  for (const k of ['document', 'window', 'devicePixelRatio', 'Path2D', 'DOMMatrix']) saved[k] = g[k]
  g.document = { createElement: () => new Canvas(1, 1) }
  g.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {} }
  g.devicePixelRatio = 1
  g.Path2D = skia.Path2D
  g.DOMMatrix = skia.DOMMatrix
})
afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete g[k]; else g[k] = v } })

/** Renders frame 0 of a program and returns a reader: is the pixel at (x, y) painted (not the white page)? */
function painted(src: string): { doc: Doc; at: (x: number, y: number) => boolean } {
  const doc = parseProgramFull(src) as Doc
  const c = new Canvas(doc.width, doc.height)
  ;(c as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({ width: doc.width, height: doc.height, left: 0, top: 0, right: doc.width, bottom: doc.height }) as DOMRect
  const p = new FlatPlayer(c, doc, { autoplay: false, input: false, audio: false } as never)
  p.seek(0); p.render()
  const ctx = c.getContext('2d')!
  return { doc, at: (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return d[0] < 250 || d[1] < 250 || d[2] < 250 } }
}

const page = (body: string) => `size 300 300\nbackground #FFFFFF\ntimeline 30 30\n\nscene {\n${body}\n}`
// Two squares, 40..200 and 120..280: they overlap on 120..200.
const SAME = 'M40 40 L200 40 L200 200 L40 200 Z M120 120 L280 120 L280 280 L120 280 Z'
const OPPOSITE = 'M40 40 L200 40 L200 200 L40 200 Z M120 120 L120 280 L280 280 L280 120 Z'

describe('`nonzero` — a path filled by the SVG / Canvas default rule (flatink/flatink#69)', () => {
  it('two contours of the same direction: the overlap is a hole by default, and full with `nonzero`', () => {
    const evenodd = painted(page(`  layer "A" { path "${SAME}" fill #461FBF }`))
    expect(evenodd.at(80, 80)).toBe(true)
    expect(evenodd.at(160, 160)).toBe(false) // the documented ring idiom: a nested contour cuts a hole
    const nonzero = painted(page(`  layer "A" { path "${SAME}" fill #461FBF nonzero }`))
    expect(nonzero.at(80, 80)).toBe(true)
    expect(nonzero.at(160, 160)).toBe(true)
    expect(nonzero.at(240, 240)).toBe(true)
    expect(nonzero.at(240, 80)).toBe(false) // outside both squares
  })

  it('`nonzero` with contours of opposite directions still cuts the hole, as in SVG', () => {
    const r = painted(page(`  layer "B" { path "${OPPOSITE}" fill #461FBF nonzero }`))
    expect(r.at(80, 80)).toBe(true)
    expect(r.at(160, 160)).toBe(false)
  })

  it('a gradient fill follows the rule too', () => {
    const r = painted(page(`  layer "A" { path "${SAME}" fill linear(0, 0:#461FBF, 1:#FF0059) nonzero }`))
    expect(r.at(160, 160)).toBe(true)
  })

  it('a pack from elsewhere with an unknown rule is drawn even-odd, it does not throw', () => {
    const doc = parseProgramFull(page(`  layer "A" { path "${SAME}" fill #461FBF }`)) as Doc
    ;(doc.layers[0].items[0] as unknown as { fillRule: string }).fillRule = 'bogus'
    const c = new Canvas(300, 300)
    ;(c as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => ({ width: 300, height: 300, left: 0, top: 0, right: 300, bottom: 300 }) as DOMRect
    const p = new FlatPlayer(c, doc, { autoplay: false, input: false, audio: false } as never)
    p.seek(0)
    expect(() => p.render()).not.toThrow()
    const d = c.getContext('2d')!.getImageData(160, 160, 1, 1).data
    expect(d[0]).toBeGreaterThan(250) // the overlap is the even-odd hole
    expect(c.getContext('2d')!.getImageData(80, 80, 1, 1).data[0]).toBeLessThan(250)
  })

  it('the touch area follows the picture: the overlap is hit with `nonzero`, not without', () => {
    const hit = (words: string) => hitChain(parseProgramFull(page(`  layer "A" { path "${SAME}" as "k" fill #461FBF${words} }`)) as Doc, 0, {}, { x: 160, y: 160 }).length
    expect(hit('')).toBe(0)
    expect(hit(' nonzero')).toBe(1)
  })
})

describe('`mask layer` — the shapes of its matter add up (flatink/flatink#69)', () => {
  const masked = (matter: string) => painted(page(`  mask layer "C" {\n    ${matter}\n    layer "f" { rect 0 0 300 300 fill #FF0059 }\n  }`))

  it('two shapes that overlap: the overlap belongs to the mask', () => {
    const r = masked('rect 40 40 160 160 fill #FFFFFF  rect 120 120 160 160 fill #FFFFFF')
    expect(r.at(80, 80)).toBe(true)
    expect(r.at(240, 240)).toBe(true)
    expect(r.at(160, 160)).toBe(true) // was a hole: the second shape cancelled the first
    expect(r.at(240, 80)).toBe(false)
  })

  it('three shapes on the same spot stay a mask (no parity between shapes)', () => {
    const r = masked('rect 40 40 160 160 fill #FFFFFF  rect 120 120 160 160 fill #FFFFFF  circle 160 160 30 fill #FFFFFF')
    expect(r.at(160, 160)).toBe(true)
    expect(r.at(128, 128)).toBe(true)
  })

  it('a shape keeps its OWN rule: a ring in the matter still has its hole', () => {
    const ring = 'path "M40 40 L260 40 L260 260 L40 260 Z M100 100 L200 100 L200 200 L100 200 Z" fill #FFFFFF'
    const alone = masked(ring)
    expect(alone.at(60, 60)).toBe(true)
    expect(alone.at(150, 150)).toBe(false)
    // …and another shape of the matter fills part of that hole.
    const both = masked(`${ring}  rect 100 100 50 50 fill #FFFFFF`)
    expect(both.at(125, 125)).toBe(true)
    expect(both.at(175, 175)).toBe(false)
    expect(both.at(60, 60)).toBe(true)
  })

  it('a `nonzero` shape of the matter is full where its contours overlap', () => {
    const r = masked(`path "${SAME}" fill #FFFFFF nonzero`)
    expect(r.at(160, 160)).toBe(true)
  })

  it('shapes inside a group of the matter add up with the others', () => {
    const r = masked('rect 40 40 160 160 fill #FFFFFF  group "g" at 120,120 { layer "c" { rect 0 0 160 160 fill #FFFFFF } }')
    expect(r.at(160, 160)).toBe(true)
    expect(r.at(240, 240)).toBe(true)
    expect(r.at(240, 80)).toBe(false)
  })

  it('the content keeps its own alpha and what is under the mask stays', () => {
    const src = page(`  layer "bg" { rect 0 0 300 300 fill #00FF00 }\n  mask layer "C" {\n    rect 40 40 160 160 fill #FFFFFF  rect 120 120 160 160 fill #FFFFFF\n    layer "f" { rect 0 0 300 300 fill #FF0000 opacity 0.5 }\n  }`)
    const doc = parseProgramFull(src) as Doc
    const c = new Canvas(300, 300)
    ;(c as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => ({ width: 300, height: 300, left: 0, top: 0, right: 300, bottom: 300 }) as DOMRect
    const p = new FlatPlayer(c, doc, { autoplay: false, input: false, audio: false } as never)
    p.seek(0); p.render()
    const px = (x: number, y: number) => [...c.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3)]
    expect(px(240, 80)).toEqual([0, 255, 0]) // outside the mask: the background, untouched
    const [r, gr] = px(160, 160) // inside, in the overlap: half red over green
    expect(Math.abs(r - 128)).toBeLessThanOrEqual(2)
    expect(Math.abs(gr - 128)).toBeLessThanOrEqual(2)
  })
})
