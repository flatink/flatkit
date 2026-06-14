import { describe, it, expect } from 'vitest'
import type { Region, Group, Layer, Doc } from '@flatkit/types'
import { apply, IDENTITY, invert, compose, translation } from './transform'
import { containerBBox, pointInContainer, dropZoneBounds } from './groups'
import { polygonsToPath } from './path'

const emptyDoc: Doc = { width: 100, height: 100, layers: [], symbols: [] }

function rectRegion(id: string, x: number, y: number, w: number, h: number): Region {
  return {
    id,
    color: '#000',
    path: polygonsToPath([[{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]]),
  }
}

/** Plain group fixture (one-off group from regions) — groupFromRegions itself lives in @flatink/core now. */
const plainGroup = (regions: Region[]): Group => ({ id: 'g', kind: 'group', name: 'G', transform: IDENTITY, layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: regions }] })

describe('transform (matrix)', () => {
  it('apply and invert are reciprocal', () => {
    const t = { a: 0.8, b: 0.6, c: -0.3, d: 0.9, e: 5, f: -2 }
    const p = { x: 12, y: 8 }
    const back = apply(invert(t), apply(t, p))
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  })

  it('compose chains two translations', () => {
    const c = compose(translation(10, 5), translation(3, 2))
    expect(apply(c, { x: 0, y: 0 })).toEqual({ x: 13, y: 7 })
  })
})

describe('groups', () => {
  it('pointInGroup accounts for the transform', () => {
    const g = plainGroup([rectRegion('a', 0, 0, 50, 50)])
    g.transform = translation(100, 0)
    expect(pointInContainer(emptyDoc, g, { x: 120, y: 25 })).toBe(true) // inside the moved rect
    expect(pointInContainer(emptyDoc, g, { x: 20, y: 25 })).toBe(false) // at the old position
  })

  // Regression: the selection box drifted for a symbol whose INTERNAL matter
  // lives in cels (not in layer.items). containerBBox must resolve via resolveLayerAt.
  it('containerBBox encloses the internal matter stored in the cels (cel model)', () => {
    const doc: Doc = {
      width: 800,
      height: 600,
      layers: [],
      symbols: [
        {
          id: 'sym',
          name: 'P',
          // cel-based layer: items empty (roster), matter in cel 0
          layers: [
            {
              id: 'sl',
              name: 'c',
              visible: true,
              locked: false,
              opacity: 1,
              items: [],
              cels: [{ frame: 0, poses: [], matter: [rectRegion('inner', -40, -40, 80, 80)] }],
            },
          ],
        },
      ],
    }
    const inst = { id: 'i', kind: 'instance' as const, name: 'P', symbolId: 'sym', transform: translation(300, 250) }
    // local matter [-40,-40]..[40,40] moved by (300,250) → [260,210]..[340,290]
    expect(containerBBox(doc, inst)).toEqual({ minX: 260, minY: 210, maxX: 340, maxY: 290 })
  })

  // Editor static state preview: the frozen (default) bbox of a state-driven instance reflects its
  // SELECTED state's frame, not frame 0 — so the selection box matches the rendered/clicked shape.
  it('containerBBox of a state-driven instance freezes at the selected state frame', () => {
    const panel = (): Group => ({ id: 'panel', kind: 'group', name: 'Panel', transform: IDENTITY, layers: [{ id: 'pl', name: 'c', visible: true, locked: false, opacity: 1, items: [rectRegion('r', -10, -10, 20, 20)] }] })
    const doc: Doc = {
      width: 200, height: 200, layers: [], symbols: [{
        id: 'door', name: 'Door',
        states: [{ param: 'door', states: [{ name: 'closed', frame: 0 }, { name: 'open', frame: 10 }], initial: 'closed' }],
        layers: [{
          id: 'sl', name: 'c', visible: true, locked: false, opacity: 1, items: [panel()],
          cels: [
            { frame: 0, tween: true, poses: [{ id: 'panel', transform: translation(0, 0) }] },
            { frame: 10, poses: [{ id: 'panel', transform: translation(100, 0) }] },
          ],
        }],
      }],
    }
    const inst = (params?: Record<string, string>) => ({ id: 'i', kind: 'instance' as const, name: 'Door', symbolId: 'door', transform: IDENTITY, ...(params ? { params } : {}) })
    // closed (initial) → frame 0 → panel at x=0 → rect [-10,-10]..[10,10]
    expect(containerBBox(doc, inst())).toEqual({ minX: -10, minY: -10, maxX: 10, maxY: 10 })
    // open (call-site) → frame 10 → panel at x=100 → rect [90,-10]..[110,10]
    expect(containerBBox(doc, inst({ door: 'open' }))).toEqual({ minX: 90, minY: -10, maxX: 110, maxY: 10 })
  })
})

describe('dropZoneBounds (drop zone)', () => {
  const mkGroup = (hitbox?: { w: number; h: number }): Group => ({
    id: 'Zone', kind: 'group', name: 'Zone', transform: translation(50, 50),
    layers: [{ id: 'c', name: 'c', visible: true, locked: false, opacity: 1, items: [rectRegion('r', 0, 0, 10, 10)] } as Layer],
    ...(hitbox ? { hitbox } : {}),
  })
  const doc = (g: Group): Doc => ({ width: 100, height: 100, symbols: [], layers: [{ id: 'L', name: 'L', visible: true, locked: false, opacity: 1, items: [g] }] })

  it('hitbox present → rect centered on the group origin (±w/2 × ±h/2), in world', () => {
    expect(dropZoneBounds(doc(mkGroup({ w: 80, h: 60 })), 'Zone')).toEqual({ minX: 10, minY: 20, maxX: 90, maxY: 80 })
  })
  it('no hitbox → content bbox (like itemBoundsByName)', () => {
    // local content [0,0]..[10,10] moved by (50,50) → [50,50]..[60,60]
    expect(dropZoneBounds(doc(mkGroup()), 'Zone')).toEqual({ minX: 50, minY: 50, maxX: 60, maxY: 60 })
  })
})
