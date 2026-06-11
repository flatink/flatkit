import { describe, it, expect } from 'vitest'
import type { Doc, Group, Region } from '@flatkit/types'
import {
  contextLayers,
  flattenRows,
  groupsOf,
  isGroup,
  makeLayer,
  makeFolder,
  moveLayerIn,
  reorderLayersIn,
  hiddenLayerIds,
  layerRowsTopDown,
  maskMap,
  regionsOf,
  segmentRows,
  setActiveRegions,
  setContextLayers,
  symbolDependsOn,
  totalRegions,
} from './layers'
import { IDENTITY } from './transform'
import { polygonsToPath } from './path'

const region = (id: string): Region => ({ id, color: '#000', path: polygonsToPath([[{ x: 0, y: 0 }]]) })

function makeGroup(id: string, regions: Region[]): Group {
  return { id, kind: 'group', name: id, transform: IDENTITY, layers: [makeLayer('inner', regions)] }
}

function doc(): Doc {
  return {
    width: 100,
    height: 100,
    layers: [
      makeLayer('A', [region('r1'), makeGroup('g1', [region('r2'), region('r3')])]),
      makeLayer('B', [region('r4')]),
    ],
    symbols: [],
  }
}

const intoG1: import('@flatkit/types').EditFrame[] = [{ kind: 'group', id: 'g1', name: 'g1' }]

describe('layers/items', () => {
  it('regionsOf and groupsOf split the content', () => {
    const layer = doc().layers[0]
    expect(regionsOf(layer).map((r) => r.id)).toEqual(['r1'])
    expect(groupsOf(layer).map((g) => g.id)).toEqual(['g1'])
    expect(isGroup(groupsOf(layer)[0])).toBe(true)
  })

  it('totalRegions counts recursively (groups included)', () => {
    expect(totalRegions(doc())).toBe(4) // r1, r2, r3, r4
  })

  it('moveLayerIn reorders', () => {
    const layers = doc().layers
    expect(moveLayerIn(layers, layers[0].id, 1).map((l) => l.name)).toEqual(['B', 'A'])
  })

  it('folders: hiddenLayerIds (inherited visibility) + layerRowsTopDown (tree)', () => {
    const folder = { ...makeFolder('F'), id: 'F' }
    const a = { ...makeLayer('A'), id: 'A', parent: 'F' }
    const b = { ...makeLayer('B'), id: 'B' }
    const layers = [b, a, folder] // array order (bottom→top)

    // top-down tree: folder F (expanded) then its indented child A, then B at the root
    expect(layerRowsTopDown(layers).map((n) => `${n.layer.id}@${n.depth}`)).toEqual(['F@0', 'A@1', 'B@0'])

    // hidden folder → the child is hidden too
    const hiddenF = [b, a, { ...folder, visible: false }]
    expect(hiddenLayerIds(hiddenF).has('A')).toBe(true)
    expect(hiddenLayerIds(hiddenF).has('B')).toBe(false)
    // visible folder → visible child
    expect(hiddenLayerIds(layers).has('A')).toBe(false)

    // collapsed folder → children excluded from the display
    const collapsed = [b, a, { ...folder, collapsed: true }]
    expect(layerRowsTopDown(collapsed).map((n) => n.layer.id)).toEqual(['F', 'B'])
  })

  it('maskMap: a mask layer (container) clips its CHILD layers', () => {
    const mask = { ...makeLayer('mask'), id: 'mask', isMask: true }
    const child = { ...makeLayer('child'), id: 'child', parent: 'mask' }
    const other = { ...makeLayer('other'), id: 'other' }
    const m = maskMap([child, mask, other])
    expect(m.get('child')?.id).toBe('mask')
    expect(m.has('other')).toBe(false) // not a child of the mask → not clipped
    // disabled mask (maskOff) → no clipping
    expect(maskMap([child, { ...mask, maskOff: true }, other]).has('child')).toBe(false)
  })

  it('reorderLayersIn reorders by a list of ids', () => {
    const layers = doc().layers
    const [a, b] = layers
    expect(reorderLayersIn(layers, [b.id, a.id]).map((l) => l.name)).toEqual(['B', 'A'])
    // Invalid list (size or id) → unchanged
    expect(reorderLayersIn(layers, [a.id])).toBe(layers)
    expect(reorderLayersIn(layers, [a.id, 'nope']).map((l) => l.name)).toEqual(['A', 'B'])
  })

  it('contextLayers enters a group', () => {
    const d = doc()
    const inner = contextLayers(d, intoG1)
    expect(inner.length).toBe(1)
    expect(regionsOf(inner[0]).map((r) => r.id)).toEqual(['r2', 'r3'])
  })

  it('setContextLayers updates a group\'s inner layers (immutable)', () => {
    const d = doc()
    const inner = contextLayers(d, intoG1)
    const d2 = setContextLayers(d, intoG1, [{ ...inner[0], name: 'changed' }])
    expect(d2).not.toBe(d)
    expect(contextLayers(d2, intoG1)[0].name).toBe('changed')
    expect(d.layers[1]).toBe(d2.layers[1]) // untouched root layer kept
  })

  it('setActiveRegions preserves the layer\'s groups', () => {
    const d = doc()
    const d2 = setActiveRegions(d, [], d.layers[0].id, [region('r9')])
    const layer = d2.layers[0]
    expect(regionsOf(layer).map((r) => r.id)).toEqual(['r9'])
    expect(groupsOf(layer).map((g) => g.id)).toEqual(['g1']) // group kept
  })

  // Regression: painting (setActiveRegions) must NOT remove text/image from the layer.
  it('setActiveRegions preserves text AND image (poseables)', () => {
    const txt = { id: 't1', kind: 'text' as const, name: 't', transform: IDENTITY, content: 'x', font: 'a', size: 10, align: 'left' as const, lineHeight: 1, color: '#000', box: { w: 10, h: 10 } }
    const img = { id: 'i1', kind: 'image' as const, name: 'i', transform: IDENTITY, assetId: 'a', w: 20, h: 20 }
    const d: Doc = { width: 100, height: 100, symbols: [], layers: [{ id: 'L', name: 'L', visible: true, locked: false, opacity: 1, items: [region('r0'), txt, img] }] }
    const d2 = setActiveRegions(d, [], 'L', [region('r9')])
    const ids = d2.layers[0].items.map((it) => it.id)
    expect(ids).toContain('t1')
    expect(ids).toContain('i1')
    expect(ids).toContain('r9')
    expect(ids).not.toContain('r0') // old region replaced
  })
})

describe('segmentRows / flattenRows (outliner & reordering)', () => {
  it('groups contiguous material and lists the containers', () => {
    const items = [region('r1'), region('r2'), makeGroup('g1', [region('x')]), makeGroup('g2', [region('y')])]
    const rows = segmentRows(items)
    expect(rows.map((r) => r.kind)).toEqual(['matter', 'item', 'item'])
    expect(rows[0].kind === 'matter' && rows[0].items.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(flattenRows(rows).map((it) => it.id)).toEqual(['r1', 'r2', 'g1', 'g2'])
  })

  it('handles non-contiguous material (between two containers)', () => {
    const items = [makeGroup('g1', [region('x')]), region('r1'), makeGroup('g2', [region('y')])]
    const rows = segmentRows(items)
    expect(rows.map((r) => r.kind)).toEqual(['item', 'matter', 'item'])
    // swapping the material up (dir +1) then re-flattening keeps the ids
    ;[rows[1], rows[2]] = [rows[2], rows[1]]
    expect(flattenRows(rows).map((it) => it.id)).toEqual(['g1', 'g2', 'r1'])
  })
})

describe('symbolDependsOn (cycle guard)', () => {
  const inst = (symbolId: string) => ({ id: 'i', kind: 'instance' as const, name: '', transform: IDENTITY, symbolId })
  const symbolsDoc: Doc = {
    width: 100,
    height: 100,
    layers: [],
    symbols: [
      { id: 'S1', name: 'S1', layers: [makeLayer('l', [inst('S2')])] }, // S1 contains S2
      { id: 'S2', name: 'S2', layers: [makeLayer('l', [region('r')])] },
    ],
  }

  it('detects direct dependencies and self', () => {
    expect(symbolDependsOn(symbolsDoc, 'S1', 'S2')).toBe(true) // placing S1 inside S2 -> cycle
    expect(symbolDependsOn(symbolsDoc, 'S2', 'S1')).toBe(false)
    expect(symbolDependsOn(symbolsDoc, 'S1', 'S1')).toBe(true) // inside itself
  })

  it('does not loop even if a cycle already exists in the data', () => {
    const cyclic: Doc = {
      ...symbolsDoc,
      symbols: [
        { id: 'A', name: 'A', layers: [makeLayer('l', [inst('B')])] },
        { id: 'B', name: 'B', layers: [makeLayer('l', [inst('A')])] }, // A<->B
      ],
    }
    expect(symbolDependsOn(cyclic, 'A', 'B')).toBe(true)
    expect(symbolDependsOn(cyclic, 'A', 'X')).toBe(false) // terminates (no infinite loop)
  })
})
