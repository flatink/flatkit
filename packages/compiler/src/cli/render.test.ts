import { describe, it, expect } from 'vitest'
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
