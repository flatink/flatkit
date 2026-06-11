import { describe, it, expect } from 'vitest'
import { namedChannels, objectNames, objectChannelsById } from './sceneRefs'
import { compileExpr, evalExpr } from './expr'
import { IDENTITY } from './transform'
import type { Doc, Group, Layer, Text } from '@flatkit/types'

// ── Helpers ──────────────────────────────────────────────────────────────
const tr = (e: number, f: number) => ({ ...IDENTITY, e, f })
const group = (name: string, e: number, f: number, layers: Layer[] = [], opacity?: number): Group => ({ id: name, kind: 'group', name, transform: tr(e, f), layers, ...(opacity !== undefined ? { opacity } : {}) })
const text = (name: string, e: number, f: number): Text => ({ id: name, kind: 'text', name, transform: tr(e, f), content: '', font: 'sans-serif', size: 12, align: 'left', lineHeight: 1.2, color: '#000', box: { w: 10, h: 10 } })
const layer = (items: Layer['items']): Layer => ({ id: 'L', name: 'L', visible: true, locked: false, opacity: 1, items })
const doc = (layers: Layer[]): Doc => ({ width: 800, height: 600, layers, symbols: [] })

describe('sceneRefs — namedChannels', () => {
  it('exposes the world position of a named object', () => {
    const d = doc([layer([group('Hero', 100, 50)])])
    const n = namedChannels(d, 0, undefined, 24)
    expect(n.Hero).toMatchObject({ x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 })
  })

  it('composes the parent→child transforms (world coords)', () => {
    const inner = group('Inner', 100, 50)
    const d = doc([layer([group('Outer', 10, 20, [layer([inner])])])])
    const n = namedChannels(d, 0, undefined, 24)
    expect(n.Outer).toMatchObject({ x: 10, y: 20 })
    expect(n.Inner).toMatchObject({ x: 110, y: 70 }) // 10+100, 20+50
  })

  it('lifts the opacity and covers all poseable types (text)', () => {
    const d = doc([layer([group('Faded', 0, 0, [], 0.3), text('Label', 5, 7)])])
    const n = namedChannels(d, 0, undefined, 24)
    expect(n.Faded.opacity).toBe(0.3)
    expect(n.Label).toMatchObject({ x: 5, y: 7 })
  })

  it('first name carrier wins (deterministic)', () => {
    const d = doc([layer([group('Dup', 1, 1), group('Dup', 9, 9)])])
    expect(namedChannels(d, 0, undefined, 24).Dup).toMatchObject({ x: 1, y: 1 })
  })

  it('evaluates via member access in an expression (Hero.x + 10)', () => {
    const d = doc([layer([group('Hero', 100, 50)])])
    const ctx = namedChannels(d, 0, undefined, 24)
    const c = compileExpr('Hero.x + Hero.y')
    expect(c.ok && evalExpr(c.node, ctx)).toBe(150)
  })

  it('hidden layer is ignored', () => {
    const hidden: Layer = { ...layer([group('Ghost', 1, 1)]), visible: false }
    expect(namedChannels(doc([hidden]), 0, undefined, 24).Ghost).toBeUndefined()
  })
})

describe('sceneRefs — binding conversion (nested object)', () => {
  it('toLocalX in a nested object binding converts world→local', () => {
    const child: Group = { id: 'Child', kind: 'group', name: 'Child', transform: IDENTITY, layers: [], expressions: { x: 'toLocalX(160, 0)' } }
    const parent: Group = { id: 'Parent', kind: 'group', name: 'Parent', transform: tr(50, 0), layers: [layer([child])] }
    const d = doc([layer([parent])])
    // x = toLocalX(160,0) relative to the parent (50,0) → local 110 → world 50+110 = 160.
    expect(namedChannels(d, 0, undefined, 24).Child.x).toBeCloseTo(160)
  })
})

describe('sceneRefs — objectChannelsById', () => {
  it('resolves an object channels by its id (for self in handlers)', () => {
    const d = doc([layer([group('Hero', 100, 50), group('Enemy', 400, 200)])])
    expect(objectChannelsById(d, 'Enemy', 0, undefined, 24)).toMatchObject({ x: 400, y: 200 })
    expect(objectChannelsById(d, 'absent', 0, undefined, 24)).toBeUndefined()
  })
})

describe('sceneRefs — objectNames', () => {
  it('collects the names (groups included), deduplicated', () => {
    const d = doc([layer([group('Outer', 0, 0, [layer([group('Inner', 0, 0), text('Label', 0, 0)])])])])
    expect(objectNames(d.layers).sort()).toEqual(['Inner', 'Label', 'Outer'])
  })
})
