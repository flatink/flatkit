import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseProgramFull } from '@flatkit/engine/flatFormat'
import { resolveLayerAt } from '@flatkit/engine/cel'
import { itemsHaveGlyph, wrapLines, isRenderStatic, compositeFiltered, renderItems } from './drawScene'

// Mask clipping routing: TEXT/IMAGE matter -> alpha clipping (compositeMasked);
// vector matter -> fast clip `ctx.clip` (common case, unchanged).
describe('itemsHaveGlyph (mask routing: text vs vector)', () => {
  const matterOf = (src: string) => {
    const doc = parseProgramFull(src)
    const mask = doc.layers.find((l) => l.isMask)!
    return { doc, items: resolveLayerAt(mask, 0, {}) }
  }

  it('TEXT matter -> alpha clipping', () => {
    const { doc, items } = matterOf(`scene {
      mask layer "T" {
        text "Hi" at 0,0 font "Geist, sans-serif" size 40 align left line 1 color #ffffff bold box 100 50
        layer "f" { path "M0 0L10 0L10 10Z" fill #ff0000 }
      }
    }`)
    expect(itemsHaveGlyph(doc, items)).toBe(true)
  })

  it('REGION matter (common case) -> fast vector clip', () => {
    const { doc, items } = matterOf(`scene {
      mask layer "R" {
        path "M0 0L60 0L60 60L0 60Z" fill #ffffff
        layer "f" { path "M0 0L10 0L10 10Z" fill #ff0000 }
      }
    }`)
    expect(itemsHaveGlyph(doc, items)).toBe(false)
  })

  it('TEXT nested inside a group -> alpha clipping', () => {
    const { doc, items } = matterOf(`scene {
      mask layer "G" {
        group "wrap" at 0,0 pivot 0,0 {
          layer "c" { text "X" at 0,0 font "Geist, sans-serif" size 40 align left line 1 color #ffffff bold box 60 50 }
        }
        layer "f" { path "M0 0L10 0L10 10Z" fill #ff0000 }
      }
    }`)
    expect(itemsHaveGlyph(doc, items)).toBe(true)
  })
})

describe('drawScene -- isRenderStatic (cacheability of filtered composites)', () => {
  const firstItem = (body: string) => {
    const doc = parseProgramFull(['size 100 100', 'scene {', '  layer "L" {', body, '  }', '}'].join('\n'))
    return { doc, it: doc.layers[0].items[0] }
  }
  it('scenery group (image/path, no expression) -> STATIC', () => {
    const { doc, it } = firstItem('    group "Decor" at 0,0 filter shadow 0 4 8 #00000033 {\n      layer "c" { path "M0 0L10 0L10 10Z" fill #000000 }\n    }')
    expect(isRenderStatic(doc as never, it)).toBe(true)
  })
  it('group with a channel expression -> NOT static', () => {
    const { doc, it } = firstItem('    group "Anim" at 0,0 expr x "time * 10" filter glow 5 #ffffff {\n      layer "c" { path "M0 0L10 0L10 10Z" fill #000000 }\n    }')
    expect(isRenderStatic(doc as never, it)).toBe(false)
  })
  it('animated child (expression) inside -> NOT static', () => {
    const { doc, it } = firstItem('    group "Parent" at 0,0 filter glow 5 #ffffff {\n      layer "c" {\n        group "Child" at 0,0 expr y "sin(time)" {\n          layer "d" { path "M0 0L1 0L1 1Z" fill #000000 }\n        }\n      }\n    }')
    expect(isRenderStatic(doc as never, it)).toBe(false)
  })
  it('dynamic text (bind) inside -> NOT static', () => {
    const { doc, it } = firstItem('    group "Gauge" at 0,0 filter glow 5 #ffffff {\n      layer "c" { text "{}" at 0,0 box 20 10 bind "score" }\n    }')
    expect(isRenderStatic(doc as never, it)).toBe(false)
  })
})

describe('drawScene -- wrapLines (word-wrap)', () => {
  // ctx stub: width = number of characters x 10 px.
  const ctx = { measureText: (s: string) => ({ width: s.length * 10 }) } as unknown as CanvasRenderingContext2D

  it('breaks at spaces to fit within maxW', () => {
    // "go now there": "go now" = 6c = 60px <= 80; + " there" overflows -> new line.
    expect(wrapLines(ctx, 'go now there', 80)).toEqual(['go now', 'there'])
  })
  it('respects explicit \\n', () => {
    expect(wrapLines(ctx, 'a\nb c', 1000)).toEqual(['a', 'b c'])
  })
  it('a word wider than maxW stays alone on its line (no intra-word break)', () => {
    expect(wrapLines(ctx, 'short enormouslylong short', 60)).toEqual(['short', 'enormouslylong', 'short'])
  })
})

describe('drawScene -- text stroke (outline) rendering', () => {
  // Recording fake 2D context: counts the text-drawing calls and the last stroke style applied.
  const mkCtx = () => {
    const calls: { fillText: string[]; strokeText: string[] } = { fillText: [], strokeText: [] }
    const ctx = {
      calls, lineWidth: 0, lineCap: '', lineJoin: '', miterLimit: 0, strokeStyle: '', fillStyle: '',
      font: '', textAlign: '', textBaseline: '', globalAlpha: 1,
      save() {}, restore() {}, transform() {}, setLineDash() {},
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      measureText: (s: string) => ({ width: s.length * 10 }),
      fillText: (t: string) => calls.fillText.push(t),
      strokeText: (t: string) => calls.strokeText.push(t),
    }
    return ctx as unknown as CanvasRenderingContext2D & { calls: typeof calls }
  }
  const draw = (src: string) => {
    const doc = parseProgramFull(src)
    const items = resolveLayerAt(doc.layers[0], 0, {})
    const ctx = mkCtx()
    renderItems(ctx, doc, items, 0, null, new Set(), { fps: 60 })
    return ctx.calls
  }

  it('stroked text strokes BEFORE filling each line (outline behind the fill)', () => {
    const calls = draw('size 100 100\nscene {\n  layer "c" {\n    text "A\\nB" at 0,0 font "sans-serif" size 40 color #ffd23f stroke #e23b3b 6 join round\n  }\n}')
    expect(calls.strokeText).toEqual(['A', 'B']) // one stroke per line
    expect(calls.fillText).toEqual(['A', 'B'])   // one fill per line
  })

  it('plain text (no stroke) never calls strokeText', () => {
    const calls = draw('size 100 100\nscene {\n  layer "c" {\n    text "Hi" at 0,0 font "sans-serif" size 40 color #ffffff\n  }\n}')
    expect(calls.strokeText).toEqual([])
    expect(calls.fillText).toEqual(['Hi'])
  })
})

describe('drawScene -- near-invisible subtree is pruned (opacity <= 0.01, aligned with hit)', () => {
  const realPath2D = (globalThis as { Path2D?: unknown }).Path2D
  beforeEach(() => { (globalThis as { Path2D?: unknown }).Path2D = class { addPath() {} rect() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {} closePath() {} arc() {} ellipse() {} } })
  afterEach(() => { (globalThis as { Path2D?: unknown }).Path2D = realPath2D })

  // Counts fills (each region/text paint). A group whose resolved opacity is the off-phase value drives it.
  const paintsAt = (opacityExpr: string): number => {
    let paints = 0
    const ctx = new Proxy({}, {
      get(_t, k: string) {
        if (k === 'canvas') return { width: 100, height: 100 }
        if (k === 'measureText') return () => ({ width: 10 })
        if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
        if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} })
        if (k === 'fill' || k === 'fillRect' || k === 'fillText') return () => { paints++ }
        return () => {}
      },
      set: () => true,
    }) as unknown as CanvasRenderingContext2D
    const doc = parseProgramFull(`size 100 100\nscene {\n  layer "L" {\n    group "G" at 0,0 {\n      layer "c" { circle 50 50 30 fill #ff0000 }\n    }\n  }\n}\nobject "G" {\n  opacity = ${opacityExpr}\n}`)
    renderItems(ctx, doc, resolveLayerAt(doc.layers[0], 0, {}), 0, null, new Set(), { fps: 60 })
    return paints
  }

  it('a group at opacity > 0.01 paints its child; at <= 0.01 it is pruned (subtree skipped)', () => {
    expect(paintsAt('1')).toBe(1)
    expect(paintsAt('0.5')).toBe(1)
    expect(paintsAt('0.02')).toBe(1)
    expect(paintsAt('0.01')).toBe(0) // boundary: mirrors hit's `> 0.01`
    expect(paintsAt('0.005')).toBe(0) // SMOOTHED-near-0 gating (the corpus case) → free
    expect(paintsAt('0')).toBe(0)
  })
})

describe('drawScene -- filtered composite cache (static scenery perf)', () => {
  // Fake 2D context: records the essentials, getTransform returns a fixed matrix.
  const mkCtx = () => ({
    canvas: { width: 800, height: 600 },
    globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none', fillStyle: '',
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    setTransform: () => {}, save: () => {}, restore: () => {},
    drawImage: () => {}, fillRect: () => {}, clearRect: () => {},
  }) as unknown as CanvasRenderingContext2D
  // Fake off-screen canvas (pool + cache): getContext returns a fake ctx.
  const fakeCanvasEl = () => ({ width: 0, height: 0, getContext: () => mkCtx() })

  beforeEach(() => { vi.stubGlobal('document', { createElement: () => fakeCanvasEl() }) })
  afterEach(() => vi.unstubAllGlobals())

  const bbox = { minX: 10, minY: 10, maxX: 60, maxY: 60 }
  const glow = [{ type: 'glow' as const, blur: 5, color: '#ffffff' }]

  it('HIT after stabilization: 1 observation frame + 1 bake, then reblit without redraw', () => {
    const map = new Map()
    const draw = vi.fn()
    compositeFiltered(mkCtx(), 1, null, glow, 1, bbox, draw, { map, id: 'g', sig: 'A' }) // observe
    compositeFiltered(mkCtx(), 1, null, glow, 1, bbox, draw, { map, id: 'g', sig: 'A' }) // bake
    expect(draw).toHaveBeenCalledTimes(2)
    compositeFiltered(mkCtx(), 1, null, glow, 1, bbox, draw, { map, id: 'g', sig: 'A' }) // HIT
    expect(draw).toHaveBeenCalledTimes(2) // no redraw
  })

  it('VOLATILE object (signature changing every frame) -> never baked (no bake overhead)', () => {
    const map = new Map()
    const draw = vi.fn()
    for (const sig of ['A', 'B', 'C', 'D']) compositeFiltered(mkCtx(), 1, null, glow, 1, bbox, draw, { map, id: 'g', sig })
    expect(draw).toHaveBeenCalledTimes(4) // every frame redraws, never a hit
    expect(map.get('g')?.canvas).toBeUndefined() // no bake -> no persistent canvas
  })

  it('INVALIDATION: changed signature (zoom/pan/asset) -> re-observe then re-bake', () => {
    const map = new Map()
    const draw = vi.fn()
    compositeFiltered(mkCtx(), 1, null, glow, 1, bbox, draw, { map, id: 'g', sig: 'A' }) // observe
    compositeFiltered(mkCtx(), 1, null, glow, 1, bbox, draw, { map, id: 'g', sig: 'A' }) // bake
    compositeFiltered(mkCtx(), 1, null, glow, 1, bbox, draw, { map, id: 'g', sig: 'A' }) // HIT (no draw)
    expect(draw).toHaveBeenCalledTimes(2)
    compositeFiltered(mkCtx(), 1, null, glow, 1, bbox, draw, { map, id: 'g', sig: 'B' }) // sig changes -> observe
    expect(draw).toHaveBeenCalledTimes(3)
  })

  it('without a cache slot -> unchanged behavior (draws every time)', () => {
    const draw = vi.fn()
    compositeFiltered(mkCtx(), 1, null, glow, 1, bbox, draw)
    compositeFiltered(mkCtx(), 1, null, glow, 1, bbox, draw)
    expect(draw).toHaveBeenCalledTimes(2)
  })
})
