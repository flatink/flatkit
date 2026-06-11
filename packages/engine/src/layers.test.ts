import { describe, it, expect } from 'vitest'
import type { Doc, Group, Region } from '@flatkit/types'
import type { Item, Layer } from '@flatkit/types'
import { contextLayers, groupsOf, isGroup, isRegion, hiddenLayerIds, maskMap } from './layers'
import { IDENTITY } from './transform'
import { polygonsToPath } from './path'

// NOTE: the authoring/outliner helpers (regionsOf, segmentRows, layerRowsTopDown, setContextLayers,
// makeFolder, makeLayer, getLayer, sceneRootLayers, totalRegions, move/reorder, symbolDependsOn, …)
// moved to @flatink/core (editor-only); their tests live in packages/core/src/engine/layersEdit.test.ts.
// Here we keep the RUNTIME navigation helpers the player/compiler rely on (a local makeLayer fixture).

const region = (id: string): Region => ({ id, color: '#000', path: polygonsToPath([[{ x: 0, y: 0 }]]) })
const regionsIn = (layer: { items: Item[] }) => layer.items.filter(isRegion)
const makeLayer = (name: string, items: Item[] = []): Layer => ({ id: name, name, visible: true, locked: false, opacity: 1, items })

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

describe('layers — runtime navigation', () => {
  it('groupsOf splits the content (groups vs matter)', () => {
    const layer = doc().layers[0]
    expect(regionsIn(layer).map((r) => r.id)).toEqual(['r1'])
    expect(groupsOf(layer).map((g) => g.id)).toEqual(['g1'])
    expect(isGroup(groupsOf(layer)[0])).toBe(true)
  })

  it('contextLayers enters a group', () => {
    const d = doc()
    const inner = contextLayers(d, intoG1)
    expect(inner.length).toBe(1)
    expect(regionsIn(inner[0]).map((r) => r.id)).toEqual(['r2', 'r3'])
  })

  it('hiddenLayerIds: a hidden folder hides its children (inherited visibility)', () => {
    const folder = { ...makeLayer('F'), id: 'F', isFolder: true }
    const a = { ...makeLayer('A'), id: 'A', parent: 'F' }
    const b = { ...makeLayer('B'), id: 'B' }
    const layers = [b, a, folder]
    expect(hiddenLayerIds([b, a, { ...folder, visible: false }]).has('A')).toBe(true)
    expect(hiddenLayerIds([b, a, { ...folder, visible: false }]).has('B')).toBe(false)
    expect(hiddenLayerIds(layers).has('A')).toBe(false)
  })

  it('maskMap: a mask layer (container) clips its CHILD layers', () => {
    const mask = { ...makeLayer('mask'), id: 'mask', isMask: true }
    const child = { ...makeLayer('child'), id: 'child', parent: 'mask' }
    const other = { ...makeLayer('other'), id: 'other' }
    const m = maskMap([child, mask, other])
    expect(m.get('child')?.id).toBe('mask')
    expect(m.has('other')).toBe(false) // not a child of the mask → not clipped
    expect(maskMap([child, { ...mask, maskOff: true }, other]).has('child')).toBe(false)
  })
})
