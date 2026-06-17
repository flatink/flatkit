import { describe, it, expect } from 'vitest'
import { resolveLayerAt, type Cel } from './cel'
import { IDENTITY, translation, decompose, recompose } from './transform'
import type { Group, Instance, Layer, Region } from '@flatkit/types'
import { polygonsToPath } from './path'

// ── Helpers ──────────────────────────────────────────────────────────────
const region = (id: string, color = '#000'): Region => ({ id, color, path: polygonsToPath([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]]) })
const group = (id: string): Group => ({ id, kind: 'group', name: id, transform: IDENTITY, layers: [] })
const inst = (id: string, symbolId = 'S'): Instance => ({ id, kind: 'instance', name: id, transform: IDENTITY, symbolId })
const layer = (items: Layer['items'], cels?: Cel[]): Layer => ({ id: 'L', name: 'L', visible: true, locked: false, opacity: 1, items, cels })
const tx = (it: { transform: { e: number } } | unknown) => (it as { transform: { e: number } }).transform.e
const ids = (items: ReturnType<typeof resolveLayerAt>) => items.map((i) => i.id)

describe('cel — self interaction state in channel expressions (feedback)', () => {
  const obj = (id: string, ex: Record<string, string>): Group => ({ ...group(id), expressions: ex as never })
  it('self.hovered / self.grabbed / self.pressed resolve from itemState', () => {
    const l = layer([obj('X', { opacity: 'self.hovered ? 0.5 : 1', scaleX: 'self.grabbed ? 0.9 : 1', y: 'self.pressed ? 5 : 0' })])
    const hovered = resolveLayerAt(l, 0, { itemState: (id) => (id === 'X' ? { hovered: 1, grabbed: 0, pressed: 0 } : undefined) })
    expect(hovered[0].opacity).toBe(0.5) // hover-lift (dim)
    const pressed = resolveLayerAt(l, 0, { itemState: () => ({ hovered: 0, grabbed: 1, pressed: 1 }) })
    expect(decompose((pressed[0] as Group).transform).scaleX).toBeCloseTo(0.9, 5) // grab-tilt
    expect(decompose((pressed[0] as Group).transform).y).toBeCloseTo(5, 5) // press-sink
    const none = resolveLayerAt(l, 0) // no itemState → all flags 0 → resting state
    expect(none[0].opacity).toBe(1)
    expect(decompose((none[0] as Group).transform).scaleX).toBeCloseTo(1, 5)
  })
})

describe('cel — channel expressions transform around the declared pivot', () => {
  const apply = (m: { a: number; b: number; c: number; d: number; e: number; f: number }, p: { x: number; y: number }) =>
    ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f })
  const P = { x: 100, y: 100 }
  const obj = (ex: Record<string, string>, pivot?: { x: number; y: number }): Group => ({ ...group('P'), ...(pivot ? { pivot } : {}), expressions: ex as never })
  const T = (g: Group) => (resolveLayerAt(layer([g]), 0)[0] as Group).transform

  it('scaleX/scaleY keep the pivot fixed (not the origin)', () => {
    const t = T(obj({ scaleX: '0.4', scaleY: '0.4' }, P))
    expect(apply(t, P).x).toBeCloseTo(100, 5) // pivot stays put (was (40,40) before the fix)
    expect(apply(t, P).y).toBeCloseTo(100, 5)
  })
  it('rotation turns around the pivot (rotates in place)', () => {
    const t = T(obj({ rotation: '0.5' }, P))
    expect(apply(t, P).x).toBeCloseTo(100, 5)
    expect(apply(t, P).y).toBeCloseTo(100, 5)
  })
  it('no pivot (default {0,0}) → unchanged origin-based behavior (scales around the origin)', () => {
    const t = T(obj({ scaleX: '0.4', scaleY: '0.4' })) // group transform = IDENTITY
    expect(apply(t, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 }) // origin fixed
    expect(apply(t, P).x).toBeCloseTo(40, 5) // (100,100) → (40,40): scale around the origin, as before
    expect(apply(t, P).y).toBeCloseTo(40, 5)
  })
  it('x/y channels drive the pivot position', () => {
    const t = T(obj({ x: '200', y: '50' }, P))
    expect(apply(t, P)).toEqual({ x: 200, y: 50 })
  })
})

describe('cel — resolveLayerAt', () => {
  it('without cels → returns layer.items (static)', () => {
    const l = layer([region('r1'), group('g1')])
    expect(resolveLayerAt(l, 0)).toEqual(l.items)
    expect(resolveLayerAt(l, 99)).toBe(l.items) // same reference (no copy)
  })

  it('before the first keyframe → empty layer (Flash style)', () => {
    const l = layer([group('g1')], [{ frame: 5, poses: [{ id: 'g1' }] }])
    expect(resolveLayerAt(l, 0)).toEqual([])
    expect(resolveLayerAt(l, 4)).toEqual([])
    expect(ids(resolveLayerAt(l, 5))).toEqual(['g1'])
  })

  it('material HOLD: holds the last key ≤ frame that defines `matter`', () => {
    const l = layer([], [
      { frame: 0, poses: [], matter: [region('a')] },
      { frame: 10, poses: [], matter: [region('b'), region('c')] },
    ])
    expect(ids(resolveLayerAt(l, 0))).toEqual(['a'])
    expect(ids(resolveLayerAt(l, 9))).toEqual(['a']) // HOLD
    expect(ids(resolveLayerAt(l, 10))).toEqual(['b', 'c'])
    expect(ids(resolveLayerAt(l, 50))).toEqual(['b', 'c']) // HOLD
  })

  it('empty keyframe (`matter: []`, `poses: []`) → nothing', () => {
    const l = layer([group('g1')], [
      { frame: 0, poses: [{ id: 'g1' }], matter: [region('a')] },
      { frame: 10, poses: [], matter: [] }, // explicit empty
    ])
    expect(ids(resolveLayerAt(l, 0))).toEqual(['a', 'g1'])
    expect(resolveLayerAt(l, 10)).toEqual([])
  })

  it('material OMITTED at a later key = HOLD (≠ empty)', () => {
    const l = layer([group('g1')], [
      { frame: 0, poses: [], matter: [region('a')] },
      { frame: 10, poses: [{ id: 'g1' }] }, // matter omitted → HOLD of `a`
    ])
    expect(ids(resolveLayerAt(l, 10))).toEqual(['a', 'g1']) // material held + new symbol
  })

  it('z-order v1: material behind, containers in front', () => {
    const l = layer([group('g1')], [{ frame: 0, poses: [{ id: 'g1' }], matter: [region('a'), region('b')] }])
    expect(ids(resolveLayerAt(l, 0))).toEqual(['a', 'b', 'g1'])
  })

  it('presence: a container absent from the current key is not rendered (disappear / reappear)', () => {
    const l = layer([group('g1')], [
      { frame: 0, poses: [{ id: 'g1' }] },
      { frame: 10, poses: [] }, // gone
      { frame: 20, poses: [{ id: 'g1' }] }, // reappears
    ])
    expect(ids(resolveLayerAt(l, 0))).toEqual(['g1'])
    expect(resolveLayerAt(l, 10)).toEqual([])
    expect(resolveLayerAt(l, 15)).toEqual([])
    expect(ids(resolveLayerAt(l, 20))).toEqual(['g1'])
  })

  it('HOLD (non-tweened span): the left pose is held, not interpolated', () => {
    const l = layer([group('g1')], [
      { frame: 0, poses: [{ id: 'g1', transform: translation(0, 0) }] }, // tween absent
      { frame: 10, poses: [{ id: 'g1', transform: translation(100, 0) }] },
    ])
    expect(tx(resolveLayerAt(l, 5)[0])).toBe(0) // HOLD on the left
    expect(tx(resolveLayerAt(l, 10)[0])).toBe(100)
  })

  it('TWEEN: interpolates transform + opacity between A and B (container present in both)', () => {
    const l = layer([group('g1')], [
      { frame: 0, tween: true, poses: [{ id: 'g1', transform: translation(0, 0), opacity: 1 }] },
      { frame: 10, poses: [{ id: 'g1', transform: translation(100, 0), opacity: 0 }] },
    ])
    const at5 = resolveLayerAt(l, 5)[0] as Group
    expect(tx(at5)).toBeCloseTo(50)
    expect(at5.opacity).toBeCloseTo(0.5)
    expect(tx(resolveLayerAt(l, 0)[0])).toBe(0)
    expect(tx(resolveLayerAt(l, 10)[0])).toBe(100)
  })

  it('TEXT: poseable like a container (presence + position tween)', () => {
    const txt: import('@flatkit/types').Text = { id: 'tx', kind: 'text', name: 't', transform: translation(0, 0), content: 'hi', font: 'a', size: 10, align: 'left', lineHeight: 1, color: '#000', box: { w: 40, h: 12 } }
    const l = layer([txt], [
      { frame: 0, tween: true, poses: [{ id: 'tx', transform: translation(0, 0) }] },
      { frame: 10, poses: [{ id: 'tx', transform: translation(100, 0) }] },
    ])
    expect(ids(resolveLayerAt(l, 0))).toEqual(['tx']) // text is resolved (present)
    expect(tx(resolveLayerAt(l, 5)[0])).toBeCloseTo(50) // its position interpolates
    expect((resolveLayerAt(l, 5)[0] as { content: string }).content).toBe('hi') // content carried
  })

  it('IMAGE: poseable (presence + position tween)', () => {
    const im: import('@flatkit/types').Image = { id: 'im', kind: 'image', name: 'i', transform: translation(0, 0), assetId: 'a1', w: 80, h: 60 }
    const l = layer([im], [
      { frame: 0, tween: true, poses: [{ id: 'im', transform: translation(0, 0) }] },
      { frame: 10, poses: [{ id: 'im', transform: translation(200, 0) }] },
    ])
    expect(ids(resolveLayerAt(l, 0))).toEqual(['im'])
    expect(tx(resolveLayerAt(l, 5)[0])).toBeCloseTo(100)
    expect((resolveLayerAt(l, 5)[0] as { assetId: string }).assetId).toBe('a1')
  })

  it('TWEEN with PIVOT: rotation turns around the container pivot (pivot fixed midway)', () => {
    const P = { x: 50, y: 0 }
    const g: Group = { id: 'g1', kind: 'group', name: 'g1', transform: IDENTITY, layers: [], pivot: P }
    const l = layer([g], [
      { frame: 0, tween: true, poses: [{ id: 'g1', transform: IDENTITY }] },
      // 90° rotation AROUND (50,0) → the pivot stays @ (50,0)
      { frame: 10, poses: [{ id: 'g1', transform: { a: 0, b: 1, c: -1, d: 0, e: 50, f: -50 } }] },
    ])
    const at5 = resolveLayerAt(l, 5)[0] as Group
    // the pivot (local 50,0) must stay at (50,0) throughout the in-place tween
    const px = at5.transform.a * P.x + at5.transform.c * P.y + at5.transform.e
    const py = at5.transform.b * P.x + at5.transform.d * P.y + at5.transform.f
    expect(px).toBeCloseTo(50)
    expect(py).toBeCloseTo(0)
    expect(decompose(at5.transform).rotation).toBeCloseTo(Math.PI / 4) // 45° midway
  })

  it('partial TWEEN: item present only in A → holds its pose (no interp toward nothing)', () => {
    const l = layer([group('g1'), group('g2')], [
      { frame: 0, tween: true, poses: [{ id: 'g1', transform: translation(0, 0) }, { id: 'g2', transform: translation(0, 0) }] },
      { frame: 10, poses: [{ id: 'g1', transform: translation(100, 0) }] }, // g2 absent from B
    ])
    const out = resolveLayerAt(l, 5)
    expect(tx(out.find((i) => i.id === 'g1')!)).toBeCloseTo(50) // g1 tweens
    expect(tx(out.find((i) => i.id === 'g2')!)).toBe(0) // g2 holds (present in A only)
  })

  it('TWEEN never interpolates the material (stop-motion HOLD even on a tweened span)', () => {
    const l = layer([group('g1')], [
      { frame: 0, tween: true, poses: [{ id: 'g1', transform: translation(0, 0) }], matter: [region('a')] },
      { frame: 10, poses: [{ id: 'g1', transform: translation(100, 0) }], matter: [region('b')] },
    ])
    const out = resolveLayerAt(l, 5)
    expect(ids(out)).toEqual(['a', 'g1']) // material = HOLD of `a`, not an a/b mix
    expect(tx(out[1])).toBeCloseTo(50) // the symbol, however, tweens
  })

  it('span easing applies to the tween (easeIn slows the start)', () => {
    const l = layer([group('g1')], [
      { frame: 0, tween: true, ease: 'easeIn', poses: [{ id: 'g1', transform: translation(0, 0) }] },
      { frame: 10, poses: [{ id: 'g1', transform: translation(100, 0) }] },
    ])
    expect(tx(resolveLayerAt(l, 5)[0])).toBeLessThan(50) // easeIn → behind at mid-course
  })

  it('container expressions take priority over the tween (x = constant evaluated)', () => {
    const g: Group = { ...group('g1'), expressions: { x: '42' } }
    const l = layer([g], [
      { frame: 0, tween: true, poses: [{ id: 'g1', transform: translation(0, 0) }] },
      { frame: 10, poses: [{ id: 'g1', transform: translation(100, 0) }] },
    ])
    expect(tx(resolveLayerAt(l, 5)[0])).toBeCloseTo(42) // the expression overrides x
  })

  it('`time` expression uses fps (frame/fps)', () => {
    const g: Group = { ...group('g1'), expressions: { x: 'time' } }
    const l = layer([g], [{ frame: 0, poses: [{ id: 'g1' }] }])
    expect(tx(resolveLayerAt(l, 24, { fps: 24 })[0])).toBeCloseTo(1) // 24/24 = 1s
    expect(tx(resolveLayerAt(l, 12, { fps: 24 })[0])).toBeCloseTo(0.5)
  })

  it('applies the pose to an instance (transform/opacity/tint) keeping its body', () => {
    const l = layer([inst('i1', 'SYM')], [
      { frame: 0, poses: [{ id: 'i1', transform: translation(7, 0), opacity: 0.3 }] },
    ])
    const out = resolveLayerAt(l, 0)[0] as Instance
    expect(out.symbolId).toBe('SYM') // body kept
    expect(tx(out)).toBe(7)
    expect(out.opacity).toBe(0.3)
  })

  it('a pose targeting an id absent from the roster is ignored (robustness)', () => {
    const l = layer([group('g1')], [{ frame: 0, poses: [{ id: 'ghost' }, { id: 'g1' }] }])
    expect(ids(resolveLayerAt(l, 0))).toEqual(['g1'])
  })

  it('unsorted cels: robust resolution (defensive sort)', () => {
    const l = layer([group('g1')], [
      { frame: 10, poses: [{ id: 'g1', transform: translation(100, 0) }] },
      { frame: 0, tween: true, poses: [{ id: 'g1', transform: translation(0, 0) }] },
    ])
    expect(tx(resolveLayerAt(l, 5)[0])).toBeCloseTo(50)
  })

  // guard: recompose(decompose) ≈ identity (sanity on the helpers used)
  it('sanity transform', () => {
    expect(decompose(recompose({ x: 3, y: 4, scaleX: 1, scaleY: 1, rotation: 0 })).x).toBeCloseTo(3)
  })
})

describe('cel — guide layer', () => {
  // Chevron guide: [0,0] → [50,-50] → [100,0]. Passed via opts.guide (comes from the guide layer).
  const guide = { subpaths: [{ closed: false, segments: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 50, y: -50 } }, { anchor: { x: 100, y: 0 } }] }] }
  const spanned = (): Layer => layer([group('g1')], [
    { frame: 0, tween: true, poses: [{ id: 'g1', transform: translation(0, 0) }] },
    { frame: 10, poses: [{ id: 'g1', transform: translation(100, 0) }] },
  ])

  it('position follows the path (pose projection, ≠ linear interpolation)', () => {
    // Poses (0,0)→t=0 and (100,0)→t=1; at mid-span t=0.5 = the chevron apex (50,-50).
    const m = (resolveLayerAt(spanned(), 5, { guide })[0] as Group).transform
    expect(m.e).toBeCloseTo(50, 2)
    expect(m.f).toBeCloseTo(-50, 2)
  })

  it('span endpoints = projections of the poses onto the guide', () => {
    const a = (resolveLayerAt(spanned(), 0, { guide })[0] as Group).transform
    const b = (resolveLayerAt(spanned(), 10, { guide })[0] as Group).transform
    expect(a.e).toBeCloseTo(0, 2)
    expect(a.f).toBeCloseTo(0, 2)
    expect(b.e).toBeCloseTo(100, 2)
    expect(b.f).toBeCloseTo(0, 2)
  })

  it('orient: rotation = the path tangent', () => {
    const m = (resolveLayerAt(spanned(), 2.5, { guide, orient: true })[0] as Group).transform // t=0.25, 1st branch, tangent −45°
    expect(m.a).toBeCloseTo(Math.SQRT1_2, 3)
    expect(m.b).toBeCloseTo(-Math.SQRT1_2, 3)
  })

  it('without orient: no rotation added', () => {
    const m = (resolveLayerAt(spanned(), 2.5, { guide })[0] as Group).transform
    expect(m.a).toBeCloseTo(1, 6)
    expect(m.b).toBeCloseTo(0, 6)
  })

  it('PING-PONG on the SAME guide: the return reprojects toward the start', () => {
    const l: Layer = layer([group('g1')], [
      { frame: 0, tween: true, poses: [{ id: 'g1', transform: translation(0, 0) }] },
      { frame: 10, tween: true, poses: [{ id: 'g1', transform: translation(100, 0) }] }, // middle
      { frame: 20, poses: [{ id: 'g1', transform: translation(0, 0) }] }, // back to the origin
    ])
    const mid = (resolveLayerAt(l, 10, { guide })[0] as Group).transform // middle = end of the guide
    expect(mid.e).toBeCloseTo(100, 2)
    expect(mid.f).toBeCloseTo(0, 2)
    // Return: at frame 15 (t=0.5 of the return span, from t=1 toward t=0) → apex (50,-50), same guide.
    const ret = (resolveLayerAt(l, 15, { guide })[0] as Group).transform
    expect(ret.e).toBeCloseTo(50, 2)
    expect(ret.f).toBeCloseTo(-50, 2)
  })

  it('without a guide (opts.guide absent): normal linear interpolation', () => {
    const m = (resolveLayerAt(spanned(), 5)[0] as Group).transform
    expect(m.e).toBeCloseTo(50, 4)
    expect(m.f).toBeCloseTo(0, 6) // straight line, not the apex
  })
})

describe('cel — filters', () => {
  it('resolves the pose filters (HOLD) and interpolates them over the tween', () => {
    const l: Layer = layer([group('g1')], [
      { frame: 0, tween: true, poses: [{ id: 'g1', transform: translation(0, 0), filters: [{ type: 'blur', radius: 0 }] }] },
      { frame: 10, poses: [{ id: 'g1', transform: translation(0, 0), filters: [{ type: 'blur', radius: 10 }] }] },
    ])
    const at0 = resolveLayerAt(l, 0)[0] as Group
    expect(at0.filters).toEqual([{ type: 'blur', radius: 0 }])
    const mid = resolveLayerAt(l, 5)[0] as Group
    expect((mid.filters![0] as { type: 'blur'; radius: number }).radius).toBeCloseTo(5)
  })

  it('pose without filters → resolved item without filters', () => {
    const l: Layer = layer([group('g1')], [{ frame: 0, poses: [{ id: 'g1', transform: IDENTITY }] }])
    expect((resolveLayerAt(l, 0)[0] as Group).filters).toBeUndefined()
  })
})

describe('cel — morph / shape tween', () => {
  const sq = (id: string, x: number, y: number, s: number): Region => ({ id, color: '#000', path: polygonsToPath([[{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }]]) })
  const rbbox = (r: Region) => { let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity; for (const sp of r.path.subpaths) for (const seg of sp.segments) { mnx = Math.min(mnx, seg.anchor.x); mxx = Math.max(mxx, seg.anchor.x); mny = Math.min(mny, seg.anchor.y); mxy = Math.max(mxy, seg.anchor.y) }; return { mnx, mny, mxx, mxy } }

  it('shapeTween: the shape interpolates A→B (square 10 → square 30)', () => {
    const l: Layer = layer([], [
      { frame: 0, shapeTween: true, poses: [], matter: [sq('a', 0, 0, 10)] },
      { frame: 10, poses: [], matter: [sq('a', 0, 0, 30)] },
    ])
    const at0 = resolveLayerAt(l, 0) as Region[]
    expect(rbbox(at0[0]).mxx).toBeCloseTo(10, 0)
    const mid = resolveLayerAt(l, 5) as Region[]
    expect(rbbox(mid[0]).mxx).toBeCloseTo(20, 0) // mid-morph: 10→30 ⇒ ~20
  })

  it('without shapeTween: HOLD (shape held, no morph)', () => {
    const l: Layer = layer([], [
      { frame: 0, poses: [], matter: [sq('a', 0, 0, 10)] },
      { frame: 10, poses: [], matter: [sq('a', 0, 0, 30)] },
    ])
    const mid = resolveLayerAt(l, 5) as Region[]
    expect(rbbox(mid[0]).mxx).toBeCloseTo(10, 0) // held = square of 10
  })

  it('different region counts → cross-fade (opacities)', () => {
    const l: Layer = layer([], [
      { frame: 0, shapeTween: true, poses: [], matter: [sq('a', 0, 0, 10)] },
      { frame: 10, poses: [], matter: [sq('b', 0, 0, 10), sq('c', 20, 0, 10)] },
    ])
    const mid = resolveLayerAt(l, 5) as Region[]
    expect(mid).toHaveLength(3) // 1 (A, fading out) + 2 (B, fading in)
    expect(mid[0].opacity).toBeCloseTo(0.5, 1)
  })
})

describe('cel — self in a channel binding', () => {
  it('self.x/y exposes the object\'s own channels (no mirror variable)', () => {
    const g: Group = { id: 'g', kind: 'group', name: 'g', transform: translation(10, 50), layers: [], expressions: { x: 'self.y' } }
    const out = resolveLayerAt(layer([g]), 0)
    expect(decompose((out[0] as Group).transform).x).toBe(50) // x ← self.y (= 50)
  })

  it('dynamic text: `bind` injects the formatted value at the {} slot', () => {
    const t = { id: 't', kind: 'text', name: 'T', transform: IDENTITY, content: 'v={}', font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.2, color: '#000', box: { w: 0, h: 0 }, bind: 'aDeg', decimals: 1 } as unknown as Layer['items'][number]
    const out = resolveLayerAt(layer([t]), 0, { ctx: { aDeg: 41.27 } })
    expect((out[0] as { content: string }).content).toBe('v=41.3')
  })

  it('dynamic text: without {} the content is the value alone; an invalid expression = literal', () => {
    const mk = (content: string, bind: string) => ({ id: 't', kind: 'text', name: 'T', transform: IDENTITY, content, font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.2, color: '#000', box: { w: 0, h: 0 }, bind } as unknown as Layer['items'][number])
    expect((resolveLayerAt(layer([mk('label', 'score')]), 0, { ctx: { score: 7 } })[0] as { content: string }).content).toBe('7')
    expect((resolveLayerAt(layer([mk('keep', '(((')]), 0, { ctx: {} })[0] as { content: string }).content).toBe('keep')
  })
})

describe('cel — pose patch semantics + rotate/scale sugar (degrees, around pivot)', () => {
  const gAt = (id: string, e: number, f: number, pivot?: { x: number; y: number }): Group =>
    ({ id, kind: 'group', name: id, transform: translation(e, f), layers: [], ...(pivot ? { pivot } : {}) })

  it('#2 partial pose inherits position: `pose opacity 0.5` keeps the body place', () => {
    const l = layer([gAt('g', 20, 30)], [{ frame: 0, poses: [{ id: 'g', opacity: 0.5 }] }])
    const out = resolveLayerAt(l, 0)
    expect(decompose((out[0] as Group).transform).x).toBeCloseTo(20, 5)
    expect(decompose((out[0] as Group).transform).y).toBeCloseTo(30, 5)
    expect(out[0].opacity).toBe(0.5)
  })

  it('#1 `rotate <deg>` rotates around the body pivot, keeping the pivot in place', () => {
    const piv = { x: 5, y: 5 }
    const l = layer([gAt('g', 100, 100, piv)], [{ frame: 0, poses: [{ id: 'g', rotate: 90 }] }])
    const t = (resolveLayerAt(l, 0)[0] as Group).transform
    expect(decompose(t).rotation).toBeCloseTo(Math.PI / 2, 5) // 90° in radians, written as degrees
    // pivot (5,5) maps to the same parent point as the resting transform: (105,105)
    expect(t.a * 5 + t.c * 5 + t.e).toBeCloseTo(105, 5)
    expect(t.b * 5 + t.d * 5 + t.f).toBeCloseTo(105, 5)
  })

  it('#1 `scale` overrides scale, `rotate` alone inherits the base scale', () => {
    const base: Group = { id: 'g', kind: 'group', name: 'g', transform: recompose({ x: 0, y: 0, scaleX: 3, scaleY: 3, rotation: 0 }), layers: [] }
    const scaled = resolveLayerAt(layer([base], [{ frame: 0, poses: [{ id: 'g', scaleX: 2, scaleY: 2 }] }]), 0)
    expect(decompose((scaled[0] as Group).transform).scaleX).toBeCloseTo(2, 5)
    const rotOnly = resolveLayerAt(layer([base], [{ frame: 0, poses: [{ id: 'g', rotate: 45 }] }]), 0)
    expect(decompose((rotOnly[0] as Group).transform).scaleX).toBeCloseTo(3, 5) // scale inherited from base
    expect(decompose((rotOnly[0] as Group).transform).rotation).toBeCloseTo(Math.PI / 4, 5)
  })

  it('#1 tween interpolates rotate 0 → 90 around the pivot', () => {
    const piv = { x: 0, y: 0 }
    const l = layer([gAt('g', 0, 0, piv)], [
      { frame: 0, poses: [{ id: 'g', rotate: 0 }], tween: true },
      { frame: 10, poses: [{ id: 'g', rotate: 90 }] },
    ])
    expect(decompose((resolveLayerAt(l, 5)[0] as Group).transform).rotation).toBeCloseTo(Math.PI / 4, 5)
  })

  it('explicit `at` on a pose still overrides the inherited position', () => {
    const l = layer([gAt('g', 20, 30)], [{ frame: 0, poses: [{ id: 'g', transform: translation(7, 8), rotate: 0 }] }])
    const d = decompose((resolveLayerAt(l, 0)[0] as Group).transform)
    expect([d.x, d.y]).toEqual([7, 8])
  })

  it('#3 explicit `rotate 0 → 360` is a FULL turn (linear in degrees, not a decomposed no-op)', () => {
    const l = layer([gAt('g', 0, 0)], [
      { frame: 0, poses: [{ id: 'g', rotate: 0 }], tween: true },
      { frame: 12, poses: [{ id: 'g', rotate: 360 }] },
    ])
    expect(decompose((resolveLayerAt(l, 3)[0] as Group).transform).rotation).toBeCloseTo(Math.PI / 2, 5) // 90°
    expect(decompose((resolveLayerAt(l, 6)[0] as Group).transform).rotation).toBeCloseTo(Math.PI, 5) // 180°
  })

  it('#3 explicit rotate keeps the long way (no shortest-arc snap): -172° → 172° passes through 0', () => {
    const l = layer([gAt('g', 0, 0)], [
      { frame: 0, poses: [{ id: 'g', rotate: -172 }], tween: true },
      { frame: 10, poses: [{ id: 'g', rotate: 172 }] },
    ])
    expect(decompose((resolveLayerAt(l, 5)[0] as Group).transform).rotation).toBeCloseTo(0, 5) // midpoint, not ±180
  })
})
