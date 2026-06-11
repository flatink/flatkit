// #10A: the player exposes each item's interaction state (self.hovered/grabbed/pressed) to channel
// expressions via the render context's `itemState`. We mock renderLayers to capture that callback and
// assert it reflects the pointer, handler-independently (the Piece has no enter/leave handler).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Doc, Layer, Text } from '@flatkit/types'
import { IDENTITY } from '@flatkit/engine/transform'

const renderCalls: unknown[][] = []
vi.mock('./drawScene', async (orig) => {
  const mod = await orig<typeof import('./drawScene')>()
  return { ...mod, renderLayers: (...args: unknown[]) => { renderCalls.push(args) } }
})

type Handlers = Record<string, (e: { clientX: number; clientY: number; pointerId: number }) => void>
const fakeCtx = () => new Proxy({}, { get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 }) : p === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
const fakeCanvas = (h: Handlers) => ({
  getContext: () => fakeCtx(), getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 }),
  addEventListener: (t: string, fn: Handlers[string]) => { h[t] = fn }, removeEventListener: (t: string) => { delete h[t] },
  setPointerCapture: () => {}, releasePointerCapture: () => {}, style: {},
}) as unknown as HTMLCanvasElement

const piece = (): Text => ({ id: 'Piece', kind: 'text', name: 'Piece', transform: IDENTITY, content: 'x', font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.25, color: '#000', box: { w: 100, h: 100 } })

type ItemState = (id: string) => { hovered: number; grabbed: number; pressed: number } | undefined
const lastItemState = (): ItemState => (renderCalls.at(-1)![6] as { itemState: ItemState }).itemState

describe('FlatPlayer -- self interaction state exposed to channel exprs (#10A)', () => {
  beforeEach(() => {
    renderCalls.length = 0
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 })
    vi.stubGlobal('addEventListener', () => {}); vi.stubGlobal('removeEventListener', () => {})
    vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => vi.unstubAllGlobals())

  it('hovered/grabbed track the pointer even without enter/leave handlers', async () => {
    const { FlatPlayer } = await import('./player')
    const doc: Doc = {
      width: 100, height: 100, symbols: [], layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [piece()] } as Layer],
      interactors: [{ targetId: 'Piece', axis: 'xy', varX: 'px', varY: 'py' }], variables: { px: 0, py: 0 },
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const h: Handlers = {}
    const pl = new FlatPlayer(fakeCanvas(h), doc, { input: true, padding: 0 })

    // Before any pointer: resting.
    expect(lastItemState()('Piece')).toBeUndefined()

    h.pointermove({ clientX: 50, clientY: 50, pointerId: 1 }) // over Piece (no enter/leave handler)
    expect(lastItemState()('Piece')).toEqual({ hovered: 1, grabbed: 0, pressed: 0 })

    h.pointerdown({ clientX: 50, clientY: 50, pointerId: 1 }) // grab
    expect(lastItemState()('Piece')).toEqual({ hovered: 1, grabbed: 1, pressed: 1 })

    h.pointerup({ clientX: 50, clientY: 50, pointerId: 1 })
    expect(lastItemState()('Piece')!.grabbed).toBe(0)

    h.pointerleave?.({ clientX: 50, clientY: 50, pointerId: 1 }) // off-canvas → nothing hovered
    expect(lastItemState()('Piece')).toBeUndefined()
    pl.destroy()
  })
})
