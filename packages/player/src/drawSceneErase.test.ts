import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseProgramFull, parseFlatLib } from '@flatkit/engine/flatFormat'
import { resolveLayerAt } from '@flatkit/engine/cel'
import { renderItems } from './drawScene'
import { FlatPlayer } from './player'
import type { Doc } from '@flatkit/types'

// `reveal … erase`: the runtime rubs the veil out where the child scratched. The mechanism is an isolated
// off-screen composite + `destination-out` — the thing a `mask` layer cannot do, since its matter is an
// even-odd clip path where two overlapping stamps CANCEL instead of accumulating.
//
// Its own FILE, not another `describe` in drawScene.test.ts: the off-screen canvas pool is module state,
// and a neighbouring suite that already filled it would hand this one ITS fake context.

type Op = { op: string; args: number[] }
/** Everything drawn into the OFF-SCREEN buffer this test, in order (`=x` = a composite-op assignment). */
let ops: Op[]
let mainDraws: number // images blitted back onto the visible context

/** Recording 2D context. Re-read through a live binding, so the POOLED off-screen canvas (module state,
 *  created once) always reports into the CURRENT test's `ops` rather than the first one's. */
const recorder = () =>
  new Proxy({} as Record<string, unknown>, {
    get(_t, k: string) {
      if (k === 'canvas') return { width: 400, height: 300 }
      if (k === 'measureText') return () => ({ width: 10 })
      if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
      return (...args: unknown[]) => { ops.push({ op: k, args: args.filter((a) => typeof a === 'number') as number[] }) }
    },
    set: (_t, k: string, v) => { if (k === 'globalCompositeOperation' || k === 'filter') ops.push({ op: `=${String(v)}`, args: [] }); return true },
  }) as unknown as CanvasRenderingContext2D

let offscreen: CanvasRenderingContext2D
const saved: Record<string, unknown> = {}
const g = globalThis as Record<string, unknown>

beforeEach(() => {
  ops = []
  mainDraws = 0
  offscreen = recorder()
  for (const k of ['Path2D', 'document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', 'addEventListener', 'removeEventListener']) saved[k] = g[k]
  g.Path2D = class { moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {} closePath() {} addPath() {} rect() {} arc() {} ellipse() {} }
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => offscreen }) }
  g.window = { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 }
  g.requestAnimationFrame = () => 0
  g.cancelAnimationFrame = () => {}
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
})
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete g[k]; else g[k] = v } })

const mainCtx = () =>
  new Proxy({} as Record<string, unknown>, {
    get(_t, k: string) {
      if (k === 'canvas') return { width: 400, height: 300 }
      if (k === 'measureText') return () => ({ width: 10 })
      if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
      if (k === 'drawImage') return () => { mainDraws++ }
      return () => {}
    },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D

// A 100x100 veil at 50,50 (world 0..100). Grid cell 25 → 4 x 4, centres at 12.5 / 37.5 / 62.5 / 87.5.
const VEIL = 'size 200 200\nscene {\n  layer "L" {\n    group "Veil" at 50,50 { layer "c" { rect -50 -50 100 100 fill #999999 } }\n  }\n}'

describe('drawScene -- `reveal … erase` (the veil is rubbed out where scratched)', () => {
  const render = (cleared: number[]) => {
    const doc = parseProgramFull(VEIL)
    const veil = doc.layers[0].items[0]
    const scratched = new Map([[veil.id, { cells: new Set(cleared), minX: 0, minY: 0, cell: 25, cols: 4 }]])
    renderItems(mainCtx(), doc, resolveLayerAt(doc.layers[0], 0, {}), 0, null, new Set(), { fps: 60, scratched })
    return ops
  }

  it('punches one disc per cleared cell, in `destination-out` (overlaps UNION, they do not cancel)', () => {
    const arcs = render([0, 1, 5]).filter((o) => o.op === 'arc')
    expect(ops.some((o) => o.op === '=destination-out')).toBe(true)
    expect(arcs).toHaveLength(3)
    // index = row * cols + col → centres at (12.5,12.5) (37.5,12.5) (37.5,37.5); radius covers the cell.
    expect(arcs.map((a) => [a.args[0], a.args[1]])).toEqual([[12.5, 12.5], [37.5, 12.5], [37.5, 37.5]])
    expect(arcs[0].args[2]).toBeCloseTo(25 * 0.75, 6)
    // …with a BLURRED edge: hard discs read as stamps (a lone touch left a perfect circle, and the border
    // of a scratched area was a scallop at the mesh of the grid).
    expect(ops.some((o) => /^=blur\(/.test(o.op))).toBe(true)
    const punch = ops.slice(ops.findIndex((o) => o.op === '=destination-out'))
    expect(punch.filter((o) => o.op === 'fill')).toHaveLength(1) // ONE path, ONE fill — not one per cell
    expect(mainDraws).toBe(1) // the isolated result is blitted back once
  })

  it('an untouched veil is drawn normally — no buffer, no punch', () => {
    const drawn = render([])
    expect(drawn.filter((o) => o.op === 'arc')).toHaveLength(0)
    expect(drawn.some((o) => o.op === '=destination-out')).toBe(false)
    expect(mainDraws).toBe(0)
  })
})

describe('player -- a scratched `reveal … erase` reaches the renderer', () => {
  const program = (slots: string) => [
    VEIL, '',
    'object "Veil" {', '  reveal covered {', `${slots}`, '  }', '}',
  ].join('\n').replace('size 200 200', 'size 200 200\nvar covered = 0\nvar grid = fill(16, 0)')

  /** Drives a real player through a scratch stroke. Returns what the STROKE drew, and a `repaint()` that
   *  renders again with nothing changed — the case that used to re-composite for the rest of the activity. */
  const scratch = (slots: string) => {
    const handlers: Record<string, (e: { clientX: number; clientY: number; pointerId: number }) => void> = {}
    const canvas = {
      getContext: () => mainCtx(),
      getBoundingClientRect: () => ({ width: 200, height: 200, left: 0, top: 0, right: 200, bottom: 200 }),
      addEventListener: (type: string, fn: (e: { clientX: number; clientY: number; pointerId: number }) => void) => { handlers[type] = fn },
      removeEventListener: () => {}, setPointerCapture: () => {}, releasePointerCapture: () => {}, style: {},
      width: 200, height: 200,
    } as unknown as HTMLCanvasElement
    const pl = new FlatPlayer(canvas, parseProgramFull(program(slots)) as unknown as Doc, { input: true, padding: 0, loop: false })
    ops = []
    for (const [type, at] of [['pointerdown', 12], ['pointermove', 12], ['pointerup', 12]] as const) handlers[type]?.({ clientX: at, clientY: at, pointerId: 1 })
    const stroke = ops
    return {
      stroke,
      repaint: () => { ops = []; mainDraws = 0; pl.render(); return ops },
      done: () => pl.destroy(),
    }
  }

  it('with `erase`, the stroke punches the scratched cell out', () => {
    const s = scratch('    brush 25\n    erase')
    try {
      const arcs = s.stroke.filter((o) => o.op === 'arc')
      expect(arcs.length).toBeGreaterThanOrEqual(1) // the pointer at (12,12) cleared the top-left cell
      expect([arcs[0].args[0], arcs[0].args[1]]).toEqual([12.5, 12.5])
      expect(s.stroke.some((o) => o.op === '=destination-out')).toBe(true)
    } finally { s.done() }
  })

  it('a repaint with nothing scratched since is ONE blit — no re-render, no punch', () => {
    // The reported cost: once a single cell had fallen, every frame paid a bbox accumulation, an off-screen
    // canvas, a full re-render of the veil, N arcs and a blit back — for the rest of the activity, while the
    // child was busy elsewhere on the board.
    const s = scratch('    brush 25\n    erase')
    try {
      const again = s.repaint()
      expect(again.filter((o) => o.op === 'arc')).toHaveLength(0) // nothing re-punched…
      expect(again.filter((o) => o.op === 'fill')).toHaveLength(0) // …and the veil itself is not redrawn
      expect(mainDraws).toBe(1) // one blit of the baked bitmap
    } finally { s.done() }
  })

  it('a veil SEEDED as half-scratched is punched on its very first paint (no gesture at all)', () => {
    // Restoring an activity: the host seeds the `cells` array, and the veil must come back with its holes
    // — until now `scratched` was rebuilt by the finger only, so a returning reader found the image intact.
    const src = program('    brush 25\n    erase\n    cells grid').replace('var grid = fill(16, 0)', 'var grid = [1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]')
    const canvas = {
      getContext: () => mainCtx(),
      getBoundingClientRect: () => ({ width: 200, height: 200, left: 0, top: 0, right: 200, bottom: 200 }),
      addEventListener: () => {}, removeEventListener: () => {}, setPointerCapture: () => {}, releasePointerCapture: () => {}, style: {},
      width: 200, height: 200,
    } as unknown as HTMLCanvasElement
    ops = []
    const pl = new FlatPlayer(canvas, parseProgramFull(src) as unknown as Doc, { input: true, padding: 0, loop: false })
    try {
      const arcs = ops.filter((o) => o.op === 'arc')
      expect(arcs).toHaveLength(3) // one per seeded cell: (0,0) (0,1) (1,0)
      expect(arcs.map((a) => [a.args[0], a.args[1]])).toEqual([[12.5, 12.5], [37.5, 12.5], [12.5, 37.5]])
    } finally { pl.destroy() }
  })

  it('without `erase`, the same stroke changes nothing on screen (the fraction is all you get)', () => {
    const s = scratch('    brush 25')
    try {
      expect(s.stroke.filter((o) => o.op === 'arc')).toHaveLength(0)
      expect(s.stroke.some((o) => o.op === '=destination-out')).toBe(false)
    } finally { s.done() }
  })
})

// The composite cache is keyed per RENDER SCOPE, not per item id: a symbol's items are the same objects
// for every instance of it, so eight lanterns from one symbol used to share one entry and thrash it —
// measured at 480 content draws over 60 frames where 8 was the right answer.
describe('drawScene -- the composite cache is per instance, not per item id', () => {
  const rec = () => {
    let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    const stack: (typeof m)[] = []
    return new Proxy({} as Record<string, unknown>, {
      get(_t, k: string) {
        if (k === 'canvas') return { width: 400, height: 300 }
        if (k === 'measureText') return () => ({ width: 10 })
        if (k === 'getTransform') return () => ({ ...m })
        if (k === 'setTransform') return (a: number, b: number, c: number, d: number, e: number, f: number) => { m = { a, b, c, d, e, f } }
        if (k === 'translate') return (x: number, y: number) => { m = { ...m, e: m.e + x, f: m.f + y } }
        if (k === 'transform') return (a: number, b: number, c: number, d: number, e: number, f: number) => { m = { a, b, c, d, e: m.e + e, f: m.f + f } }
        if (k === 'save') return () => { stack.push({ ...m }) }
        if (k === 'restore') return () => { const s = stack.pop(); if (s) m = s }
        if (k === 'fill') return () => { drawn++ }
        return () => {}
      },
      set: () => true,
    }) as unknown as CanvasRenderingContext2D
  }
  let drawn = 0

  it('four instances of one filtered symbol each keep their own baked bitmap', () => {
    const lib = parseFlatLib('symbol "Lamp" { layer "c" { circle 0 0 12 fill #ffdf9a filter glow 8 #ffcf6a } }')
    const prog = ['size 400 300', 'scene { layer "L" {',
      ...Array.from({ length: 4 }, (_v, i) => `  instance "Lamp" as "P${i}" at ${40 + i * 90},150`), '} }'].join('\n')
    const doc = { ...parseProgramFull(prog), symbols: lib.symbols } as unknown as Doc
    for (const it of doc.layers[0].items) if ('symbolId' in it && String(it.symbolId).startsWith('@')) (it as { symbolId: string }).symbolId = lib.symbols[0].id
    const filterCache = new Map()
    const ctx = rec()
    for (let i = 0; i < 8; i++) renderItems(ctx, doc, resolveLayerAt(doc.layers[0], i, {}), i, null, new Set(), { fps: 60, filterCache })
    drawn = 0
    for (let i = 8; i < 18; i++) renderItems(ctx, doc, resolveLayerAt(doc.layers[0], i, {}), i, null, new Set(), { fps: 60, filterCache })
    expect(drawn).toBe(0) // all four blit their bitmap; sharing one entry gave 4 redraws per frame
    expect(filterCache.size).toBe(4) // …one entry each, not one for all
  })
})
