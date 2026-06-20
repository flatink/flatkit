// End-to-end (preview -> recolor -> pixels) for docs/rfc-param-colors-in-gradients-and-tint.md: a symbol
// COLOR param can now drive a gradient STOP (`0:teinte@0.8`) and a TINT (`tint teinte <amount>`), not only a
// solid `fill <param>`. The gallery recolors by mutating `param.default` and re-resolving (a fresh player) --
// this test replays that path on skia-canvas and asserts the render actually changes (param is wired) while
// the gradient stays smooth. Lives here because the compiler package declares @flatkit/player + skia and we
// exercise the real `flatc --preview` path.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Canvas, Image, Path2D } from 'skia-canvas'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Doc, SymbolDef } from '@flatkit/types'
import { FlatPlayer } from '@flatkit/player'
import { run } from './cli/flatc'

const HALO = (fill: string, tint = '') => `symbol "Halo" {
  timeline 24 60
  params { color teinte = #ffe9a8 }
  layer "c" {
    group "g" at 0,0 pivot 0,0${tint} { layer "c" { circle 0 0 40 ${fill} } }
  }
}`

let tmp: string[] = []
async function preview(lib: string): Promise<Doc> {
  const src = join(tmpdir(), `flatkit-rfc-color-${tmp.length}.flat`)
  const out = src.replace(/\.flat$/, '.flatpack')
  writeFileSync(src, lib)
  tmp.push(src, out)
  expect(await run(['node', 'flatc', src, '--preview', '--symbol', 'Halo', '-o', out])).toBe(0)
  return JSON.parse(readFileSync(out, 'utf8')) as Doc
}

/** Render the doc with `teinte` recolored to `hex` (the gallery path: mutate the param default, re-resolve). */
function renderWith(base: Doc, hex: string): { px: Uint8ClampedArray; w: number; h: number } {
  const d = structuredClone(base)
  const sym = d.symbols!.find((s: SymbolDef) => s.params?.some((p) => p.name === 'teinte'))!
  sym.params!.find((p) => p.name === 'teinte')!.default = hex
  const w = d.width, h = d.height
  const c = new Canvas(w, h) as unknown as HTMLCanvasElement
  ;(c as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h }) as DOMRect
  const p = new FlatPlayer(c, d, { autoplay: false, input: false, audio: false } as never)
  p.seek(0); p.render()
  const ctx = (c as unknown as { getContext: (t: string) => { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } } }).getContext('2d')
  return { px: Uint8ClampedArray.from(ctx.getImageData(0, 0, w, h).data), w, h }
}
const mad = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length }
/** Count alpha transitions along the middle row — a soft gradient has many, a hard disk ~2. */
function alphaTransitions(px: Uint8ClampedArray, w: number, h: number): number {
  const row = Math.floor(h / 2) * w * 4
  let prev = -1, changes = 0
  for (let x = 0; x < w; x++) { const a = px[row + x * 4 + 3]; if (Math.abs(a - prev) > 4) { changes++; prev = a } }
  return changes
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).Path2D = Path2D
  ;(globalThis as Record<string, unknown>).Image = Image
  ;(globalThis as Record<string, unknown>).devicePixelRatio = 1
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {} })
  // A `tint` composites off-screen (compositeFiltered) — that path needs `document.createElement('canvas')`.
  // Back it with skia so the tint actually renders headlessly (else the player takes the no-isolation fallback).
  vi.stubGlobal('document', { createElement: (t: string) => (t === 'canvas' ? new Canvas(1, 1) : {}) })
})
afterEach(() => { vi.unstubAllGlobals(); for (const f of tmp) rmSync(f, { force: true }); tmp = [] })

describe('param colors (RFC) — a color param drives a gradient stop / a tint', () => {
  it('recoloring `teinte` changes a `radial(..., 0:teinte@0.8, 1:teinte@0)` and keeps it smooth', async () => {
    const doc = await preview(HALO('fill radial(0.5, 0.5, 0.5, 0:teinte@0.8, 1:teinte@0)'))
    const gold = renderWith(doc, '#ffe9a8')
    const blue = renderWith(doc, '#7ec8ff')
    expect(mad(gold.px, blue.px)).toBeGreaterThan(2) // the param is wired to the gradient
    expect(alphaTransitions(gold.px, gold.w, gold.h)).toBeGreaterThan(8) // a soft radial, not a hard disk
  })

  it('recoloring `teinte` changes a `tint teinte <amount>` on a sub-tree', async () => {
    const doc = await preview(HALO('fill #888888', ' tint teinte 0.7'))
    expect(mad(renderWith(doc, '#ff0000').px, renderWith(doc, '#00ff00').px)).toBeGreaterThan(2)
  })

  it('is deterministic: the same default renders identically (no per-frame drift)', async () => {
    const doc = await preview(HALO('fill radial(0.5, 0.5, 0.5, 0:teinte@0.8, 1:teinte@0)'))
    expect(mad(renderWith(doc, '#ffe9a8').px, renderWith(doc, '#ffe9a8').px)).toBe(0)
  })

  it('a literal hex gradient is unaffected by the param (non-regression)', async () => {
    const doc = await preview(HALO('fill radial(0.5, 0.5, 0.5, 0:#ffe9a8cc, 1:#ffe9a800)'))
    expect(mad(renderWith(doc, '#ffe9a8').px, renderWith(doc, '#7ec8ff').px)).toBe(0) // recolor does nothing to a hex gradient
  })
})
