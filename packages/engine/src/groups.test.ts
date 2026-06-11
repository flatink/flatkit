import { describe, it, expect } from 'vitest'
import type { Region, Group, Layer, Doc } from '@flatkit/types'
import { apply, IDENTITY, invert, compose, translation } from './transform'
import { containerBBox, groupFromRegions, pointInContainer, ungroup, dropZoneBounds } from './groups'
import { regionBBox } from './bbox'
import { polygonsToPath } from './path'

const emptyDoc: Doc = { width: 100, height: 100, layers: [], symbols: [] }

function rectRegion(id: string, x: number, y: number, w: number, h: number): Region {
  return {
    id,
    color: '#000',
    path: polygonsToPath([[{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]]),
  }
}

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
  it('groupFromRegions keeps coords (identity transform) and measures the box', () => {
    const g = groupFromRegions('G', [rectRegion('a', 0, 0, 50, 50)])
    expect(g.transform).toEqual(IDENTITY)
    expect(containerBBox(emptyDoc, g)).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 50 })
  })

  it('ungroup bakes the transform into the regions', () => {
    const g = groupFromRegions('G', [rectRegion('a', 0, 0, 50, 50)])
    g.transform = translation(100, 20)
    const items = ungroup(g)
    expect(items.length).toBe(1)
    expect(regionBBox(items[0] as Region)).toEqual({ minX: 100, minY: 20, maxX: 150, maxY: 70 })
  })

  it('pointInGroup accounts for the transform', () => {
    const g = groupFromRegions('G', [rectRegion('a', 0, 0, 50, 50)])
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
