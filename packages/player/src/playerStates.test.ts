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

// flatink/flatink#19 — mirroring a variable into a state from `every frame` is the natural thing to write.
// Each write restarted the transition from the current value with zero elapsed time: with an ease whose
// starting slope is zero, the object never moved at all.
describe('FlatPlayer — writing the state it is already heading to', () => {
  const everyFrame = (ease?: 'easeInOut'): Doc => {
    const doc = doorDoc([])
    if (ease) doc.symbols[0].states![0].ease = ease
    doc.timeline!.onEnterFrame = [{ do: 'setParam', target: 'Door', param: 'door', value: 'open' }]
    return doc
  }
  it('does not restart the transition: the door opens in the declared time', () => {
    const pl = new FlatPlayer(fakeCanvas(), everyFrame('easeInOut'), { input: false, audio: false, render: false })
    pl.stepSim(15)
    const mid = param(pl, 'doorInst', 'door')!
    expect(mid).toBeGreaterThan(0.2)
    expect(mid).toBeLessThan(0.8)
    pl.stepSim(30)
    expect(param(pl, 'doorInst', 'door')).toBe(1)
  })
  it('a write to a DIFFERENT state still starts from where the door is', () => {
    const doc = everyFrame()
    const pl = new FlatPlayer(fakeCanvas(), doc, { input: false, audio: false, render: false })
    pl.stepSim(60)
    expect(param(pl, 'doorInst', 'door')).toBe(1)
    doc.timeline!.onEnterFrame![0] = { do: 'setParam', target: 'Door', param: 'door', value: 'closed' }
    pl.stepSim(15)
    const mid = param(pl, 'doorInst', 'door')!
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    pl.stepSim(45)
    expect(param(pl, 'doorInst', 'door')).toBe(0)
  })
})

// flatink/flatink#14 — a state is a POSITION: once at `open`, writing `open` again does nothing, and going
// back through `closed` played the effect backwards. `= open from closed` jumps to `closed` (no animation)
// and plays the transition to `open` again — even when the state is already `open`.
describe('FlatPlayer — `Inst.state = B from A` replays a transition from its start', () => {
  const at = (frame: number, value: string) => ({ frame, actions: [{ do: 'setParam', target: 'Door', param: 'door', value } as Action] })
  const replayDoc = (value: string) => {
    const doc = doorDoc([{ do: 'setParam', target: 'Door', param: 'door', value: 'open' }])
    doc.timeline = { ...doc.timeline!, durationFrames: 1000, frameActions: [at(20, value)] }
    return doc
  }
  it('jumps to the origin, then plays to the target', () => {
    const pl = new FlatPlayer(fakeCanvas(), replayDoc('open from closed'), { input: false, audio: false, render: false })
    pl.stepSim(49) // the first transition is long done, frame ~19.6
    expect(param(pl, 'doorInst', 'door')).toBe(1)
    pl.stepSim(2) // frame 20 crossed: the replay starts — back at `closed`
    expect(param(pl, 'doorInst', 'door')).toBeLessThan(0.05)
    pl.stepSim(15)
    const mid = param(pl, 'doorInst', 'door')!
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    pl.stepSim(30)
    expect(param(pl, 'doorInst', 'door')).toBe(1)
  })
  it('without `from`, the same write stays a no-op (the state is already there)', () => {
    const pl = new FlatPlayer(fakeCanvas(), replayDoc('open'), { input: false, audio: false, render: false })
    pl.stepSim(75)
    expect(param(pl, 'doorInst', 'door')).toBe(1)
  })
})

// flatink/flatink#68 (from #66.9c) — `x = R.bras` read 0, always: an instance's params and states were not
// readable by name ("still to come" in the docs). They read their live value: the transition in progress,
// else the call-site value, else the symbol's default.
describe('an instance\'s params and states read by name', async () => {
  const { playHeadless } = await import('./headless')
  const { parseProgramFull } = await import('@flatkit/engine/flatFormat')
  const src = (call: string, behavior: string) => ['size 200 200', 'var b = -1', 'var q = -1',
    'symbol "Robot" {', '  timeline 24 24', '  params {', '    number queue = 1 range 0 2', '  }',
    '  states bras { repos at 0   leve at 24   initial repos   transition 6 }',
    '  layer "l" {', '    rect 0 0 20 20 fill #cc3333', '  }', '}',
    'scene {', '  layer "c" {', `    instance "Robot" as "R" at 50,50${call}`, '  }', '}', behavior].join('\n')
  // As the compiler hands it over: the instance's `@Robot` reference resolved to the symbol's id.
  const compiled = (s: string): Doc => {
    const d = parseProgramFull(s) as unknown as Doc
    for (const it of d.layers[0].items) if ('symbolId' in it) it.symbolId = d.symbols.find((y) => `@${y.name}` === it.symbolId)!.id
    return d
  }
  const run = (s: string, frames: number) => playHeadless(compiled(s), [{ type: 'wait', frames }]).vars
  it('defaults and call-site values', () => {
    expect(run(src('', 'every frame {\n  b = R.bras\n  q = R.queue\n}'), 1)).toMatchObject({ b: 0, q: 1 })
    expect(run(src(' { bras = leve, queue = 2 }', 'every frame {\n  b = R.bras\n  q = R.queue\n}'), 1)).toMatchObject({ b: 1, q: 2 })
  })
  it('a state set at runtime, through its transition', () => {
    const v = run(src('', 'when loaded {\n  R.bras = leve\n}\nevery frame {\n  b = R.bras\n}'), 60)
    expect(v.b).toBe(1)
  })
})
