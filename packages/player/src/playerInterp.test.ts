import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { lerpVars, cloneVarMap } from './player'

describe('lerpVars / cloneVarMap (render interpolation)', () => {
  it('interpolates numbers and arrays; incompatible types -> current value', () => {
    const prev = new Map<string, number | number[]>([['x', 0], ['arr', [0, 10]], ['flag', 0]])
    const cur = new Map<string, number | number[]>([['x', 100], ['arr', [10, 30]], ['flag', 1], ['new', 5]])
    const out = lerpVars(prev, cur, 0.5)
    expect(out.get('x')).toBe(50)
    expect(out.get('arr')).toEqual([5, 20])
    expect(out.get('flag')).toBe(0.5)
    expect(out.get('new')).toBe(5) // absent from prev -> current value
  })
  it('alpha 0 -> prev, alpha 1 -> cur', () => {
    const prev = new Map<string, number | number[]>([['x', 10]])
    const cur = new Map<string, number | number[]>([['x', 20]])
    expect(lerpVars(prev, cur, 0).get('x')).toBe(10)
    expect(lerpVars(prev, cur, 1).get('x')).toBe(20)
  })
  it('cloneVarMap copies the arrays (no reference sharing)', () => {
    const m = new Map<string, number | number[]>([['a', [1, 2]]])
    const c = cloneVarMap(m);(c.get('a') as number[])[0] = 99
    expect(m.get('a')).toEqual([1, 2])
  })
})

// -- Integration: the motion driven by onEnterFrame is rendered at the INTERPOLATED position. --
const renderCalls: unknown[][] = []
vi.mock('./drawScene', async (orig) => {
  const mod = await orig<typeof import('./drawScene')>()
  return { ...mod, renderLayers: (...args: unknown[]) => { renderCalls.push(args) } }
})

describe('FlatPlayer -- anti-judder interpolation (inter-step render)', () => {
  const fakeCtx = () => new Proxy({}, { get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 }) : p === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
  const fakeCanvas = () => ({ getContext: () => fakeCtx(), getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 }), addEventListener: () => {}, removeEventListener: () => {}, style: {} }) as unknown as HTMLCanvasElement
  let tickFn: ((now: number) => void) | null = null

  beforeEach(() => {
    renderCalls.length = 0
    tickFn = null
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 })
    vi.stubGlobal('addEventListener', () => {}); vi.stubGlobal('removeEventListener', () => {})
    vi.stubGlobal('requestAnimationFrame', (cb: (n: number) => void) => { tickFn = cb; return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('performance', { now: () => 0 })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('at mid-step, the render context sees the interpolated value (not the jumped value)', async () => {
    const { FlatPlayer } = await import('./player')
    const doc = {
      width: 100, height: 100, symbols: [], layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [] }],
      variables: { px: 0 },
      timeline: { fps: 24, durationFrames: 10000, tracks: [], onEnterFrame: [{ do: 'setVar', name: 'px', value: 'px + 10' }] },
    } as unknown as import('@flatkit/types').Doc
    const pl = new FlatPlayer(fakeCanvas(), doc, { input: false, padding: 0 })
    pl.play()
    const exprPx = () => (renderCalls.at(-1)![6] as { expr: Record<string, number> }).expr.px

    tickFn!(1000 / 60) // ~1 step (16.67ms): px 0 -> 10, remainder ~ 0 -> render at a~0 ~ start position
    expect(exprPx()).toBeCloseTo(0, 1)
    expect(pl.getVar('px')).toBe(10) // the REAL variable did jump to 10

    tickFn!(1000 / 60 + 1000 / 120) // +1/2 step: 0 sim steps, a=0.5 -> interpolated between 10 (prev) and 20... no: prev=0, cur=10 -> 5
    expect(exprPx()).toBeCloseTo(5, 1) // render MIDWAY (anti-judder), while the real px = 10
    expect(pl.getVar('px')).toBe(10)
    pl.destroy()
  })
})
