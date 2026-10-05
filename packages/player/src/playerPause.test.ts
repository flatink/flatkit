// flatink/flatink#67 — what `pause` stops. A script `pause` holds the PLAYHEAD; the scene keeps living —
// `every frame`, `clock`, springs — like Flash's `stop()`. `at frame N { pause }` is how a scene holds a
// screen, and it used to freeze everything in the player (an intro ending on ambient `clock` motion froze
// on its last frame), while `--play` ignored it altogether. The HOST's `pause()` still freezes the whole
// player (a hidden tab, a carousel slide off screen).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Action, Doc } from '@flatkit/types'
import { playHeadless } from './headless'
import { parseProgramFull } from '@flatkit/engine/flatFormat'

vi.mock('./drawScene', async (orig) => {
  const mod = await orig<typeof import('./drawScene')>()
  return { ...mod, renderLayers: () => {} }
})

const fakeCtx = () => new Proxy({}, { get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 }) : p === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
const fakeCanvas = () => ({ getContext: () => fakeCtx(), getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 }), addEventListener: () => {}, removeEventListener: () => {}, style: {} }) as unknown as HTMLCanvasElement

const doc = (onEnterFrame: Action[], frameActions: { frame: number; actions: Action[] }[]): Doc => ({
  width: 100, height: 100, symbols: [], layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [] }],
  variables: { n: 0, c: 0 },
  timeline: { fps: 60, durationFrames: 1000, tracks: [], onEnterFrame, frameActions },
} as unknown as Doc)

describe('FlatPlayer — a script `pause` holds the playhead, the scene keeps living', () => {
  let tickFn: ((now: number) => void) | null = null
  let rafs = 0
  let now = 0
  const tick = (n: number) => { for (let i = 0; i < n && tickFn; i++) { const f = tickFn; tickFn = null; now += 1000 / 60; f(now) } }

  beforeEach(() => {
    tickFn = null; rafs = 0; now = 0
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 })
    vi.stubGlobal('addEventListener', () => {}); vi.stubGlobal('removeEventListener', () => {})
    vi.stubGlobal('requestAnimationFrame', (cb: (n: number) => void) => { tickFn = cb; rafs++; return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => { tickFn = null })
    vi.stubGlobal('performance', { now: () => now })
  })
  afterEach(() => vi.unstubAllGlobals())

  const counting: Action[] = [{ do: 'setVar', name: 'n', value: 'n + 1' }, { do: 'setVar', name: 'c', value: 'clock' }]

  it('`every frame` and `clock` go on; the playhead does not', async () => {
    const { FlatPlayer } = await import('./player')
    const pl = new FlatPlayer(fakeCanvas(), doc(counting, [{ frame: 3, actions: [{ do: 'pause' }] }]), { input: false })
    pl.play()
    tick(30)
    expect(Math.floor(pl.currentFrame)).toBe(3)
    expect(pl.getVar('n') as number).toBeGreaterThanOrEqual(28) // a step per tick, give or take the float accumulator
    expect(pl.getVar('c') as number).toBeCloseTo(0.5, 6)
    expect(pl.isPlaying).toBe(false) // the TIMELINE is not playing
    pl.destroy()
  })

  it('the scene\'s own `play` releases it', async () => {
    const { FlatPlayer } = await import('./player')
    const resume: Action[] = [...counting, { do: 'if', cond: 'n == 10', then: [{ do: 'play' }] }]
    const pl = new FlatPlayer(fakeCanvas(), doc(resume, [{ frame: 3, actions: [{ do: 'pause' }] }]), { input: false })
    pl.play()
    tick(20)
    expect(pl.currentFrame).toBeGreaterThan(10)
    expect(pl.isPlaying).toBe(true)
    pl.destroy()
  })

  it('the host\'s `pause()` freezes everything', async () => {
    const { FlatPlayer } = await import('./player')
    const pl = new FlatPlayer(fakeCanvas(), doc(counting, []), { input: false })
    pl.play()
    tick(5)
    pl.pause()
    tick(5)
    expect(pl.getVar('n')).toBe(5)
    pl.destroy()
  })

  it('with nothing left alive, a held scene stops asking for frames (no idle loop)', async () => {
    const { FlatPlayer } = await import('./player')
    const pl = new FlatPlayer(fakeCanvas(), doc([], [{ frame: 3, actions: [{ do: 'pause' }] }]), { input: false })
    pl.play()
    tick(30)
    expect(rafs).toBeLessThan(10)
    expect(Math.floor(pl.currentFrame)).toBe(3)
    pl.destroy()
  })

  it('a load-time `pause` holds against `autoplay`, which still runs the scene', async () => {
    const { FlatPlayer } = await import('./player')
    const d = doc(counting, [])
    d.timeline!.onLoad = [{ do: 'pause' }]
    const pl = new FlatPlayer(fakeCanvas(), d, { input: false, autoplay: true })
    tick(10)
    expect(pl.currentFrame).toBe(0)
    expect(pl.getVar('n') as number).toBeGreaterThanOrEqual(8) // a step per tick, give or take the float accumulator
    pl.destroy()
  })
})

describe('--play — a script `pause` holds the playhead too', () => {
  it('the steps go on, the frame does not', () => {
    const src = ['size 100 100', 'timeline 24 600', 'var n = 0', 'var f = 0',
      'scene { layer "c" { group "G" at 50,50 { layer "a" { circle 0 0 10 fill #cc3333 } } } }',
      'every frame {', '  n = n + 1', '  f = frame', '}', 'at frame 3 { pause }'].join('\n')
    const v = playHeadless(parseProgramFull(src) as unknown as Doc, [{ type: 'wait', frames: 30 }]).vars
    expect(v.n).toBe(30)
    expect(Math.floor(v.f as number)).toBe(3)
  })
})
