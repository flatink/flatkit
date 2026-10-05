import { describe, it, expect } from 'vitest'
import type { Doc, Group, Layer } from '@flatkit/types'
import { sanitizeDoc, compactDoc } from './validateDoc'

// flatink/flatink#62 — a `.flatpack` wrote every field at its default value (identity transforms, visible,
// locked, opacity 1, pivot 0,0): about 10% of a heavy document. They can only be left out if every reader
// puts them back, and some code read a missing `visible` as HIDDEN. So: the defaults are set once, when a
// document comes in (`sanitizeDoc`), and `compactDoc` leaves out exactly what that restores.
const I = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
const full = (): Doc => ({
  width: 100, height: 100,
  layers: [
    { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [
      { id: 'g', kind: 'group', name: 'G', transform: { ...I }, pivot: { x: 0, y: 0 }, opacity: 1, layers: [
        { id: 'L2', name: 'in', visible: true, locked: false, opacity: 1, items: [{ id: 'r', color: '#f00', path: { subpaths: [] } }] },
      ] } as Group,
      { id: 'm', kind: 'group', name: 'Moved', transform: { ...I, e: 5 }, pivot: { x: 2, y: 0 }, opacity: 0.5, layers: [] } as Group,
    ] },
    { id: 'H', name: 'hidden', visible: false, locked: true, opacity: 0.3, items: [] },
  ],
  symbols: [{ id: 's', name: 'S', layers: [{ id: 'SL', name: 'a', visible: true, locked: false, opacity: 1, items: [] }] }],
})

describe('document defaults — set on the way in, left out on the way out', () => {
  it('compactDoc drops exactly the default-valued fields, and keeps every other one', () => {
    const c = compactDoc(full())
    const [l0, l1] = c.layers as Array<Partial<Layer>>
    expect(l0).not.toHaveProperty('visible')
    expect(l0).not.toHaveProperty('locked')
    expect(l0).not.toHaveProperty('opacity')
    expect(l1).toMatchObject({ visible: false, locked: true, opacity: 0.3 }) // not defaults: kept
    const [g, m] = l0.items as Array<Partial<Group>>
    expect(g).not.toHaveProperty('transform')
    expect(g).not.toHaveProperty('pivot')
    expect(g).not.toHaveProperty('opacity')
    expect(m).toMatchObject({ transform: { ...I, e: 5 }, pivot: { x: 2, y: 0 }, opacity: 0.5 })
    expect(c.symbols[0].layers[0]).not.toHaveProperty('visible')
    expect(JSON.stringify(c).length).toBeLessThan(JSON.stringify(full()).length * 0.75)
  })

  it('sanitizeDoc puts back the ones every reader needs — a missing `visible` is NOT hidden', () => {
    const back = sanitizeDoc(JSON.parse(JSON.stringify(compactDoc(full()))))
    const want = full()
    // Layers: visible / locked / opacity; containers and leaves: transform. `pivot` and an item's `opacity`
    // are optional in the model (absent = origin / 1) and stay absent.
    expect(back.layers[0]).toMatchObject({ visible: true, locked: false, opacity: 1 })
    expect(back.layers[1]).toMatchObject({ visible: false, locked: true, opacity: 0.3 })
    expect((back.layers[0].items[0] as Group).transform).toEqual(I)
    expect((back.layers[0].items[0] as Group).layers[0]).toMatchObject({ visible: true, locked: false, opacity: 1 })
    expect(back.symbols[0].layers[0]).toMatchObject({ visible: true, locked: false, opacity: 1 })
    expect((back.layers[0].items[1] as Group).transform).toEqual((want.layers[0].items[1] as Group).transform)
  })

  it('sanitizeDoc does not touch the object it was handed', () => {
    const c = compactDoc(full())
    const before = JSON.stringify(c)
    sanitizeDoc(c)
    expect(JSON.stringify(c)).toBe(before)
  })

  it('a full document comes through unchanged', () => {
    expect(sanitizeDoc(full()).layers).toEqual(full().layers)
  })
})
