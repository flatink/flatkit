// How often the player PAINTS. Reported from a real-time game and a series of school activities
// (flatink/flatink#47, #51, #46): a param write repainted the whole scene on the spot, and a scene where
// nothing moves was repainted sixty times a second — a third to nine tenths of a core, at rest.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FlatPlayer } from './player'
import { parseProgramFull, parseFlat } from '@flatkit/engine/flatFormat'
import type { Doc, Instance } from '@flatkit/types'
import { IDENTITY } from '@flatkit/engine/transform'

type Handlers = Record<string, (e: unknown) => void>
let paints = 0
let raf: ((now: number) => void) | null = null
let now = 0
const ctx2d = () => new Proxy({}, {
  get: (_t, p) => p === 'clearRect' ? () => { paints++ } : p === 'measureText' ? () => ({ width: 0 }) : p === 'getTransform' ? () => IDENTITY
    : p === 'createLinearGradient' || p === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {},
  set: () => true,
}) as unknown as CanvasRenderingContext2D
const canvasOf = (h: Handlers = {}) => {
  const c = {
    width: 0, height: 0, style: {},
    getContext: () => ctx2d(),
    getBoundingClientRect: () => ({ width: 200, height: 100, left: 0, top: 0, right: 200, bottom: 100 }),
    addEventListener: (t: string, f: (e: unknown) => void) => { h[t] = f },
    removeEventListener: () => {}, setPointerCapture: () => {}, releasePointerCapture: () => {}, hasPointerCapture: () => false,
  }
  return c as unknown as HTMLCanvasElement & { width: number; height: number }
}
/** Runs `n` animation frames of 1/60 s through the player's own loop. */
const frames = (n: number) => { for (let i = 0; i < n; i++) { now += 1000 / 60; const f = raf; raf = null; f?.(now) } }
/** Paints during `n` frames of playback, once the first frame is on screen. */
const paintsOver = (pl: FlatPlayer, n: number): number => { pl.play(); frames(2); paints = 0; frames(n); return paints }

const globalHandlers: Handlers = {}
beforeEach(() => {
  paints = 0; raf = null; now = 0
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 })
  vi.stubGlobal('addEventListener', (t: string, f: (e: unknown) => void) => { globalHandlers[t] = f })
  vi.stubGlobal('removeEventListener', () => {})
  vi.stubGlobal('requestAnimationFrame', (f: (now: number) => void) => { raf = f; return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => { raf = null })
  vi.stubGlobal('Path2D', class { addPath() {} rect() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {} closePath() {} arc() {} ellipse() {} })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const scene = (header: string, behavior = '') =>
  parseProgramFull(`size 200 100\n${header}\nscene {\n  layer "c" {\n    group "B" at 50,50 {\n      layer "a" {\n        circle 0 0 20 fill #3366cc\n      }\n    }\n  }\n}\n${behavior}\n`) as unknown as Doc

/** A scene with `n` instances `P0…` of a library symbol: a number param `v` (drives an opacity) and a
 *  two-state machine `s` (drives the symbol's own keyframes). */
function components(n: number, behavior = ''): Doc {
  const [sym] = parseFlat([
    'symbol "Dot" {', '  timeline 24 24', '  params { number v = 0 range 0 1 "level" }',
    '  states s { off at 0   on at 24   initial off   transition 12 }',
    '  layer "b" {', '    group "Halo" at 0,0 pivot 0,0 expr opacity "0.5 + v / 2" {', '      layer "a" {', '        circle 0 0 10 fill #ffcc00', '      }', '    }',
    '    cel 0 tween { pose "Halo" at 0,0 }', '    cel 24 { pose "Halo" at 40,0 }', '  }', '}', '',
  ].join('\n'))
  const doc = scene('timeline 24 240', behavior)
  const insts: Instance[] = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, kind: 'instance', name: `P${i}`, transform: IDENTITY, symbolId: sym.id }))
  doc.layers[0].items.push(...insts)
  doc.symbols = [sym]
  return doc
}

describe('FlatPlayer — a param write does not paint (flatink/flatink#47)', () => {
  const writes = 'every frame {\n  P0.v = (sin(clock * 3) + 1) / 2\n  P1.v = (sin(clock * 3 + 1) + 1) / 2\n  P2.v = (sin(clock * 3 + 2) + 1) / 2\n}'
  it('in a headless step: ONE paint for the step, whatever the number of writes', () => {
    const pl = new FlatPlayer(canvasOf(), components(3, writes), { input: false, audio: false })
    paints = 0
    pl.stepSim(1)
    expect(paints).toBe(1)
  })
  it('in the playback loop: never more than one paint per animation frame', () => {
    const pl = new FlatPlayer(canvasOf(), components(3, writes), { input: false, audio: false })
    const n = paintsOver(pl, 60)
    expect(n).toBeLessThanOrEqual(60)
    expect(n).toBeGreaterThan(50) // a frame in which no sim step ran wrote nothing, and is not repainted
  })
  it('in a handler: the write is on screen when the handler returns', () => {
    const h: Handlers = {}
    const pl = new FlatPlayer(canvasOf(h), components(1, 'object "B" {\n  when pressed {\n    P0.v = 1\n  }\n}'), { audio: false })
    paints = 0
    h.pointerdown({ clientX: 50, clientY: 50, pointerId: 1 })
    expect(paints).toBeGreaterThanOrEqual(1)
    expect(paints).toBeLessThanOrEqual(2) // not one per write on top of the handler's own
    expect((pl as unknown as { paramsForInstance(id: string): Record<string, number> }).paramsForInstance('p0').v).toBe(1)
  })
})

describe('FlatPlayer — a picture that does not change is not repainted (flatink/flatink#51)', () => {
  const play = (doc: Doc, n = 30, h?: Handlers) => paintsOver(new FlatPlayer(canvasOf(h), doc, { audio: false, input: !!h }), n)

  it('a still scene: no paint at all while it plays', () => {
    expect(play(scene(''))).toBe(0)
  })
  it('components at rest (states, params) are still too', () => {
    expect(play(components(5))).toBe(0)
  })
  it('an expression that reads the clock repaints every frame', () => {
    expect(play(scene('', 'object "B" {\n  x = 50 + sin(clock) * 20\n}'))).toBe(30)
  })
  it('…also when the clock is read through a function, a stdlib one included', () => {
    expect(play(scene('fn sway() = sin(clock) * 20', 'object "B" {\n  x = 50 + sway()\n}'))).toBe(30)
    expect(play(scene('use "feedback"\nvar t0 = 0', 'object "B" {\n  scaleX = 1 + pulse(t0, 0.3)\n}'))).toBe(30)
  })
  it('keyframes that play with the playhead repaint every frame', () => {
    const doc = components(1)
    doc.symbols[0].states = undefined // no state machine pinning it: the symbol plays its timeline
    expect(play(doc)).toBe(30)
  })
  it('`every frame` bookkeeping the picture never reads costs no paint', () => {
    expect(play(scene('var n = 0\nvar last = 0', 'every frame {\n  n = n + 1\n  last = clock\n}'))).toBe(0)
  })
  it('a variable the picture reads repaints while it changes, then stops', () => {
    const doc = scene('var px = 50\nvar go = 1', 'object "B" {\n  x = px\n}\nevery frame {\n  if go == 1 {\n    px = px + 1\n  }\n}')
    const pl = new FlatPlayer(canvasOf(), doc, { audio: false, input: false })
    expect(paintsOver(pl, 20)).toBe(20)
    pl.setVar('go', 0)
    frames(3) // the interpolation between the last two steps settles
    paints = 0
    frames(20)
    expect(paints).toBe(0)
  })
  it('a state transition repaints until it has landed', () => {
    const doc = components(1, 'var open = 0\nevery frame {\n  if open == 1 {\n    P0.s = on\n  }\n}')
    const pl = new FlatPlayer(canvasOf(), doc, { audio: false, input: false })
    expect(paintsOver(pl, 10)).toBe(0)
    pl.setVar('open', 1)
    paints = 0
    frames(20)
    expect(paints).toBeGreaterThanOrEqual(19) // 12 frames at 24 fps = 0.5 s = 30 animation frames
    frames(40)
    paints = 0
    frames(20)
    expect(paints).toBe(0)
  })
  it('a spring repaints while it moves and rests when it has settled', () => {
    const doc = scene('var target = 0', '')
    const b = doc.layers[0].items[0] as { modifiers?: unknown }
    b.modifiers = { x: { kind: 'spring', target: '50 + target', stiffness: 0.2, damping: 0.5 } }
    const pl = new FlatPlayer(canvasOf(), doc, { audio: false, input: false })
    pl.play(); frames(120)
    paints = 0; frames(20)
    expect(paints).toBe(0)
    pl.setVar('target', 40)
    paints = 0; frames(10)
    expect(paints).toBeGreaterThanOrEqual(8) // every frame in which a step advanced it
    frames(600)
    paints = 0; frames(20)
    expect(paints).toBe(0)
  })
  it('the pointer and the keyboard repaint: hover feedback and `keys.` bindings stay live', () => {
    const h: Handlers = {}
    const pl = new FlatPlayer(canvasOf(h), scene('var n = 0', 'object "B" {\n  opacity = 1 - self.hovered * 0.5 - keys.Space * 0.2\n  when clicked {\n    n = n + 1\n  }\n}'), { audio: false })
    expect(paintsOver(pl, 10)).toBe(0)
    h.pointermove({ clientX: 50, clientY: 50, pointerId: 1 }) // onto B
    paints = 0; frames(1)
    expect(paints).toBe(1)
    h.pointermove({ clientX: 52, clientY: 50, pointerId: 1 }) // still on B: nothing changed
    paints = 0; frames(5)
    expect(paints).toBe(0)
    globalHandlers.keydown({ key: ' ', target: null, preventDefault: () => {} })
    paints = 0; frames(1)
    expect(paints).toBe(1)
    paints = 0; frames(10)
    expect(paints).toBe(0)
  })
  it('a font that finishes loading repaints a still scene: its text was drawn with the fallback face', () => {
    const fontEvents: Handlers = {}
    vi.stubGlobal('document', { fonts: { addEventListener: (t: string, f: (e: unknown) => void) => { fontEvents[t] = f }, removeEventListener: () => {} } })
    const pl = new FlatPlayer(canvasOf(), scene(''), { audio: false, input: false })
    expect(paintsOver(pl, 10)).toBe(0)
    fontEvents.loadingdone({})
    expect(paints).toBe(1)
  })
  it('a handler that changes the picture while it plays is painted on the next frame', () => {
    const h: Handlers = {}
    const pl = new FlatPlayer(canvasOf(h), scene('var px = 50', 'object "B" {\n  x = px\n  when pressed {\n    px = 120\n  }\n}'), { audio: false })
    expect(paintsOver(pl, 10)).toBe(0)
    h.pointerdown({ clientX: 50, clientY: 50, pointerId: 1 })
    paints = 0; frames(1)
    expect(paints).toBeGreaterThanOrEqual(1)
  })
})

describe('FlatPlayer — `maxPixelRatio` caps the backing store (flatink/flatink#46)', () => {
  const sized = (dpr: number, opts: { maxPixelRatio?: number }) => {
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: dpr })
    const c = canvasOf()
    new FlatPlayer(c, scene(''), { audio: false, input: false, ...opts })
    return [c.width, c.height]
  }
  it('uncapped by default: the device ratio as it is', () => {
    expect(sized(3, {})).toEqual([600, 300])
  })
  it('a 3x screen capped at 2 gets a 2x canvas', () => {
    expect(sized(3, { maxPixelRatio: 2 })).toEqual([400, 200])
  })
  it('a cap above the device ratio changes nothing', () => {
    expect(sized(1.5, { maxPixelRatio: 2 })).toEqual([300, 150])
  })
})
