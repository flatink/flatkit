// End-to-end integration of the `send` channel -> the FlatPlayer's `onEvent` option.
// Test environment = node (no DOM): we stub the minimum required by the constructor
// (canvas + no-op 2D context, window, requestAnimationFrame). We trigger `send` via `when loaded`
// (run once at construction) -> no need to simulate mouse/playback.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FlatPlayer, type PlayerOptions } from './player'
import type { Action } from '@flatkit/engine/actions'
import type { Doc, Layer, Text } from '@flatkit/types'
import { IDENTITY } from '@flatkit/engine/transform'

// Fake 2D context: every method is a no-op (measureText returns a zero width).
const fakeCtx = () =>
  new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'measureText') return () => ({ width: 0 })
        if (p === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
        return () => {}
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D

function fakeCanvas(): HTMLCanvasElement {
  return {
    getContext: () => fakeCtx(),
    getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {},
  } as unknown as HTMLCanvasElement
}

const textItem = (id: string, content: string): Text => ({
  id, kind: 'text', name: id, transform: IDENTITY, content,
  font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.25, color: '#000', box: { w: 10, h: 10 },
})

function makeDoc(onLoad: Action[], texts: Text[] = []): Doc {
  const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: texts }
  return { width: 100, height: 100, layers: [layer], symbols: [], timeline: { fps: 24, durationFrames: 1, tracks: [], onLoad } }
}

function play(onLoad: Action[], opts: PlayerOptions, texts: Text[] = []): FlatPlayer {
  return new FlatPlayer(fakeCanvas(), makeDoc(onLoad, texts), opts)
}

beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 })
  vi.stubGlobal('addEventListener', () => {})
  vi.stubGlobal('removeEventListener', () => {})
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => vi.unstubAllGlobals())

describe('FlatPlayer -- onEvent (send channel)', () => {
  it('when loaded { send "ready" } -> callback called without value', () => {
    const events: { name: string; value?: number | string }[] = []
    play([{ do: 'send', event: 'ready' }], { onEvent: (e) => events.push(e) })
    expect(events).toEqual([{ name: 'ready' }])
  })

  it('send "correct", 3 -> numeric value', () => {
    const events: { name: string; value?: number | string }[] = []
    play([{ do: 'send', event: 'correct', payload: { kind: 'expr', expr: '3' } }], { onEvent: (e) => events.push(e) })
    expect(events).toEqual([{ name: 'correct', value: 3 }])
  })

  it('send "answer", text("greeting") -> live content of the Text item', () => {
    const events: { name: string; value?: number | string }[] = []
    play(
      [{ do: 'send', event: 'answer', payload: { kind: 'text', itemId: 'greeting' } }],
      { onEvent: (e) => events.push(e) },
      [textItem('greeting', 'Hello')],
    )
    expect(events).toEqual([{ name: 'answer', value: 'Hello' }])
  })

  it('text("absent") -> empty string + warning, no crash', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const events: { name: string; value?: number | string }[] = []
    play([{ do: 'send', event: 'answer', payload: { kind: 'text', itemId: 'absent' } }], { onEvent: (e) => events.push(e) })
    expect(events).toEqual([{ name: 'answer', value: '' }])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('non-finite numeric payload -> 0 (NaN = 0 convention)', () => {
    const events: { name: string; value?: number | string }[] = []
    play([{ do: 'send', event: 'x', payload: { kind: 'expr', expr: '1 / 0' } }], { onEvent: (e) => events.push(e) })
    expect(events).toEqual([{ name: 'x', value: 0 }])
  })

  it('without onEvent -> silent no-op (no error)', () => {
    expect(() => play([{ do: 'send', event: 'ready' }], {})).not.toThrow()
  })

  it('callback that throws -> caught and logged, the player does not break', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => play([{ do: 'send', event: 'ready' }], { onEvent: () => { throw new Error('boom') } })).not.toThrow()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('send "answer", text("name") resolves a Text item by NAME as a fallback (id != name)', () => {
    const events: { name: string; value?: number | string }[] = []
    const t: Text = { ...textItem('auto-1', 'Hi'), name: 'greeting' } // id != name
    play([{ do: 'send', event: 'answer', payload: { kind: 'text', itemId: 'greeting' } }], { onEvent: (e) => events.push(e) }, [t])
    expect(events).toEqual([{ name: 'answer', value: 'Hi' }])
  })
})

describe('FlatPlayer -- getVar / setVar (bidirectional host driving)', () => {
  it('reads, writes, and returns a copy of the arrays', () => {
    const doc = makeDoc([])
    doc.variables = { score: 5, grid: [1, 2, 3] }
    const p = new FlatPlayer(fakeCanvas(), doc, {})
    expect(p.getVar('score')).toBe(5)
    expect(p.getVar('grid')).toEqual([1, 2, 3])
    expect(p.getVar('absent')).toBeUndefined()
    p.setVar('score', 10)
    expect(p.getVar('score')).toBe(10)
    // getVar returns a COPY: mutating the return value does not touch the internal state
    const g = p.getVar('grid') as number[]
    g[0] = 99
    expect(p.getVar('grid')).toEqual([1, 2, 3])
  })
})

describe('FlatPlayer -- sound action', () => {
  it('silent no-op if audio is off (no crash without AudioContext)', () => {
    expect(() => play([{ do: 'sound', assetId: 'pop' }], { audio: false })).not.toThrow()
  })
})
