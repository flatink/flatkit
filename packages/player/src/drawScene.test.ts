import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseProgramFull } from '@flatkit/engine/flatFormat'
import { resolveLayerAt } from '@flatkit/engine/cel'
import type { Doc, Group, Instance, Layer, SymbolDef } from '@flatkit/types'
import { IDENTITY } from '@flatkit/engine/transform'
import { itemsHaveGlyph, wrapLines, isRenderStatic, isContentStatic, compositeFiltered, renderItems } from './drawScene'

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

describe('drawScene -- isContentStatic (cache a tinted item that only moves/scales)', () => {
  // Ignores the item's OWN channel expressions (folded into the composite cache signature) but still
  // requires its CONTENT subtree to be static — so each-bound tinted bricks reuse their baked composite
  // instead of re-isolating off-screen every frame. Regression guard for the "pop-corn breaker" lag.
  const layer = (items: Layer['items']): Layer => ({ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items })
  const staticInner: Group = { id: 'in', kind: 'group', name: 'in', transform: IDENTITY, layers: [] }
  const animInner: Group = { id: 'in', kind: 'group', name: 'in', transform: IDENTITY, expressions: { x: 'sin(time)' }, layers: [] }
  const STATIC_SYM: SymbolDef = { id: 'brick', name: 'Brick', layers: [layer([staticInner])] }
  const ANIM_SYM: SymbolDef = { id: 'animbrick', name: 'AnimBrick', layers: [layer([animInner])] }
  const docWith = (item: Group | Instance): Doc => ({ width: 100, height: 100, symbols: [STATIC_SYM, ANIM_SYM], layers: [layer([item])], variables: {} })
  const tint = { color: '#ff0000', amount: 0.85 }

  it('tinted instance with a channel expression but STATIC symbol content -> content-static (cacheable)', () => {
    const it: Instance = { id: 'b0', kind: 'instance', name: 'B0', transform: IDENTITY, symbolId: 'brick', tint, expressions: { scaleX: '1' } }
    const doc = docWith(it)
    expect(isRenderStatic(doc, it)).toBe(false) // its own channel expr makes it non-render-static…
    expect(isContentStatic(doc, it)).toBe(true) // …but its content bitmap is invariant -> cacheable
  })
  it('instance whose SYMBOL content is animated -> NOT content-static', () => {
    const it: Instance = { id: 'a0', kind: 'instance', name: 'A0', transform: IDENTITY, symbolId: 'animbrick', tint, expressions: { scaleX: '1' } }
    expect(isContentStatic(docWith(it), it)).toBe(false)
  })
  it('group with a channel expression but static content -> content-static (where isRenderStatic says no)', () => {
    const it: Group = { id: 'g', kind: 'group', name: 'g', transform: IDENTITY, expressions: { x: 'time * 10' }, layers: [layer([])] }
    const doc = docWith(it)
    expect(isRenderStatic(doc, it)).toBe(false)
    expect(isContentStatic(doc, it)).toBe(true)
  })
  it('group with a channel expression AND an animated child -> NOT content-static', () => {
    const it: Group = { id: 'gp', kind: 'group', name: 'gp', transform: IDENTITY, expressions: { x: '1' }, layers: [layer([{ id: 'ch', kind: 'group', name: 'ch', transform: IDENTITY, expressions: { y: 'sin(time)' }, layers: [] }])] }
    expect(isContentStatic(docWith(it), it)).toBe(false)
  })
  it('group whose CHILD carries a stateful modifier (no expression) -> NOT static (the spring would freeze)', () => {
    // A modifier (smooth/spring) integrates over time, so the child's pose changes frame-to-frame even with
    // no expression. The cache signature has no per-frame signal for a settled CHILD -> the subtree must be
    // treated as non-static, else the baked composite freezes the child mid-spring.
    const springChild: Group = { id: 'ch', kind: 'group', name: 'ch', transform: IDENTITY, modifiers: { rotation: { kind: 'smooth', target: '90', k: 0.2 } }, layers: [] }
    const it: Group = { id: 'gm', kind: 'group', name: 'gm', transform: IDENTITY, expressions: { x: '1' }, layers: [layer([springChild])] }
    expect(isRenderStatic(docWith(it), springChild)).toBe(false) // the child itself is driven by the modifier
    expect(isContentStatic(docWith(it), it)).toBe(false) // …so its parent's content bitmap is not cacheable
  })
  it('plain static instance -> content-static AND render-static (consistent)', () => {
    const it: Instance = { id: 'b1', kind: 'instance', name: 'B1', transform: IDENTITY, symbolId: 'brick', tint }
    const doc = docWith(it)
    expect(isRenderStatic(doc, it)).toBe(true)
    expect(isContentStatic(doc, it)).toBe(true)
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

describe('drawScene -- text on a path (`along`)', () => {
  const realPath2D = (globalThis as { Path2D?: unknown }).Path2D
  beforeEach(() => { (globalThis as { Path2D?: unknown }).Path2D = class { addPath() {} rect() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {} closePath() {} arc() {} ellipse() {} } })
  afterEach(() => { (globalThis as { Path2D?: unknown }).Path2D = realPath2D })

  // Recording 2D ctx: a save/restore transform STACK (translate accumulates), so each fillText records the
  // path point a glyph landed on. measureText: width = chars × 10 (so each glyph advances 10px).
  const mkCtx = () => {
    const glyphs: { ch: string; x: number; y: number }[] = []
    let tx = 0, ty = 0
    const stack: [number, number][] = []
    const ctx = {
      glyphs, globalAlpha: 1, fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '', lineWidth: 0, lineCap: '', lineJoin: '', miterLimit: 0,
      save() { stack.push([tx, ty]) }, restore() { const s = stack.pop(); if (s) { tx = s[0]; ty = s[1] } },
      setLineDash() {}, beginPath() {}, translate(x: number, y: number) { tx += x; ty += y }, rotate() {}, transform() {},
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      measureText: (s: string) => ({ width: s.length * 10 }),
      fillText: (ch: string) => glyphs.push({ ch, x: Math.round(tx), y: Math.round(ty) }),
      strokeText: () => {}, fill() {}, stroke() {},
    }
    return ctx as unknown as CanvasRenderingContext2D & { glyphs: { ch: string; x: number; y: number }[] }
  }
  const layout = (text: string) => {
    const src = `size 320 80\nscene {\n  layer "c" {\n    path "M0 0L300 0" as "Wire" nofill stroke #000000 2\n    ${text}\n  }\n}`
    const doc = parseProgramFull(src)
    const ctx = mkCtx()
    renderItems(ctx, doc, resolveLayerAt(doc.layers[0], 0, {}), 0, null, new Set(), { fps: 60 })
    return ctx.glyphs
  }

  it('align left: one glyph per char, placed left→right along the path (glyph centers at 5,15,25…)', () => {
    const g = layout('text "ABC" along "Wire" font "sans-serif" size 20 align left line 1.2 color #ffffff')
    expect(g.map((x) => x.ch)).toEqual(['A', 'B', 'C'])
    expect(g.map((x) => x.x)).toEqual([5, 15, 25]) // cumulative advance (10px) → glyph-center arc position
    expect(g.every((x) => x.y === 0)).toBe(true) // horizontal path → baseline on y=0
  })

  it('align center + start 0.5: run centered on the midpoint (150px)', () => {
    const g = layout('text "ABC" along "Wire" start 0.5 font "sans-serif" size 20 align center line 1.2 color #ffffff')
    expect(g.map((x) => x.x)).toEqual([140, 150, 160]) // centered around 0.5 × 300
  })

  it('glyphs past the end of an OPEN path are dropped (no pile-up)', () => {
    const src = `size 40 40\nscene {\n  layer "c" {\n    path "M0 0L8 0" as "Tiny" nofill stroke #000000 1\n    text "AB" along "Tiny" font "sans-serif" size 20 align left line 1.2 color #fff\n  }\n}`
    const doc = parseProgramFull(src)
    const ctx = mkCtx()
    renderItems(ctx, doc, resolveLayerAt(doc.layers[0], 0, {}), 0, null, new Set(), { fps: 60 })
    expect(ctx.glyphs.map((x) => x.ch)).toEqual(['A']) // B's center (15px) overflows the 8px path → dropped
  })
})

describe('drawScene -- text on a path: side & spacing (phase 2)', () => {
  const realPath2D = (globalThis as { Path2D?: unknown }).Path2D
  beforeEach(() => { (globalThis as { Path2D?: unknown }).Path2D = class { addPath() {} rect() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {} closePath() {} arc() {} ellipse() {} } })
  afterEach(() => { (globalThis as { Path2D?: unknown }).Path2D = realPath2D })

  type G = { ch: string; x: number; baseline: string }
  // Recording ctx: transform stack + the textBaseline in effect at each fillText. width = chars × 10.
  const mkCtx = () => {
    const glyphs: G[] = []
    let tx = 0, ty = 0, baseline = 'alphabetic'
    const stack: [number, number][] = []
    const ctx = {
      glyphs, globalAlpha: 1, fillStyle: '', strokeStyle: '', font: '', textAlign: '', lineWidth: 0, lineCap: '', lineJoin: '', miterLimit: 0,
      get textBaseline() { return baseline }, set textBaseline(v: string) { baseline = v },
      save() { stack.push([tx, ty]) }, restore() { const s = stack.pop(); if (s) { tx = s[0]; ty = s[1] } },
      setLineDash() {}, beginPath() {}, translate(x: number, y: number) { tx += x; ty += y }, rotate() {}, transform() {},
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      measureText: (s: string) => ({ width: s.length * 10 }),
      fillText: (ch: string) => glyphs.push({ ch, x: Math.round(tx), baseline }),
      strokeText() {}, fill() {}, stroke() {},
    }
    return ctx as unknown as CanvasRenderingContext2D & { glyphs: G[] }
  }
  const layout = (textClause: string) => {
    const src = `size 320 80\nscene {\n  layer "c" {\n    ${textClause}\n  }\n}`
    const doc = parseProgramFull(src)
    const ctx = mkCtx()
    renderItems(ctx, doc, resolveLayerAt(doc.layers[0], 0, {}), 0, null, new Set(), { fps: 60 })
    return ctx.glyphs
  }
  const xs = (clause: string) => layout(clause).map((g) => g.x)

  it('positive `spacing` widens the per-glyph advance', () => {
    // adv 10 + spacing 4 = 14 → glyph centers at 5, 19, 33.
    expect(xs('text "ABC" along path "M0 0L300 0" spacing 4 font "x" size 20 align left line 1.2 color #fff')).toEqual([5, 19, 33])
  })

  it('negative `spacing` tightens it', () => {
    // adv 10 - spacing 4 = 6 → centers at 5, 11, 17.
    expect(xs('text "ABC" along path "M0 0L300 0" spacing -4 font "x" size 20 align left line 1.2 color #fff')).toEqual([5, 11, 17])
  })

  it('very negative `spacing` is floored to a 1px effective advance (no overlap/reversal)', () => {
    // max(10 - 100, 1) = 1 → centers at 5, 6, 7 (monotonic, never backward).
    expect(xs('text "ABC" along path "M0 0L300 0" spacing -100 font "x" size 20 align left line 1.2 color #fff')).toEqual([5, 6, 7])
  })

  it('`side over` (default) = alphabetic baseline (outside); `side under` = top baseline (inside)', () => {
    expect(layout('text "AB" along path "M0 0L300 0" font "x" size 20 align left line 1.2 color #fff')[0].baseline).toBe('alphabetic')
    expect(layout('text "AB" along path "M0 0L300 0" side under font "x" size 20 align left line 1.2 color #fff')[0].baseline).toBe('top')
  })

  it('inline `along path` renders one glyph per char along the inline curve', () => {
    expect(layout('text "AB" along path "M0 0L300 0" font "x" size 20 align left line 1.2 color #fff').map((g) => g.ch)).toEqual(['A', 'B'])
    expect(xs('text "AB" along path "M0 0L300 0" font "x" size 20 align left line 1.2 color #fff')).toEqual([5, 15])
  })

  // ── Phase 3: animated marquee (`start "<expr>"`) ──
  const xsAt = (clause: string, frame: number) => {
    const src = `size 320 80\nscene {\n  layer "c" {\n    ${clause}\n  }\n}`
    const doc = parseProgramFull(src)
    const ctx = mkCtx()
    renderItems(ctx, doc, resolveLayerAt(doc.layers[0], frame, {}), frame, null, new Set(), { fps: 60 })
    return ctx.glyphs.map((g) => g.x)
  }

  it('`start "<expr>"` scrolls the run along the path (glyph positions shift with the frame)', () => {
    const clause = 'text "AB" along path "M0 0L300 0" start "frame / 600" font "x" size 20 align left line 1.2 color #fff'
    expect(xsAt(clause, 0)).toEqual([5, 15]) // start 0 → centers 5,15
    expect(xsAt(clause, 60)).toEqual([35, 45]) // start = 60/600 = 0.1 → anchor +30 → centers 35,45
  })

  it('animated path-text is NOT render-static; a plain path-text IS', () => {
    const anim = parseProgramFull('size 100 50\nscene {\n  layer "c" { text "x" along path "M0 0L99 0" start "frame/100" font "s" size 10 align left line 1.2 color #fff }\n}')
    expect(isRenderStatic(anim as never, anim.layers[0].items[0])).toBe(false)
    const still = parseProgramFull('size 100 50\nscene {\n  layer "c" { text "x" along path "M0 0L99 0" font "s" size 10 align left line 1.2 color #fff }\n}')
    expect(isRenderStatic(still as never, still.layers[0].items[0])).toBe(true)
  })
})
