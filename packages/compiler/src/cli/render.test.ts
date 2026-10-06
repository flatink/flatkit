import { describe, it, expect, vi } from 'vitest'
import { FlatPlayer } from '@flatkit/player'
import { createRenderer, renderDocToPng } from './render'
import { compileFlatpack } from '../compile'

// Every consumer that needed more than one image reimplemented this on top of the player: four harnesses
// across two neighbouring repos, ~430 lines, each rediscovering the same DOM shims. The reason was
// always the same — the only thing on offer rendered ONE frame and paid the whole setup each time.
const DOOR = `symbol "Door" {
  params { color panel = #884422 "Panel colour" }
  timeline 24 24
  states door { closed at 0   open at 24   initial closed   transition 12 ease easeInOut }
  layer "p" {
    group "Panel" at 60,10 pivot 0,0 { layer "art" { rect 0 0 40 80 fill panel } }
    cel 0 tween { pose "Panel" rotate 0 }
    cel 24      { pose "Panel" rotate 80 }
  }
}`

const PROGRAM = `size 200 200
background #ffffff
timeline 24 48

scene {
  layer "a" {
    instance "Door" as "Front" at 60,60
    group "Blob" at 100,150 { layer "c" { circle 0 0 20 fill #ff0000 filter blur 4 } }
  }
}

object "Blob" {
  dx = 20 * sin(clock)
}
`

const doc = () => compileFlatpack(PROGRAM, [DOOR])
const png = (bytes: Uint8Array) => Buffer.from(bytes)

describe('createRenderer — the setup is paid once, not once per frame', () => {
  it('renders many frames from one open renderer, and they differ', async () => {
    const r = await createRenderer(doc())
    try {
      const a = png(await r.frame(0))
      const b = png(await r.frame(12))
      expect(a.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a') // PNG magic
      expect(a.equals(b), 'frame 0 and frame 12 came out identical — the timeline did not advance').toBe(false)
      expect(r.width).toBe(400) // 200 at the default scale of 2
      expect(r.height).toBe(400)
    } finally {
      r.close()
    }
  }, 60_000)

  it('close() puts the globals back, so a renderer leaves no trace', async () => {
    const before = typeof (globalThis as Record<string, unknown>).document
    const r = await createRenderer(doc())
    expect(typeof (globalThis as Record<string, unknown>).document).toBe('object') // installed while open
    r.close()
    expect(typeof (globalThis as Record<string, unknown>).document).toBe(before)
  }, 60_000)

  it('a closed renderer refuses another frame instead of drawing on a dead player', async () => {
    const r = await createRenderer(doc())
    r.close()
    await expect(r.frame(0)).rejects.toThrow(/closed/)
  }, 60_000)

  it('`renderDocToPng` still works, and is the one-shot form of the same thing', async () => {
    const out = png(await renderDocToPng(doc(), { frame: 0 }))
    expect(out.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  }, 60_000)
})

// Rendering a program could only override document `var`s, so previewing a door in its `open` state
// meant writing a harness that mutated the symbol's defaults by hand. That is one of the four.
describe('params at render time', () => {
  it('a symbol state changes the image', async () => {
    const shut = png(await renderDocToPng(doc(), { frame: 0 }))
    const open = png(await renderDocToPng(doc(), { frame: 0, params: { door: 'open' } }))
    expect(shut.equals(open), 'setting the door state changed nothing').toBe(false)
  }, 60_000)

  it('a colour param changes the image too', async () => {
    const a = png(await renderDocToPng(doc(), { frame: 0 }))
    const b = png(await renderDocToPng(doc(), { frame: 0, params: { panel: '#00ff00' } }))
    expect(a.equals(b)).toBe(false)
  }, 60_000)

  it('an unknown param name is reported, not silently ignored', async () => {
    const errs: string[] = []
    const spy = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((s: string) => { errs.push(String(s)); return true }) as typeof process.stderr.write
    try {
      await renderDocToPng(doc(), { frame: 0, params: { nope: '1' } })
    } finally {
      process.stderr.write = spy
    }
    expect(errs.join('')).toMatch(/no symbol exposes a param named "nope"/)
  }, 60_000)
})

// Reported by a consumer rendering video frames in Node: an opaque shape much larger than the canvas,
// moved by its group so that it covers only part of the frame, wiped the background behind it — more than
// half of the picture came out transparent. skia-canvas 3.x discards "the vector shapes below" a fill that
// covers the canvas, and decides it from the path's LOCAL bounds, before the context transform. Browsers
// are not concerned; skia-canvas 4 is fixed. This repository now tests on version 4, where these pass with
// or without the player's guard: they exercise it only when run against skia-canvas 3 (still accepted).
describe('rendering — a large opaque shape, offset by its group, does not wipe what is behind it', () => {
  const frame = async (shape: string) => {
    const src = `size 960 540\nbackground #0b0f1a\ntimeline 30 30\n\nscene {\n  layer "a" {\n    group "G" at 0,0 pivot 0,0 {\n      layer "c" {\n        ${shape}\n      }\n    }\n  }\n}\nobject "G" {\n  dx = 600\n  dy = 300\n}\n`
    const skiaPkg = 'skia-canvas'
    const { loadImage, Canvas } = (await import(skiaPkg)) as { loadImage: (b: Buffer) => Promise<{ width: number; height: number }>; Canvas: new (w: number, h: number) => { getContext(t: '2d'): CanvasRenderingContext2D } }
    const img = await loadImage(png(await renderDocToPng(compileFlatpack(src), { scale: 1 })))
    const g = new Canvas(img.width, img.height).getContext('2d')
    g.drawImage(img as unknown as CanvasImageSource, 0, 0)
    return (x: number, y: number) => [...g.getImageData(x, y, 1, 1).data]
  }
  for (const [name, shape] of [['a rounded rectangle', 'rect -200 -200 2400 1500 60 fill #c9d0db'], ['a plain rectangle', 'rect -200 -200 2400 1500 fill #c9d0db'], ['a polygon written as a path', 'path "M-200 -200 L2200 -200 L2200 1300 L-200 1300 Z" fill #c9d0db']] as const) {
    it(`${name}: the background shows where the shape is not`, async () => {
      const at = await frame(shape)
      expect(at(100, 50)).toEqual([11, 15, 26, 255]) // left of and above the shape: background
      expect(at(900, 500)).toEqual([201, 208, 219, 255]) // inside the shape
    })
  }

  // The first guard covered solid fills only, so a gradient sky larger than the frame, under a camera,
  // still wiped the picture. The reference is the same shape started one unit to the right: its local
  // bounds no longer contain the canvas, so the renderer's shortcut never fires on it.
  const GRADIENTS = [['a linear gradient', 'linear(90, 0:#c9d0db, 1:#4a90e2)'], ['a radial gradient', 'radial(0.5, 0.5, 0.7, 0:#c9d0db, 1:#4a90e2)']] as const
  for (const [fillName, fill] of GRADIENTS) {
    for (const [name, radius] of [['a rounded rectangle', ' 60'], ['a plain rectangle', '']] as const) {
      it(`${name} filled with ${fillName}: the background shows, and the gradient is the one it would be`, async () => {
        const at = await frame(`rect -200 -200 2400 1500${radius} fill ${fill}`)
        const ref = await frame(`rect -199 -200 2399 1500${radius} fill ${fill}`)
        expect(at(100, 50)).toEqual([11, 15, 26, 255]) // left of and above the shape: background
        for (const [x, y] of [[450, 150], [700, 320], [900, 500]] as const) {
          const got = at(x, y), want = ref(x, y)
          expect(got[3], `the gradient is not opaque at ${x},${y}`).toBe(255)
          for (let k = 0; k < 3; k++) expect(Math.abs(got[k] - want[k]), `channel ${k} at ${x},${y}: ${got} for ${want}`).toBeLessThanOrEqual(2)
        }
      })
    }
  }
})

// flatink/flatink#38 — to LOOK at a state reached by playing (third right answer, piece dropped, level 2),
// rendering only started from the initial values: every picture cost a copy of the program with other
// `var`s, dozens of times per activity. The replay and the renderer drive the same player; nothing joined them.
describe('rendering after a gesture script', () => {
  const SRC = `size 200 100
background #ffffff
var lit = 0
var count = 0
scene {
  layer "a" {
    group "Button" at 50,50 { layer "c" { rect -30 -30 60 60 fill #3366cc } }
    group "Lamp" at 150,50 { layer "c" { rect -30 -30 60 60 fill #cc3333 } }
  }
}
object "Button" { when clicked { lit = 1
  count = count + 1
  send "on" } }
object "Lamp" { opacity = lit }
`
  const pixel = async (bytes: Uint8Array, x: number, y: number) => {
    const skiaPkg = 'skia-canvas'
    const { loadImage, Canvas } = (await import(skiaPkg)) as { loadImage: (b: Buffer) => Promise<{ width: number; height: number }>; Canvas: new (w: number, h: number) => { getContext(t: '2d'): CanvasRenderingContext2D } }
    const img = await loadImage(png(bytes))
    const g = new Canvas(img.width, img.height).getContext('2d')
    g.drawImage(img as unknown as CanvasImageSource, 0, 0)
    return [...g.getImageData(x, y, 1, 1).data]
  }
  const WHITE = [255, 255, 255, 255], RED = [204, 51, 51, 255]

  it('`play` replays gestures on the renderer, `capture` draws the scene as they left it', async () => {
    const r = await createRenderer(compileFlatpack(SRC), { scale: 1, interactive: true })
    try {
      expect(await pixel(await r.capture(), 150, 50)).toEqual(WHITE) // the lamp is off
      const res = r.play([{ type: 'tap', target: 'Button' }])
      expect(res.sends.map((e) => e.name)).toEqual(['on'])
      expect(await pixel(await r.capture(), 150, 50)).toEqual(RED) // …and on, in the picture
    } finally { r.close() }
  }, 60_000)

  it('a script in several calls keeps going where it was (one `expect` window, one state)', async () => {
    const r = await createRenderer(compileFlatpack(SRC), { scale: 1, interactive: true })
    try {
      r.play([{ type: 'tap', target: 'Button' }])
      const res = r.play([{ type: 'tap', target: 'Button' }, { type: 'expect', vars: { count: 3 } }])
      expect(res.expectFailures).toEqual(['expect: count expected 3, got 2'])
    } finally { r.close() }
  }, 60_000)

  it('`renderDocToPng` takes a `script`: replayed after the seek, before the capture', async () => {
    const off = await renderDocToPng(compileFlatpack(SRC), { scale: 1 })
    const on = await renderDocToPng(compileFlatpack(SRC), { scale: 1, script: [{ type: 'tap', target: 'Button' }] })
    expect(await pixel(off, 150, 50)).toEqual(WHITE)
    expect(await pixel(on, 150, 50)).toEqual(RED)
  }, 60_000)

  it('a renderer that was not opened for it refuses to play, and says how', async () => {
    const r = await createRenderer(compileFlatpack(SRC), { scale: 1 })
    try { expect(() => r.play([{ type: 'tap', target: 'Button' }])).toThrow(/interactive: true/) } finally { r.close() }
  }, 60_000)
})

// Found by comparing a consumer's slides between 0.37.1 and 0.39.0: packs identical to the byte, and two
// slides in 61 rendered differently — by one to three levels in 255, on scenes with `filter blur`, masks
// and `blend`. The renderer had started drawing a plain frame TWICE before capturing it, and a second draw
// goes through the filter cache: not the same pixels as the first. Invisible, but a render is compared to
// the byte by the people who make videos with it.
describe('rendering — a plain frame is drawn once', () => {
  const doc = () => compileFlatpack(PROGRAM, [DOOR])
  it('`frame()` without a script draws exactly what the seek draws', async () => {
    const r = await createRenderer(doc())
    const spy = vi.spyOn(FlatPlayer.prototype, 'render')
    try {
      await r.frame(3)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally { spy.mockRestore(); r.close() }
  }, 60_000)
  it('a replayed script is drawn again before the capture: what it changed must be in the picture', async () => {
    const r = await createRenderer(doc(), { interactive: true })
    const spy = vi.spyOn(FlatPlayer.prototype, 'render')
    try {
      await r.frame(3, { script: [{ type: 'wait', frames: 2 }] })
      expect(spy.mock.calls.length).toBeGreaterThan(1)
    } finally { spy.mockRestore(); r.close() }
  }, 60_000)
})

// A replayed script painted the whole scene at every synthetic event — twice for a move (the move itself,
// then its step): one `scratch` on a 300-object scene took 4.8 s to render, for one picture at the end.
describe('rendering after a script paints once, at the capture', () => {
  it('replaying 200 moves and a `scratch` paints nothing until the capture, which paints once', async () => {
    const skiaPkg = 'skia-canvas'
    const skia = (await import(skiaPkg)) as { CanvasRenderingContext2D: { prototype: { clearRect: (...a: number[]) => void } } }
    const src = 'size 600 400\nvar seen = 0\nvar t = 0\nscene {\n  layer "top" {\n    group "Cover" at 0,0 { layer "a" { rect 0 0 600 400 fill #888888 } }\n  }\n}\nobject "Cover" { reveal seen }\nevery frame { t = t + 1 }\n'
    const r = await createRenderer(compileFlatpack(src), { scale: 1, interactive: true })
    const paints = vi.spyOn(skia.CanvasRenderingContext2D.prototype, 'clearRect')
    try {
      r.play([...Array.from({ length: 200 }, (_, k) => ({ type: 'move' as const, x: 10 + k, y: 10 })), { type: 'scratch', target: 'Cover' }])
      expect(paints).toHaveBeenCalledTimes(0)
      await r.capture()
      expect(paints).toHaveBeenCalledTimes(1)
    } finally { paints.mockRestore(); r.close() }
  }, 60_000)
})

// flatink/flatink#20 — a stroke is drawn in the shape's own space, so a shape STRETCHED by `scaleX = 4` had
// vertical sides four times as thick as its horizontal ones. `stroke … fixed` keeps the width in scene units,
// whatever the shape's scale (SVG's non-scaling-stroke) — and still follows the view's zoom.
describe('rendering — `stroke … fixed` keeps its width on a stretched shape', () => {
  const thickness = async (fixed: boolean) => {
    const src = `size 400 120\nbackground #ffffff\n\nscene {\n  layer "c" {\n    group "E" at 20,30 pivot 0,0 {\n      layer "a" {\n        rect 0 0 60 30 nofill stroke #000000 4${fixed ? ' fixed' : ''}\n      }\n    }\n  }\n}\nobject "E" {\n  scaleX = 4\n}\n`
    const skiaPkg = 'skia-canvas'
    const { loadImage, Canvas } = (await import(skiaPkg)) as { loadImage: (b: Buffer) => Promise<{ width: number; height: number }>; Canvas: new (w: number, h: number) => { getContext(t: '2d'): CanvasRenderingContext2D } }
    const img = await loadImage(png(await renderDocToPng(compileFlatpack(src), { scale: 1 })))
    const g = new Canvas(img.width, img.height).getContext('2d')
    g.drawImage(img as unknown as CanvasImageSource, 0, 0)
    const dark = (x: number, y: number) => g.getImageData(x, y, 1, 1).data[0]! < 128
    let across = 0, down = 0
    for (let x = 0; x < 60; x++) if (dark(x, 45)) across++ // through the LEFT side (x = 20, stretched)
    for (let y = 20; y < 45; y++) if (dark(150, y)) down++ // through the TOP side (y = 30)
    return { across, down }
  }
  it('without it, the stretched side is about four times thicker', async () => {
    const t = await thickness(false)
    expect(t.across).toBeGreaterThanOrEqual(3 * t.down)
  })
  it('with it, both sides are the same width', async () => {
    const t = await thickness(true)
    expect(Math.abs(t.across - t.down)).toBeLessThanOrEqual(1)
    expect(t.down).toBeGreaterThanOrEqual(3)
  })
})
