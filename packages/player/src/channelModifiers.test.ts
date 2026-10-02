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

// flatink/flatink#49 — an instance's params used to be merged into a COPY of the whole scene context
// (every variable, every named object), per instance, per walk. The scope is now chained to its parent's.
describe('drawScene — an instance scope sees its params, its parents\' and the scene, without copying any', () => {
  const inner: SymbolDef = { id: 'in', name: 'Inner', params: [{ name: 'a', type: 'number', default: '1' }], layers: [layer([springGroup('g', 'a + b + k')])] }
  const outer: SymbolDef = { id: 'out', name: 'Outer', params: [{ name: 'b', type: 'number', default: '10' }], layers: [layer([{ id: 'i', kind: 'instance', name: 'i', transform: IDENTITY, symbolId: 'in', params: { a: '2' } } as Instance])] }
  const doc: Doc = { width: 100, height: 100, symbols: [inner, outer], layers: [layer([{ id: 'o', kind: 'instance', name: 'o', transform: IDENTITY, symbolId: 'out' } as Instance])], variables: {} }
  it('own param, the enclosing instance\'s param and a scene variable all resolve', () => {
    const [t] = collectModifierTargets(doc, 0, { fps: 24, statePath: '', expr: { k: 100 } })
    expect(t.target).toBe(112)
  })
  it('a param hides a scene variable of the same name, as it always did', () => {
    const [t] = collectModifierTargets(doc, 0, { fps: 24, statePath: '', expr: { k: 100, b: 5000 } })
    expect(t.target).toBe(112)
  })
  it('the scene context is handed down by reference: its keys are not copied into the scope', () => {
    const scene: Record<string, unknown> = { k: 100 }
    let reads = 0
    for (let i = 0; i < 400; i++) Object.defineProperty(scene, `D${i}`, { enumerable: true, get: () => { reads++; return 0 } })
    collectModifierTargets(doc, 0, { fps: 24, statePath: '', expr: scene as never })
    expect(reads).toBe(0) // a spread reads every enumerable key of what it copies
  })
})

// flatink/flatink#48 — the gate asked "does the DOCUMENT declare a modifier", symbols the scene never
// instantiates included: linking a library that has one spring switched the whole advance pass on.
describe('drawScene — docHasModifiers looks at what the scene can reach', () => {
  const springSym: SymbolDef = { id: 'sp', name: 'Jauge', layers: [layer([springGroup('aiguille', '1')])] }
  const plainSym: SymbolDef = { id: 'pl', name: 'Dot', layers: [layer([])] }
  const inst = (symbolId: string): Instance => ({ id: `i_${symbolId}`, kind: 'instance', name: symbolId, transform: IDENTITY, symbolId })
  const docOf = (symbols: SymbolDef[], items: Layer['items']): Doc => ({ width: 100, height: 100, symbols, layers: [layer(items)], variables: {} })
  it('a symbol with a spring that nothing instantiates does not count', () => {
    expect(docHasModifiers(docOf([springSym, plainSym], [inst('pl')]))).toBe(false)
  })
  it('instantiated in the scene: it counts', () => {
    expect(docHasModifiers(docOf([springSym], [inst('sp')]))).toBe(true)
  })
  it('reached through another symbol, or from inside a group: it counts', () => {
    const wrapper: SymbolDef = { id: 'wr', name: 'Wrapper', layers: [layer([inst('sp')])] }
    expect(docHasModifiers(docOf([springSym, wrapper], [inst('wr')]))).toBe(true)
    const grp: Group = { id: 'g', kind: 'group', name: 'g', transform: IDENTITY, layers: [layer([inst('sp')])] }
    expect(docHasModifiers(docOf([springSym], [grp]))).toBe(true)
  })
  it('symbols that instantiate each other in a cycle do not hang', () => {
    const a: SymbolDef = { id: 'a', name: 'A', layers: [layer([inst('b')])] }
    const b: SymbolDef = { id: 'b', name: 'B', layers: [layer([inst('a')])] }
    expect(docHasModifiers(docOf([a, b], [inst('a')]))).toBe(false)
  })
})

describe('drawScene — docHasModifiers', () => {
  it('true when a symbol (or scene) declares a modifier, false otherwise', () => {
    const withMod: Doc = { width: 1, height: 1, symbols: [{ id: 's', name: 'S', layers: [layer([springGroup('g', '1')])] }], layers: [layer([{ id: 'i', kind: 'instance', name: 'i', transform: IDENTITY, symbolId: 's' }])], variables: {} }
    const none: Doc = { width: 1, height: 1, symbols: [], layers: [layer([{ id: 'g', kind: 'group', name: 'g', transform: IDENTITY, layers: [] }])], variables: {} }
    expect(docHasModifiers(withMod)).toBe(true)
    expect(docHasModifiers(none)).toBe(false)
  })

  it('a RECURSIVE symbol does not hang the modifier walk (anti-cycle guard)', () => {
    // symbol "A" instances itself and carries a modifier → without the guard, collectModifierTargets loops forever
    const sym: SymbolDef = { id: 'A', name: 'A', layers: [layer([
      springGroup('s', '1'),
      { id: 'self', kind: 'instance', name: 'self', transform: IDENTITY, symbolId: 'A' } as Instance,
    ])] }
    const doc: Doc = { width: 10, height: 10, symbols: [sym], layers: [layer([{ id: 'root', kind: 'instance', name: 'root', transform: IDENTITY, symbolId: 'A' } as Instance])], variables: {} }
    const targets = collectModifierTargets(doc, 0, { fps: 24, statePath: '' })
    expect(targets.length).toBeGreaterThan(0) // terminated (the self-instance is cut by the seen-set), collected the modifier(s)
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

  it('velocity() in a target reacts to a CHANGING arg, returns to rest when it stops, snaps on seek', async () => {
    const { FlatPlayer } = await import('./player')
    // smooth k=1 so the integrated value equals the target (= velocity(tgt)) each step -> easy to read
    const g: Group = { id: 'g', kind: 'group', name: 'g', transform: IDENTITY, layers: [], modifiers: { opacity: { kind: 'smooth', target: 'velocity(tgt)', k: 1 } } }
    const doc: Doc = { width: 100, height: 100, symbols: [], layers: [layer([g])], variables: { tgt: 0 } }
    const pl = new FlatPlayer(fakeCanvas(), doc, { audio: false })
    pl.stepSim(1)
    expect(lastChannelValue()('g', 'opacity')).toBe(0) //              arg constant -> velocity 0 (rest = vertical)
    pl.setVar('tgt', 1)
    pl.stepSim(1)
    expect(lastChannelValue()('g', 'opacity')).toBeGreaterThan(0) //   arg moved -> velocity > 0 (the swing impulse)
    pl.stepSim(1) //                                                   tgt unchanged now
    expect(lastChannelValue()('g', 'opacity')).toBeCloseTo(0, 6) //    movement stopped -> velocity back to 0
    pl.seek(3)
    expect(lastChannelValue()('g', 'opacity')).toBeUndefined() //      state cleared -> snap to rest
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
