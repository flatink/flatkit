// flatink/flatink#35 — keyboard access, built in. `focusable` objects are reached with Tab / Shift+Tab,
// clicked with Enter or Space, and ringed by the player. The focus never traps: past the last object,
// Tab is left to the page.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FlatPlayer, type PlayerOptions } from './player'
import { playHeadless } from './headless'
import { parseProgramFull } from '@flatkit/engine/flatFormat'
import type { Doc } from '@flatkit/types'
import { IDENTITY } from '@flatkit/engine/transform'

type Handlers = Record<string, (e: unknown) => void>
let keys: Handlers
let boxes: number[][] // rectangles stroked by the player (the focus ring)
const canvasOf = (h: Handlers = {}) => {
  const ctx = new Proxy({}, {
    get: (_t, p) => p === 'strokeRect' ? (x: number, y: number, w: number, hh: number) => { boxes.push([x, y, w, hh]) }
      : p === 'roundRect' ? (x: number, y: number, w: number, hh: number) => { boxes.push([x, y, w, hh]) }
      : p === 'measureText' ? () => ({ width: 0 }) : p === 'getTransform' ? () => IDENTITY : () => {},
    set: () => true,
  }) as unknown as CanvasRenderingContext2D
  return {
    tabIndex: -1, style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 300, height: 100, left: 0, top: 0, right: 300, bottom: 100 }),
    addEventListener: (t: string, f: (e: unknown) => void) => { h[t] = f },
    removeEventListener: () => {}, setPointerCapture: () => {}, releasePointerCapture: () => {}, hasPointerCapture: () => false,
    getAttribute: () => null, setAttribute: () => {},
  } as unknown as HTMLCanvasElement & { tabIndex: number }
}

beforeEach(() => {
  keys = {}; boxes = []
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 })
  vi.stubGlobal('addEventListener', (t: string, f: (e: unknown) => void) => { keys[t] = f })
  vi.stubGlobal('removeEventListener', () => {})
  vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('Path2D', class { addPath() {} rect() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {} closePath() {} arc() {} ellipse() {} })
})
afterEach(() => vi.unstubAllGlobals())

const button = (name: string, x: number) => `    group "${name}" at ${x},50 {\n      layer "a" {\n        circle 0 0 20 fill #3366cc\n      }\n    }`
const clicks = (name: string, k: number, focus: string) => `object "${name}" {\n${focus ? `  ${focus}\n` : ''}  when clicked {\n    n = n * 10 + ${k}\n  }\n}`
/** A at 40 (order 2), B at 100 (unranked), C at 160 (order 1), D at 220 (not focusable), H at 280 (focusable, shown only when `shown`). */
const scene = (): Doc => parseProgramFull([
  'size 300 100', 'var n = 0', 'var shown = 0', 'scene {', '  layer "c" {',
  button('A', 40), button('B', 100), button('C', 160), button('D', 220), button('H', 280), '  }', '}',
  clicks('A', 1, 'focusable order 2'), clicks('B', 2, 'focusable'), clicks('C', 3, 'focusable order 1'), clicks('D', 4, ''),
  'object "H" {\n  focusable\n  opacity = shown\n  when clicked {\n    n = n * 10 + 5\n  }\n}', '',
].join('\n')) as unknown as Doc
const make = (opts: PlayerOptions = {}, h: Handlers = {}) => { const c = canvasOf(h); return { pl: new FlatPlayer(c, scene(), { audio: false, ...opts }), canvas: c, h } }
/** Presses a key through the real listener; returns whether the player consumed it. */
const press = (key: string, extra: Record<string, unknown> = {}): boolean => {
  let consumed = false
  keys.keydown({ key, target: null, preventDefault: () => { consumed = true }, ...extra })
  keys.keyup?.({ key, target: null, preventDefault: () => {} })
  return consumed
}

describe('FlatPlayer — Tab walks the focusable objects', () => {
  it('ranked ones first (lower `order` first), then the others in document order', () => {
    const { pl } = make()
    expect(pl.focused).toBeNull()
    const seen: (string | null)[] = []
    for (let i = 0; i < 3; i++) { expect(press('Tab')).toBe(true); seen.push(pl.focused) }
    expect(seen).toEqual(['C', 'A', 'B'])
  })
  it('past the last one the focus leaves the scene, and Tab is left to the page', () => {
    const { pl } = make()
    press('Tab'); press('Tab'); press('Tab')
    expect(press('Tab')).toBe(false)
    expect(pl.focused).toBeNull()
  })
  it('Shift+Tab walks back, entering at the last one', () => {
    const { pl } = make()
    expect(press('Tab', { shiftKey: true })).toBe(true)
    expect(pl.focused).toBe('B')
    press('Tab', { shiftKey: true }); press('Tab', { shiftKey: true })
    expect(pl.focused).toBe('C')
    expect(press('Tab', { shiftKey: true })).toBe(false)
    expect(pl.focused).toBeNull()
  })
  it('an object that is not shown is skipped, and reached once it is', () => {
    const { pl } = make()
    pl.setVar('shown', 1)
    for (let i = 0; i < 4; i++) press('Tab')
    expect(pl.focused).toBe('H')
  })
  it('only when the canvas has the focus of the page', () => {
    const c = canvasOf()
    vi.stubGlobal('document', { activeElement: {} })
    const pl = new FlatPlayer(c, scene(), { audio: false })
    expect(press('Tab')).toBe(false)
    expect(pl.focused).toBeNull()
    vi.stubGlobal('document', { activeElement: c })
    expect(press('Tab')).toBe(true)
    expect(pl.focused).toBe('C')
  })
})

describe('FlatPlayer — Enter and Space click the focused object', () => {
  it('fires its `when clicked`, and consumes the key', () => {
    const { pl } = make()
    press('Tab')
    expect(press('Enter')).toBe(true)
    expect(pl.getVar('n')).toBe(3) // C
    press('Tab')
    expect(press(' ')).toBe(true)
    expect(pl.getVar('n')).toBe(31) // then A
  })
  it('with nothing focused they do nothing, and are not consumed', () => {
    const { pl } = make()
    expect(press('Enter')).toBe(false)
    expect(pl.getVar('n')).toBe(0)
  })
  it('`self.focused` is 1 on that object and no other', () => {
    const { pl } = make()
    press('Tab')
    const state = (name: string) => (pl as unknown as { itemStateFor(id: string): { focused?: number } | undefined }).itemStateFor(idOf(pl, name))?.focused ?? 0
    expect([state('C'), state('A')]).toEqual([1, 0])
  })
  it('a headless script does the same with `key` gestures', () => {
    const res = playHeadless(scene(), [{ type: 'key', name: 'Tab' }, { type: 'key', name: 'Tab' }, { type: 'key', name: 'Enter' }])
    expect(res.vars.n).toBe(1) // C, then A, clicked
  })
})
const idOf = (pl: FlatPlayer, name: string): string => (pl as unknown as { doc: Doc }).doc.layers[0].items.find((it) => 'name' in it && it.name === name)!.id

describe('FlatPlayer — the focus ring', () => {
  it('frames the focused object, a few pixels out', () => {
    const { pl } = make()
    press('Tab'); boxes = []; pl.render()
    expect(boxes.length).toBeGreaterThanOrEqual(1)
    expect(boxes.at(-1)).toEqual([136, 26, 48, 48]) // C: a circle of radius 20 at (160, 50), 4 px out
  })
  it('nothing is framed when nothing is focused, or when the pointer takes over', () => {
    const h: Handlers = {}
    const { pl } = make({}, h)
    pl.render(); expect(boxes).toEqual([])
    press('Tab')
    h.pointerdown({ clientX: 40, clientY: 50, pointerId: 1 })
    expect(pl.focused).toBeNull()
    boxes = []; pl.render(); expect(boxes).toEqual([])
  })
  it('`noring` on the object, or `focusRing: false` on the player, leave the drawing to the scene', () => {
    const off = make({ focusRing: false })
    press('Tab'); boxes = []; off.pl.render()
    expect([off.pl.focused, boxes]).toEqual(['C', []])
    const doc = scene()
    ;(doc.layers[0].items.find((it) => 'name' in it && it.name === 'C') as { focusable: object }).focusable = { order: 1, noRing: true }
    const pl = new FlatPlayer(canvasOf(), doc, { audio: false })
    press('Tab'); boxes = []; pl.render()
    expect([pl.focused, boxes]).toEqual(['C', []])
  })
})

describe('FlatPlayer — the canvas takes part in the page\'s tab order', () => {
  it('a scene with focusable objects makes its canvas focusable; one without leaves it alone', () => {
    expect(make().canvas.tabIndex).toBe(0)
    const c = canvasOf()
    new FlatPlayer(c, parseProgramFull(`size 300 100\nscene {\n  layer "c" {\n${button('A', 40)}\n  }\n}\n`) as unknown as Doc, { audio: false })
    expect(c.tabIndex).toBe(-1)
  })
  it('when the canvas receives the focus, the first object takes it; when it loses it, none has it', () => {
    const h: Handlers = {}
    const { pl } = make({}, h)
    h.focus({})
    expect(pl.focused).toBe('C')
    h.blur({})
    expect(pl.focused).toBeNull()
  })
  it('reached backwards (Shift+Tab from what follows the canvas), the LAST object takes it', () => {
    const h: Handlers = {}
    const c = canvasOf(h)
    vi.stubGlobal('document', { activeElement: {} }) // the focus is on something else of the page
    const pl = new FlatPlayer(c, scene(), { audio: false })
    expect(press('Tab', { shiftKey: true })).toBe(false) // not ours: the page moves its focus…
    h.focus({}) // …onto the canvas
    expect(pl.focused).toBe('B')
  })
})
