// End-to-end of the per-instance state machine (P3 slice 2): a `setParam` action moves an instanced
// symbol's exposed state param, and the player animates the transition over the declared frames.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FlatPlayer } from './player'
import type { Action } from '@flatkit/engine/actions'
import type { Doc, Instance, Layer, Region, SymbolDef } from '@flatkit/types'
import { IDENTITY } from '@flatkit/engine/transform'
import { polygonsToPath } from '@flatkit/engine/path'

const fakeCtx = () => new Proxy({}, { get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 }) : p === 'getTransform' ? () => IDENTITY : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
const fakeCanvas = () => ({ getContext: () => fakeCtx(), getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 }), addEventListener: () => {}, removeEventListener: () => {}, style: {} }) as unknown as HTMLCanvasElement

const region = (id: string): Region => ({ id, color: '#884422', path: polygonsToPath([[{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 40 }]]) })

function doorDoc(onLoad: Action[]): Doc {
  const door: SymbolDef = {
    id: 'door_sym', name: 'Door',
    timeline: { fps: 24, durationFrames: 24, tracks: [] },
    states: [{ param: 'door', states: [{ name: 'closed', frame: 0 }, { name: 'open', frame: 24 }], initial: 'closed', transition: 12 }],
    layers: [{ id: 'dl', name: 'panel', visible: true, locked: false, opacity: 1, items: [region('panel')] }],
  }
  const inst: Instance = { id: 'doorInst', kind: 'instance', name: 'Door', transform: IDENTITY, symbolId: 'door_sym' }
  const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [inst] }
  return { width: 100, height: 100, symbols: [door], layers: [layer], timeline: { fps: 24, durationFrames: 24, tracks: [], onLoad } }
}

const param = (pl: FlatPlayer, id: string, name: string): number | undefined =>
  (pl as unknown as { paramsForInstance(id: string): Record<string, number> | undefined }).paramsForInstance(id)?.[name]

beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 })
  vi.stubGlobal('addEventListener', () => {})
  vi.stubGlobal('removeEventListener', () => {})
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => vi.unstubAllGlobals())

describe('FlatPlayer — per-instance state machine (setParam + transition)', () => {
  it('`Door.door = open` animates the param 0 → 1 over the transition frames, eased', () => {
    const pl = new FlatPlayer(fakeCanvas(), doorDoc([{ do: 'setParam', target: 'Door', param: 'door', value: 'open' }]), { input: false, audio: false, render: false })
    expect(param(pl, 'doorInst', 'door')).toBe(0) // just started: still at the "from" (closed) value
    pl.stepSim(15) // 15 sim steps × 0.4 frame = 6 frames ≈ half of the 12-frame transition
    const mid = param(pl, 'doorInst', 'door')!
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    pl.stepSim(30) // well past 12 frames → settled at open
    expect(param(pl, 'doorInst', 'door')).toBe(1)
  })

  it('a state NAME resolves to its index; an unknown instance is a no-op', () => {
    const pl = new FlatPlayer(fakeCanvas(), doorDoc([{ do: 'setParam', target: 'Ghost', param: 'door', value: 'open' }]), { input: false, audio: false, render: false })
    expect(param(pl, 'doorInst', 'door')).toBeUndefined() // unknown instance → nothing set
  })

  it('transition 0 (or none) snaps instantly', () => {
    const doc = doorDoc([{ do: 'setParam', target: 'Door', param: 'door', value: 'open' }])
    doc.symbols[0].states![0].transition = 0
    const pl = new FlatPlayer(fakeCanvas(), doc, { input: false, audio: false, render: false })
    expect(param(pl, 'doorInst', 'door')).toBe(1) // no transition → immediate
  })

  it('load() clears per-instance param state (no stale cross-document leak)', () => {
    const doc = doorDoc([{ do: 'setParam', target: 'Door', param: 'door', value: 'open' }])
    doc.symbols[0].states![0].transition = 0
    const pl = new FlatPlayer(fakeCanvas(), doc, { input: false, audio: false, render: false })
    expect(param(pl, 'doorInst', 'door')).toBe(1)
    pl.load(doorDoc([])) // fresh doc, no onLoad set
    expect(param(pl, 'doorInst', 'door')).toBeUndefined() // paramRt reset
  })
})
