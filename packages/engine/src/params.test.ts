import { describe, it, expect } from 'vitest'
import { resolveInstanceParams, frozenInstanceFrame, instanceFrames } from './params'
import type { Instance, SymbolDef } from '@flatkit/types'

const sym = (over: Partial<SymbolDef> = {}): SymbolDef => ({
  id: 's', name: 'Boat', layers: [],
  params: [
    { name: 'hull', type: 'color', default: '#c0392b' },
    { name: 'wave', type: 'number', default: '1', min: 0, max: 2 },
    { name: 'flag', type: 'bool', default: 'true' },
  ],
  ...over,
})
const inst = (params?: Record<string, string>): Pick<Instance, 'params'> => ({ params })

describe('params — resolveInstanceParams', () => {
  it('uses declared defaults (color → color map, number/bool → numeric scope)', () => {
    const r = resolveInstanceParams(sym(), inst())
    expect(r.color).toEqual({ hull: '#c0392b' })
    expect(r.numeric).toEqual({ wave: 1, flag: 1 }) // bool true → 1
  })

  it('call-site values override defaults', () => {
    const r = resolveInstanceParams(sym(), inst({ hull: '#00ff00', wave: '1.5', flag: 'false' }))
    expect(r.color.hull).toBe('#00ff00')
    expect(r.numeric.wave).toBeCloseTo(1.5)
    expect(r.numeric.flag).toBe(0)
  })

  it('numbers are clamped to the declared range', () => {
    expect(resolveInstanceParams(sym(), inst({ wave: '9' })).numeric.wave).toBe(2) // clamp to max
    expect(resolveInstanceParams(sym(), inst({ wave: '-3' })).numeric.wave).toBe(0) // clamp to min
  })

  it('state machines surface as numeric scope values (initial, or a call-site state name)', () => {
    const withState = sym({ states: [{ param: 'door', states: [{ name: 'closed', frame: 0 }, { name: 'open', frame: 24 }], initial: 'closed' }] })
    expect(resolveInstanceParams(withState, inst()).numeric.door).toBe(0) // initial
    expect(resolveInstanceParams(withState, inst({ door: 'open' })).numeric.door).toBe(1) // name → index
  })

  it('no symbol → empty maps', () => {
    expect(resolveInstanceParams(undefined, inst({ x: '1' }))).toEqual({ numeric: {}, color: {} })
  })
})

describe('params — frozenInstanceFrame (editor static state preview)', () => {
  const door = (over: Partial<SymbolDef> = {}): SymbolDef => ({
    id: 's', name: 'Door', layers: [],
    states: [{ param: 'door', states: [{ name: 'closed', frame: 0 }, { name: 'open', frame: 24 }], initial: 'closed' }],
    ...over,
  })

  it('no states → 0 (nested timeline stays frozen at 0 in the editor)', () => {
    expect(frozenInstanceFrame(sym(), inst())).toBe(0) // sym() has params but no states
    expect(frozenInstanceFrame(undefined, inst())).toBe(0)
  })

  it('state-driven → the selected state’s frame (call-site), else the initial’s frame', () => {
    expect(frozenInstanceFrame(door(), inst())).toBe(0) // initial = closed @0
    expect(frozenInstanceFrame(door(), inst({ door: 'open' }))).toBe(24) // call-site open @24
  })

  it('fractional/animated value lerps between anchors (in-between frame)', () => {
    expect(frozenInstanceFrame(door(), inst({ door: '0.5' }))).toBe(12) // halfway 0→24
  })
})

// RFC states-vs-nested-loops (design A): a state machine DECOUPLES the symbol's pose frame from the clock
// it hands to nested timelines, so a sub-loop keeps playing under a pinned state (without forcing every
// pose to move). `instanceFrames` is the shared engine decision used by render (drawScene) and hit-testing.
describe('params — instanceFrames (pose vs playback clock)', () => {
  const tl = (durationFrames: number) => ({ fps: 24, durationFrames, tracks: [] })
  const spin = (dur = 24): SymbolDef => ({ id: 'q', name: 'Spin', timeline: tl(dur), layers: [] })
  const parent = (): SymbolDef => ({
    id: 'p', name: 'Parent', timeline: tl(48), layers: [],
    states: [{ param: 'state', states: [{ name: 'calme', frame: 0 }, { name: 'agite', frame: 24 }], initial: 'calme' }],
  })
  const playback = (params?: Record<string, string>): Pick<Instance, 'playback' | 'params'> => ({ params })

  it('no state machine → pose tracks the clock (ordinary nested playback, looped in the timeline)', () => {
    expect(instanceFrames(spin(24), playback(), 30)).toEqual({ pose: 6, clock: 6 }) // 30 % 24
    expect(instanceFrames(spin(24), playback(), 100)).toEqual({ pose: 4, clock: 4 }) // 100 % 24
  })

  it('state machine PINS the pose but the clock keeps flowing (THE FIX)', () => {
    const calme = (clock: number) => instanceFrames(parent(), playback(), clock, false, { state: 0 })
    // pose stays on the `calme` anchor (frame 0) at every instant…
    expect(calme(30).pose).toBe(0)
    expect(calme(100).pose).toBe(0)
    // …while the clock advances (so a sub-loop inside keeps playing): 30 % 48, 100 % 48.
    expect(calme(30).clock).toBe(30)
    expect(calme(100).clock).toBe(4)
  })

  it('a fractional state value (a transition) moves the pose while the clock still flows independently', () => {
    // state = 0.5 → pose lerps to the in-between frame (drives a cross-fade), clock unaffected.
    const mid = instanceFrames(parent(), playback(), 30, false, { state: 0.5 })
    expect(mid.pose).toBe(12) // halfway between anchors 0 and 24
    expect(mid.clock).toBe(30) // independent of the state
  })

  it('freeze (editor freezeNested) keeps both frozen at the selected state frame', () => {
    expect(instanceFrames(parent(), playback(), 30, true, { state: 0 })).toEqual({ pose: 0, clock: 0 })
    expect(instanceFrames(spin(24), playback(), 30, true)).toEqual({ pose: 0, clock: 0 }) // no states → 0
  })
})
