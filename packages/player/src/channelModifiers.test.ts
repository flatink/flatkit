// Stage 4 — the player wiring of stateful channel modifiers (smooth/spring):
//  - collectModifierTargets keys per-INSTANCE path → two instances of one symbol are independent (v2);
//  - docHasModifiers gates the advance pass;
//  - the player's stepSim advances the integrator state, and seek clears it (random-access snap).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Doc, Group, Instance, Layer, SymbolDef } from '@flatkit/types'
import { IDENTITY } from '@flatkit/engine/transform'

const renderCalls: unknown[][] = []
vi.mock('./drawScene', async (orig) => {
  const mod = await orig<typeof import('./drawScene')>()
  return { ...mod, renderLayers: (...args: unknown[]) => { renderCalls.push(args) } } // capture render args; keep the rest real
})

import { collectModifierTargets, docHasModifiers } from './drawScene'

const layer = (items: Layer['items']): Layer => ({ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items })
const springGroup = (id: string, target: string): Group => ({ id, kind: 'group', name: id, transform: IDENTITY, layers: [], modifiers: { rotation: { kind: 'spring', target, stiffness: 0.1, damping: 0.5 } } })

describe('drawScene — collectModifierTargets: per-instance state keys (v2)', () => {
  it('two instances of a symbol with an INTERNAL modifier get independent keys AND targets', () => {
    const sym: SymbolDef = { id: 'sym', name: 'Grue', params: [{ name: 'crochetX', type: 'number', default: '0' }], layers: [layer([springGroup('suspente', 'crochetX')])] }
    const inst = (id: string, x: string): Instance => ({ id, kind: 'instance', name: id, transform: IDENTITY, symbolId: 'sym', params: { crochetX: x } })
    const doc: Doc = { width: 100, height: 100, symbols: [sym], layers: [layer([inst('gru1', '0.2'), inst('gru2', '0.8')])], variables: {} }
    const got = collectModifierTargets(doc, 0, { fps: 24, statePath: '' }).map((t) => ({ key: t.key, ch: t.ch, target: t.target })).sort((a, b) => a.key.localeCompare(b.key))
    expect(got).toEqual([
      { key: 'gru1/suspente', ch: 'rotation', target: 0.2 }, // distinct key AND distinct target → independent springs
      { key: 'gru2/suspente', ch: 'rotation', target: 0.8 },
    ])
  })
})

describe('drawScene — docHasModifiers', () => {
  it('true when a symbol (or scene) declares a modifier, false otherwise', () => {
    const withMod: Doc = { width: 1, height: 1, symbols: [{ id: 's', name: 'S', layers: [layer([springGroup('g', '1')])] }], layers: [layer([{ id: 'i', kind: 'instance', name: 'i', transform: IDENTITY, symbolId: 's' }])], variables: {} }
    const none: Doc = { width: 1, height: 1, symbols: [], layers: [layer([{ id: 'g', kind: 'group', name: 'g', transform: IDENTITY, layers: [] }])], variables: {} }
    expect(docHasModifiers(withMod)).toBe(true)
    expect(docHasModifiers(none)).toBe(false)
  })
})

const fakeCtx = () => new Proxy({}, { get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 }) : p === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
const fakeCanvas = () => ({
  getContext: () => fakeCtx(), getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 }),
  addEventListener: () => {}, removeEventListener: () => {}, setPointerCapture: () => {}, releasePointerCapture: () => {}, style: {},
}) as unknown as HTMLCanvasElement
type ChannelValue = (key: string, ch: string) => number | undefined
const lastChannelValue = (): ChannelValue => (renderCalls.at(-1)![6] as { channelValue: ChannelValue }).channelValue

describe('FlatPlayer — modifier advance wiring (headless, render mocked)', () => {
  beforeEach(() => {
    renderCalls.length = 0
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 })
    vi.stubGlobal('addEventListener', () => {}); vi.stubGlobal('removeEventListener', () => {})
    vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => vi.unstubAllGlobals())

  it('stepSim populates per-channel state; seek clears it (snap to target)', async () => {
    const { FlatPlayer } = await import('./player')
    const doc: Doc = { width: 100, height: 100, symbols: [], layers: [layer([springGroup('g', '0.5')])], variables: {} }
    const pl = new FlatPlayer(fakeCanvas(), doc, { audio: false }) // render ON (mocked) so we can read the channelValue callback
    pl.stepSim(20)
    expect(lastChannelValue()('g', 'rotation')).toBeCloseTo(0.5, 6) // state created by the advance, settled on the target
    pl.seek(3)
    expect(lastChannelValue()('g', 'rotation')).toBeUndefined() // cleared → next resolve snaps to the target
  })

  it('the modifier actually MOVES through the player: a changed target is chased (lag), then settles', async () => {
    const { FlatPlayer } = await import('./player')
    const g: Group = { id: 'g', kind: 'group', name: 'g', transform: IDENTITY, layers: [], modifiers: { opacity: { kind: 'smooth', target: 'tgt', k: 0.3 } } }
    const doc: Doc = { width: 100, height: 100, symbols: [], layers: [layer([g])], variables: { tgt: 0 } }
    const pl = new FlatPlayer(fakeCanvas(), doc, { audio: false })
    pl.stepSim(1) //                                   state inits at rest on tgt = 0
    expect(lastChannelValue()('g', 'opacity')).toBe(0)
    pl.setVar('tgt', 1) //                             move the target
    pl.stepSim(1) //                                   one fixed step toward it: 0 + (1-0)*0.3
    expect(lastChannelValue()('g', 'opacity')).toBeCloseTo(0.3, 6) // MOVED, but LAGS the target (the "feel")
    pl.stepSim(100)
    expect(lastChannelValue()('g', 'opacity')).toBeCloseTo(1, 3) // settles on the target
  })

  it('two instances integrate INDEPENDENTLY through the player (v2, end-to-end)', async () => {
    const { FlatPlayer } = await import('./player')
    const sym: SymbolDef = { id: 'sym', name: 'Grue', params: [{ name: 'crochetX', type: 'number', default: '0' }], layers: [layer([springGroup('suspente', 'crochetX')])] }
    const inst = (id: string, x: string): Instance => ({ id, kind: 'instance', name: id, transform: IDENTITY, symbolId: 'sym', params: { crochetX: x } })
    const doc: Doc = { width: 100, height: 100, symbols: [sym], layers: [layer([inst('gru1', '0.2'), inst('gru2', '0.8')])], variables: {} }
    const pl = new FlatPlayer(fakeCanvas(), doc, { audio: false })
    pl.stepSim(60)
    const v = lastChannelValue()
    expect(v('gru1/suspente', 'rotation')).toBeCloseTo(0.2, 6) // each crane holds its OWN target
    expect(v('gru2/suspente', 'rotation')).toBeCloseTo(0.8, 6) // no cross-contamination between instances
  })
})
