// moiki-app/moiki-reloaded#135 — at the finger, every drag was cancelled. The canvas carried no
// `touch-action`, so the browser took the first movement for a scroll and sent `pointercancel`, which the
// player reads as a release: a sling shot fired at once (0 of 9 by finger, 9 of 9 by mouse), a label
// dragged onto a map never landed. Pointer capture does not help: `touch-action` decides first.
//
// The player now takes the gesture from the browser WHEN THE SCENE NEEDS IT, as it does for the wheel and
// the keys: `none` for a scene that drags, `manipulation` (taps, and the page still scrolls over it) for
// one that is only clicked, nothing for a scene with no pointer use at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Doc } from '@flatkit/types'
import { parseProgramFull } from '@flatkit/engine/flatFormat'

vi.mock('./drawScene', async (orig) => {
  const mod = await orig<typeof import('./drawScene')>()
  return { ...mod, renderLayers: () => {} }
})

const fakeCtx = () => new Proxy({}, { get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 }) : p === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
const fakeCanvas = (style: Record<string, string> = {}) => ({ getContext: () => fakeCtx(), getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 }), addEventListener: () => {}, removeEventListener: () => {}, style }) as unknown as HTMLCanvasElement
const stage = 'size 100 100\nvar a = 0\nvar b = 0\nscene { layer "l" { group "G" at 10,10 { layer "c" { rect 0 0 40 40 fill #cc3333 } } } }\n'
const doc = (behavior: string) => parseProgramFull(stage + behavior) as unknown as Doc

describe('FlatPlayer — `touch-action` on its canvas', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 })
    vi.stubGlobal('addEventListener', () => {}); vi.stubGlobal('removeEventListener', () => {})
    vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => vi.unstubAllGlobals())
  const mount = async (d: Doc, opts: Record<string, unknown> = {}, style: Record<string, string> = {}) => {
    const { FlatPlayer } = await import('./player')
    const canvas = fakeCanvas(style)
    return { pl: new FlatPlayer(canvas, d, opts), style: canvas.style as unknown as Record<string, string> }
  }

  const drags: [string, string][] = [
    ['an interactor', 'object "G" {\n  drag a, b\n}\n'],
    ['`when pressed`', 'object "G" { when pressed { a = 1 } }\n'],
    ['`when dragged`', 'object "G" { when dragged { a = 1 } }\n'],
    ['`when released`', 'object "G" { when released { a = 1 } }\n'],
    ['`when held`', 'object "G" { when held { a = 1 } }\n'],
    ['a scene that follows the pointer (`mouse.x`)', 'object "G" { x = mouse.x }\n'],
    ['a scene that reads the pointer\'s movement (`mouse.dy`)', 'every frame { a = a + mouse.dy }\n'],
  ]
  for (const [what, behavior] of drags)
    it(`${what}: \`none\` — the gesture belongs to the scene`, async () => {
      const { pl, style } = await mount(doc(behavior))
      expect(style.touchAction).toBe('none')
      pl.destroy()
    })

  it('a scene that is only CLICKED: `manipulation` — taps without the double-tap wait, and the page still scrolls over it', async () => {
    const { pl, style } = await mount(doc('object "G" { when clicked { a = 1 } }\n'))
    expect(style.touchAction).toBe('manipulation')
    pl.destroy()
  })
  it('a scene with no pointer use at all: the canvas is left alone', async () => {
    const { pl, style } = await mount(doc('every frame { a = a + 1 }\n'))
    expect(style.touchAction).toBeUndefined()
    pl.destroy()
  })
  it('`input: false`: left alone too — the player listens to nothing', async () => {
    const { pl, style } = await mount(doc('object "G" {\n  drag a, b\n}\n'), { input: false })
    expect(style.touchAction).toBeUndefined()
    pl.destroy()
  })
  it('`destroy()` takes back what the player set', async () => {
    const bare = await mount(doc('object "G" {\n  drag a, b\n}\n'))
    expect(bare.style.touchAction).toBe('none')
    bare.pl.destroy()
    expect(bare.style.touchAction).toBe('')
  })
  it('a canvas the HOST already styled is the host\'s: inline or by a CSS rule, the player leaves it', async () => {
    // A host that had worked around the defect (`touch-action: none` on every activity) sees no change — not
    // even `manipulation` on a scene that is only clicked, which would let its page scroll again.
    const inline = await mount(doc('object "G" { when clicked { a = 1 } }\n'), {}, { touchAction: 'none' })
    expect(inline.style.touchAction).toBe('none')
    inline.pl.load(doc('object "G" {\n  drag a, b\n}\n'))
    inline.pl.destroy()
    expect(inline.style.touchAction).toBe('none')
    vi.stubGlobal('getComputedStyle', () => ({ touchAction: 'pan-y' }))
    const byRule = await mount(doc('object "G" {\n  drag a, b\n}\n'))
    expect(byRule.style.touchAction).toBeUndefined()
    byRule.pl.destroy()
  })
  it('…a computed `auto` is no decision: the player sets its own', async () => {
    vi.stubGlobal('getComputedStyle', () => ({ touchAction: 'auto' }))
    const { pl, style } = await mount(doc('object "G" {\n  drag a, b\n}\n'))
    expect(style.touchAction).toBe('none')
    pl.destroy()
  })
  it('`load()` follows the new document', async () => {
    const { pl, style } = await mount(doc('object "G" { when clicked { a = 1 } }\n'))
    pl.load(doc('object "G" {\n  drag a, b\n}\n'))
    expect(style.touchAction).toBe('none')
    pl.load(doc('every frame { a = a + 1 }\n'))
    expect(style.touchAction).toBe('')
    pl.destroy()
  })
  it('the host decides otherwise with `touchAction`: a value, or `false` to keep its own', async () => {
    const forced = await mount(doc('object "G" {\n  drag a, b\n}\n'), { touchAction: 'pan-y' }, { touchAction: 'none' })
    expect(forced.style.touchAction).toBe('pan-y') // over the host's own style too: the option is the host speaking
    forced.pl.destroy()
    expect(forced.style.touchAction).toBe('none')
    const kept = await mount(doc('object "G" {\n  drag a, b\n}\n'), { touchAction: false }, { touchAction: 'pinch-zoom' })
    expect(kept.style.touchAction).toBe('pinch-zoom')
    kept.pl.destroy()
    expect(kept.style.touchAction).toBe('pinch-zoom')
  })
  it('a canvas with no `style` (a Node stub) is not a problem', async () => {
    const { FlatPlayer } = await import('./player')
    const canvas = { ...fakeCanvas(), style: undefined } as unknown as HTMLCanvasElement
    expect(() => new FlatPlayer(canvas, doc('object "G" {\n  drag a, b\n}\n')).destroy()).not.toThrow()
  })
})
