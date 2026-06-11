import { describe, it, expect } from 'vitest'
import { pointInPolygons, pointNearPath, pathFollowsPolygons, hitChain, hitChains, hitContextAt } from './hit'
import { translation } from '@flatkit/engine/transform'
import { polygonsToPath } from '@flatkit/engine/path'
import type { Doc, Layer, Point, Region } from '@flatkit/types'

const square = (cx: number, cy: number, s: number) => [
  [
    { x: cx - s, y: cy - s },
    { x: cx + s, y: cy - s },
    { x: cx + s, y: cy + s },
    { x: cx - s, y: cy + s },
  ],
]
const region = (id: string, polys: Point[][]): Region => ({ id, color: '#fff', path: polygonsToPath(polys) })
const layerOf = (items: Layer['items']): Layer => ({ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items })

describe('pointInPolygons', () => {
  it('inside / outside of a square', () => {
    const sq = square(0, 0, 10)
    expect(pointInPolygons(sq, { x: 0, y: 0 })).toBe(true)
    expect(pointInPolygons(sq, { x: 20, y: 0 })).toBe(false)
  })
  it('hole (even-odd rule)', () => {
    const ringWithHole = [square(50, 50, 50)[0], square(50, 50, 20)[0]]
    expect(pointInPolygons(ringWithHole, { x: 50, y: 50 })).toBe(false) // in the hole
    expect(pointInPolygons(ringWithHole, { x: 10, y: 50 })).toBe(true) // in the fill
  })
})

describe('outline entity (noFill+stroke): hit by proximity to the stroke', () => {
  const outline = (id: string, polys: Point[][], width: number): Region => ({
    id, color: '#000', path: polygonsToPath(polys), noFill: true, stroke: { width, paint: { type: 'solid', color: '#000' } },
  })

  it('pointNearPath: true on the actual edge, false in the interior', () => {
    const p = polygonsToPath(square(0, 0, 10))
    expect(pointNearPath(p, { x: 10, y: 0 }, 3)).toBe(true) // on the right edge
    expect(pointNearPath(p, { x: 0, y: 0 }, 3)).toBe(false) // at the center (far from the stroke)
  })

  it('hitContextAt: the outline selects at the edge, not in the interior', () => {
    const doc = { width: 100, height: 100, symbols: [], layers: [] } as unknown as Doc
    const layer = layerOf([outline('o', square(50, 50, 20), 4)])
    expect(hitContextAt(doc, [layer], undefined, 0, { x: 70, y: 50 })?.item.id).toBe('o') // right edge (x=70)
    expect(hitContextAt(doc, [layer], undefined, 0, { x: 50, y: 50 })).toBeNull() // empty interior
  })

  it('a fill covers its interior (classic hit)', () => {
    const doc = { width: 100, height: 100, symbols: [], layers: [] } as unknown as Doc
    const layer = layerOf([region('f', square(50, 50, 20))])
    expect(hitContextAt(doc, [layer], undefined, 0, { x: 50, y: 50 })?.item.id).toBe('f')
  })

  it('pathFollowsPolygons: an outline running along the fill edge is "linked", a distant one is not', () => {
    const fillRings = square(50, 50, 20) // fill edge
    const sameOutline = polygonsToPath(square(50, 50, 20)) // same outline -> linked
    const elsewhere = polygonsToPath(square(90, 90, 5)) // elsewhere -> not linked (does not follow the edge)
    expect(pathFollowsPolygons(sameOutline, fillRings, 2)).toBe(true)
    expect(pathFollowsPolygons(elsewhere, fillRings, 2)).toBe(false)
  })
})

describe('hitChain', () => {
  const doc: Doc = { width: 500, height: 500, layers: [layerOf([region('r', square(100, 100, 30))])], symbols: [] }

  it('hits a region -> [id], otherwise []', () => {
    expect(hitChain(doc, 0, {}, { x: 100, y: 100 })).toEqual(['r'])
    expect(hitChain(doc, 0, {}, { x: 300, y: 300 })).toEqual([])
  })

  it('accounts for the animated pose (cel)', () => {
    const g = { id: 'g', kind: 'group' as const, name: 'g', transform: translation(0, 0), layers: [layerOf([region('gr', square(0, 0, 25))])] }
    const L: Layer = { ...layerOf([g]), cels: [{ frame: 0, poses: [{ id: 'g', transform: translation(200, 0) }] }] }
    const animated: Doc = { width: 500, height: 500, layers: [L], symbols: [] }
    expect(hitChain(animated, 0, {}, { x: 200, y: 0 })).toEqual(['g', 'gr']) // posed +200
    expect(hitChain(animated, 0, {}, { x: 0, y: 0 })).toEqual([]) // no longer at the base
  })

  it('returns the container -> deep item chain', () => {
    const grp = {
      id: 'g',
      kind: 'group' as const,
      name: 'g',
      transform: translation(300, 300),
      layers: [layerOf([region('gr', square(0, 0, 25))])],
    }
    const d: Doc = { width: 600, height: 600, layers: [layerOf([grp])], symbols: [] }
    expect(hitChain(d, 0, {}, { x: 300, y: 300 })).toEqual(['g', 'gr'])
    expect(hitChain(d, 0, {}, { x: 100, y: 100 })).toEqual([])
  })

  it('nested animated item: both the parent AND child transforms count', () => {
    // group at (300,300); inside it a nested animated sub-group offset by +50 in x.
    const inner = {
      id: 'inner',
      kind: 'group' as const,
      name: 'inner',
      transform: translation(0, 0),
      layers: [layerOf([region('ir', square(0, 0, 20))])],
    }
    // the `outer` layer animates `inner` by +50 in x via a cel
    const outerLayer: Layer = { ...layerOf([inner]), cels: [{ frame: 0, poses: [{ id: 'inner', transform: translation(50, 0) }] }] }
    const outer = { id: 'outer', kind: 'group' as const, name: 'outer', transform: translation(300, 300), layers: [outerLayer] }
    const d: Doc = { width: 700, height: 700, layers: [layerOf([outer])], symbols: [] }
    expect(hitChain(d, 0, {}, { x: 350, y: 300 })).toEqual(['outer', 'inner', 'ir']) // 300+50
    expect(hitChain(d, 0, {}, { x: 300, y: 300 })).toEqual([]) // base position (without the animation)
  })
})

describe('hitChains -- all chains in Z order (fall-through)', () => {
  it('two overlapping regions -> both chains, from TOPMOST to bottom', () => {
    // 'bottom' drawn first, 'top' next (so above it). Both cover (100,100).
    const doc: Doc = {
      width: 300, height: 300, symbols: [],
      layers: [layerOf([region('bottom', square(100, 100, 40)), region('top', square(100, 100, 40))])],
    }
    expect(hitChains(doc, 0, {}, { x: 100, y: 100 })).toEqual([['top'], ['bottom']]) // topmost first
    expect(hitChains(doc, 0, {}, { x: 250, y: 250 })).toEqual([])
  })

  it('the click "falls" through a top item down to the clickable one beneath', () => {
    // 'under' has a click handler; 'over' (above, no handler) covers it.
    const doc: Doc = {
      width: 300, height: 300, symbols: [],
      layers: [layerOf([region('under', square(100, 100, 40)), region('over', square(100, 100, 40))])],
      interactions: [{ id: 'i', targetId: 'under', event: 'click', actions: [] }],
    }
    const chains = hitChains(doc, 0, {}, { x: 100, y: 100 })
    // Resolution "first item (Z order) that has a handler": 'over' is ignored, 'under' wins.
    const target = chains.flat().find((id) => doc.interactions!.some((x) => x.targetId === id && x.event === 'click'))
    expect(target).toBe('under')
  })
})

describe('noHit -- non-interactive item (click/hover pass through, stays visible)', () => {
  const sq = square(100, 100, 40)
  it('hitChains ignores a noHit item -> the click lands on the one beneath', () => {
    const doc: Doc = {
      width: 300, height: 300, symbols: [],
      layers: [layerOf([region('under', sq), { ...region('veil', sq), noHit: true }])], // 'veil' on top
    }
    expect(hitChains(doc, 0, {}, { x: 100, y: 100 })).toEqual([['under']]) // 'veil' ignored
  })
  it('a lone noHit veil -> no chain (click passes through)', () => {
    const doc: Doc = { width: 300, height: 300, symbols: [], layers: [layerOf([{ ...region('veil', sq), noHit: true }])] }
    expect(hitChains(doc, 0, {}, { x: 100, y: 100 })).toEqual([])
  })
  it('a noHit container short-circuits its whole subtree', () => {
    const grp = { id: 'g', kind: 'group' as const, name: 'g', transform: translation(0, 0), layers: [layerOf([region('gr', sq)])], noHit: true }
    const doc: Doc = { width: 300, height: 300, symbols: [], layers: [layerOf([grp])] }
    expect(hitChains(doc, 0, {}, { x: 100, y: 100 })).toEqual([])
  })
  it('covers the back: the editor ALWAYS selects a noHit item on click (hitContextAt unchanged)', () => {
    const doc: Doc = { width: 300, height: 300, symbols: [], layers: [layerOf([{ ...region('veil', sq), noHit: true }])] }
    expect(hitContextAt(doc, doc.layers, undefined, 0, { x: 100, y: 100 })?.item.id).toBe('veil')
  })
})

describe('hitContextAt -- frame-aware editor selection', () => {
  const grp = (id: string, tx: number) => ({
    id,
    kind: 'group' as const,
    name: id,
    transform: translation(tx, 0),
    layers: [layerOf([region(id + 'r', square(0, 0, 25))])],
  })

  it('selects the item at its ANIMATED pose, not at its base', () => {
    const g = grp('g', 0) // base at x=0
    const L: Layer = {
      ...layerOf([g]),
      cels: [
        { frame: 0, tween: true, poses: [{ id: 'g', transform: translation(0, 0) }] },
        { frame: 30, poses: [{ id: 'g', transform: translation(200, 0) }] },
      ],
    }
    const layers = [L]
    const doc: Doc = { width: 600, height: 600, layers, symbols: [] }
    // At frame 30, the group is offset by +200 -> we hit it at (200,0), no longer at (0,0).
    expect(hitContextAt(doc, layers, undefined, 30, { x: 200, y: 0 })?.item.id).toBe('g')
    expect(hitContextAt(doc, layers, undefined, 30, { x: 0, y: 0 })).toBeNull()
    // At frame 0, the opposite.
    expect(hitContextAt(doc, layers, undefined, 0, { x: 0, y: 0 })?.item.id).toBe('g')
  })

  it('ignores locked layers', () => {
    const g = grp('g', 0)
    const layers: Layer[] = [{ id: 'L', name: 'c', visible: true, locked: true, opacity: 1, items: [g] }]
    const doc: Doc = { width: 600, height: 600, layers, symbols: [] }
    expect(hitContextAt(doc, layers, undefined, 0, { x: 0, y: 0 })).toBeNull()
  })
})
