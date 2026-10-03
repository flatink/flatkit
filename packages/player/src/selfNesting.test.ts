import { describe, it, expect } from 'vitest'
import type { Doc, Instance, SymbolDef } from '@flatkit/types'
import { IDENTITY } from '@flatkit/engine/transform'
import { hitChains } from './hit'
import { containerBBox, pointInContainer } from '@flatkit/engine/groups'
import { namedChannels } from '@flatkit/engine/sceneRefs'

// The walks carry the set of symbols on their path (a symbol must not be entered inside itself).
// What it is FOR must hold: the nested copy of a self-containing symbol is
// skipped, and two SIBLING instances of the same symbol are both entered — the second must not find the
// mark the first left, which is what a set shared without removing would do.
const sq = { id: 'r', color: '#000000', path: { subpaths: [{ closed: true, segments: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }, { anchor: { x: 0, y: 10 } }] }] } }
const self: SymbolDef = { id: 'S', name: 'Self', layers: [{ id: 'sl', name: 'l', visible: true, locked: false, opacity: 1, items: [sq as never, { id: 'inner', kind: 'instance', name: 'Inner', transform: { ...IDENTITY, e: 20 }, symbolId: 'S' } as Instance] }] }
const inst = (id: string, x: number): Instance => ({ id, kind: 'instance', name: id, transform: { ...IDENTITY, e: x }, symbolId: 'S' })
const doc: Doc = { width: 400, height: 100, symbols: [self], layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [inst('A', 0), inst('B', 200)] }], timeline: { fps: 24, durationFrames: 1, tracks: [] } }

describe('walks under a self-containing symbol, with sibling instances of it', () => {
  it('the bounding box of each sibling is its own square: the nested copy is skipped, and it terminates', () => {
    expect(containerBBox(doc, doc.layers[0].items[0] as Instance)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 })
    expect(containerBBox(doc, doc.layers[0].items[1] as Instance)).toEqual({ minX: 200, minY: 0, maxX: 210, maxY: 10 })
  })
  it('a hit test reaches the FIRST sibling after walking the second (topmost is tried first)', () => {
    expect(hitChains(doc, 0, {} as never, { x: 5, y: 5 }, undefined, () => undefined)[0]).toEqual(['A', 'r'])
    expect(hitChains(doc, 0, {} as never, { x: 205, y: 5 }, undefined, () => undefined)[0]).toEqual(['B', 'r'])
    expect(hitChains(doc, 0, {} as never, { x: 225, y: 5 }, undefined, () => undefined)).toEqual([]) // the skipped copy is not there
  })
  it('pointInContainer and the named objects see both siblings', () => {
    expect(pointInContainer(doc, doc.layers[0].items[1] as Instance, { x: 205, y: 5 })).toBe(true)
    const named = namedChannels(doc, 0, undefined, 24)
    expect(Object.keys(named).sort()).toEqual(['A', 'B', 'Inner'])
  })
})
