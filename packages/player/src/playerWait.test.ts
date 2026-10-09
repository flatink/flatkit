// `wait` in a handler, on the player's REAL tick (requestAnimationFrame). The headless replay steps the
// simulation by hand; here the tick decides by itself whether to step at all — and it used to step only
// for `every frame`. A handler that waits is something alive: it must keep the steps coming, wake a tick
// that had stopped by itself, freeze with the host's `pause()`, and go when the host moves the playhead.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Action, Doc } from '@flatkit/types'
import { parseProgramFull } from '@flatkit/engine/flatFormat'

vi.mock('./drawScene', async (orig) => {
  const mod = await orig<typeof import('./drawScene')>()
  return { ...mod, renderLayers: () => {} }
})

type Listener = (e: unknown) => void
const fakeCtx = () => new Proxy({}, { get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 }) : p === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
const fakeCanvas = (listeners: Record<string, Listener> = {}) => ({ getContext: () => fakeCtx(), getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 }), addEventListener: (t: string, f: Listener) => { listeners[t] = f }, removeEventListener: () => {}, setPointerCapture: () => {}, releasePointerCapture: () => {}, style: {} }) as unknown as HTMLCanvasElement

const waitThen = (seconds: string): Action[] => [{ do: 'setVar', name: 'a', value: 'a + 1' }, { do: 'wait', seconds }, { do: 'setVar', name: 'b', value: 'b + 1' }]
const doc = (over: { frameActions?: { frame: number; actions: Action[] }[] }): Doc => ({
  width: 100, height: 100, symbols: [], layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [] }],
  variables: { a: 0, b: 0 },
  timeline: { fps: 60, durationFrames: 1000, tracks: [], frameActions: over.frameActions },
} as unknown as Doc)
const clickable = 'size 100 100\ntimeline 60 1000\nvar a = 0\nvar b = 0\nscene { layer "l" { group "Btn" at 0,0 { layer "c" { rect 0 0 100 100 fill #ff0000 } } } }\nat frame 2 { pause }\nobject "Btn" { when clicked {\n  a = a + 1\n  wait 0.25\n  b = b + 1\n} }\n'

describe('FlatPlayer — a handler that waits, on the real tick', () => {
  let tickFn: ((now: number) => void) | null = null
  let now = 0
  const tick = (n: number) => { for (let i = 0; i < n && tickFn; i++) { const f = tickFn; tickFn = null; now += 1000 / 60; f(now) } }

  beforeEach(() => {
    tickFn = null; now = 0
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 })
    vi.stubGlobal('addEventListener', () => {}); vi.stubGlobal('removeEventListener', () => {})
    vi.stubGlobal('requestAnimationFrame', (cb: (n: number) => void) => { tickFn = cb; return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => { tickFn = null })
    vi.stubGlobal('performance', { now: () => now })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('resumes with NO `every frame` in the scene: the wait itself keeps the steps coming', async () => {
    const { FlatPlayer } = await import('./player')
    const pl = new FlatPlayer(fakeCanvas(), doc({ frameActions: [{ frame: 2, actions: waitThen('0.25') }] }), { input: false })
    pl.play()
    tick(10)
    expect([pl.getVar('a'), pl.getVar('b')]).toEqual([1, 0])
    tick(20) // 0.25 s = 15 steps, a step per tick give or take the float accumulator
    expect(pl.getVar('b')).toBe(1)
    pl.destroy()
  })

  it('a held playhead with a handler waiting stays alive, then the tick stops once it has run', async () => {
    const { FlatPlayer } = await import('./player')
    const pl = new FlatPlayer(fakeCanvas(), doc({ frameActions: [{ frame: 2, actions: [{ do: 'pause' }, ...waitThen('0.25')] }] }), { input: false })
    pl.play()
    tick(10)
    expect(pl.getVar('b')).toBe(0)
    expect(tickFn).not.toBeNull() // still asking for frames: something is waiting
    tick(30)
    expect(pl.getVar('b')).toBe(1)
    expect(tickFn).toBeNull() // nothing left alive: no idle loop
    pl.destroy()
  })

  it('a click on a scene whose tick had stopped by itself wakes it for the wait', async () => {
    const { FlatPlayer } = await import('./player')
    const listeners: Record<string, Listener> = {}
    const pl = new FlatPlayer(fakeCanvas(listeners), parseProgramFull(clickable) as unknown as Doc)
    pl.play()
    tick(10)
    expect(tickFn).toBeNull() // held, nothing alive: stopped by itself
    const ev = { clientX: 50, clientY: 50, pointerId: 1, button: 0, preventDefault: () => {} }
    listeners.pointerdown!(ev); listeners.pointerup!(ev)
    expect(pl.getVar('a')).toBe(1)
    tick(30)
    expect(pl.getVar('b')).toBe(1)
    pl.destroy()
  })

  it('the host\'s `pause()` freezes a waiting handler, and `play()` lets it go on', async () => {
    const { FlatPlayer } = await import('./player')
    const pl = new FlatPlayer(fakeCanvas(), doc({ frameActions: [{ frame: 2, actions: waitThen('0.25') }] }), { input: false })
    pl.play()
    tick(8)
    pl.pause()
    tick(60)
    expect(pl.getVar('b')).toBe(0)
    pl.play()
    tick(20)
    expect(pl.getVar('b')).toBe(1)
    pl.destroy()
  })

  it('the host\'s `seek()` drops what was waiting; so does `load()`', async () => {
    const { FlatPlayer } = await import('./player')
    const d = doc({ frameActions: [{ frame: 2, actions: waitThen('0.25') }] })
    const pl = new FlatPlayer(fakeCanvas(), d, { input: false })
    pl.play()
    tick(8)
    pl.seek(500)
    tick(40)
    expect(pl.getVar('b')).toBe(0)
    pl.seek(0)
    tick(8)
    pl.load(d)
    pl.seek(500) // away from frame 2, so nothing starts again
    tick(40)
    expect(pl.getVar('b')).toBe(0)
    pl.destroy()
  })

  it('more handlers waiting than the cap: the oldest gives way, the player goes on', async () => {
    const { FlatPlayer } = await import('./player')
    const many = Array.from({ length: 300 }, (_, i) => ({ frame: 2, actions: [{ do: 'wait', seconds: '0.1' }, { do: 'setVar', name: 'b', value: `b + ${i === 0 ? 1000 : 1}` }] as Action[] }))
    const pl = new FlatPlayer(fakeCanvas(), doc({ frameActions: many }), { input: false })
    pl.play()
    tick(30)
    expect(pl.getVar('b')).toBe(256) // the 256 most recent ran; the first (worth 1000) was among those dropped
    pl.destroy()
  })
})

describe('FlatPlayer — a waiting handler from a document no compiler wrote', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 })
    vi.stubGlobal('addEventListener', () => {}); vi.stubGlobal('removeEventListener', () => {})
    vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => vi.unstubAllGlobals())

  it('a task whose actions are malformed throws ONCE and is gone: the steps after it run', async () => {
    const { FlatPlayer } = await import('./player')
    const broken = [{ do: 'wait', seconds: '0' }, { do: 'repeat', count: '5', body: { length: 1, 0: null, some: () => true } }] as unknown as Action[]
    const pl = new FlatPlayer(fakeCanvas(), doc({ frameActions: [{ frame: 1, actions: broken }] }), { input: false })
    let thrown = 0
    for (let i = 0; i < 10; i++) { try { pl.stepSim(1) } catch { thrown++ } }
    expect(thrown).toBe(1)
    pl.destroy()
  })
  it('a wait of a huge number of seconds just stays there', async () => {
    const { FlatPlayer } = await import('./player')
    const pl = new FlatPlayer(fakeCanvas(), doc({ frameActions: [{ frame: 1, actions: [{ do: 'wait', seconds: '1000000000 * 1000000000' }, { do: 'setVar', name: 'b', value: '1' }] }] }), { input: false })
    pl.stepSim(600)
    expect(pl.getVar('b')).toBe(0)
    pl.destroy()
  })
})
