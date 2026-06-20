// End-to-end (preview → play → pixels) for docs/rfc-independent-playback.md: an INDEPENDENT (`loop`) nested
// instance runs on the runtime's monotone clock and its OWN duration, so it is IMMUNE to a shorter ancestor's
// loop wrap — the sub-loop is no longer truncated/reset mid-cycle. `once` plays through and holds its last
// frame. Real-pixel harness (skia-canvas), the RFC §3 method: drive the player via `seek`+`render`, then
// measure the "wrap step" (MAD between the last frame and frame 0) — a clean loop has a wrap step on the
// order of an ordinary inter-frame step; a truncated/snapped loop has a spike. Lives here because the
// compiler package declares @flatkit/player + skia, and we exercise the real `flatc --preview` path.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Canvas, Image, Path2D } from 'skia-canvas'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Doc } from '@flatkit/types'
import { FlatPlayer } from '@flatkit/player'
import { run } from './cli/flatc'

// A 48-frame sub-loop: a circle TRANSLATES right (cel 24) then back (cel 48 = cel 0). A translation (not a
// rotating square) is deliberate — a square's 90° symmetry would make a truncated mid-cycle frame resemble
// frame 0 and hide the very jump we measure (RFC §3 note).
const SLIDE = `symbol "Slide" {
  timeline 24 48
  layer "c" {
    group "g" at 0,0 pivot 0,0 { layer "c" { circle 0 0 8 fill #c9874a } }
    cel 0  tween ease linear { pose "g" at -20,0 }
    cel 24 tween ease linear { pose "g" at  20,0 }
    cel 48 tween ease linear { pose "g" at -20,0 }
  }
}`
// A parent SHORTER than (and not a multiple of) the sub-loop — the worst case for a synced graphic symbol.
const parent = (sym: string, dur: number, mode: string) =>
  `symbol "${sym}" {\n  timeline 24 ${dur}\n  layer "c" { instance "Slide" as "s"${mode} }\n}`

let tmp: string[] = []
async function preview(lib: string, sym: string): Promise<Doc> {
  const src = join(tmpdir(), `flatkit-rfc-indep-${sym}-${tmp.length}.flat`)
  const out = src.replace(/\.flat$/, '.flatpack')
  writeFileSync(src, lib)
  tmp.push(src, out)
  expect(await run(['node', 'flatc', src, '--preview', '--symbol', sym, '-o', out])).toBe(0)
  return JSON.parse(readFileSync(out, 'utf8')) as Doc
}
const durOf = (doc: Doc): number => doc.timeline?.durationFrames ?? 0

function player(doc: Doc): { px: (f: number) => Uint8ClampedArray; dur: number } {
  const c = new Canvas(doc.width, doc.height) as unknown as HTMLCanvasElement
  ;(c as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({ width: doc.width, height: doc.height, left: 0, top: 0, right: doc.width, bottom: doc.height }) as DOMRect
  const p = new FlatPlayer(c, doc, { autoplay: false, input: false, audio: false } as never)
  const ctx = (c as unknown as { getContext: (t: string) => { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } } }).getContext('2d')
  return {
    dur: durOf(doc),
    px: (f) => { p.seek(f); p.render(); return Uint8ClampedArray.from(ctx.getImageData(0, 0, doc.width, doc.height).data) },
  }
}
const mad = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length }

/** The wrap step as a multiple of the MEDIAN inter-frame step over the whole window (RFC §3 metric). */
function wrapRatio(doc: Doc): number {
  const { px, dur } = player(doc)
  const F = Array.from({ length: dur }, (_, f) => px(f))
  const steps: number[] = []
  for (let f = 1; f < dur; f++) steps.push(mad(F[f], F[f - 1]))
  const wrap = mad(F[dur - 1], F[0])
  steps.push(wrap)
  const med = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)] || 1
  return wrap / med
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).Path2D = Path2D
  ;(globalThis as Record<string, unknown>).Image = Image
  ;(globalThis as Record<string, unknown>).devicePixelRatio = 1
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {} })
})
afterEach(() => { vi.unstubAllGlobals(); for (const f of tmp) rmSync(f, { force: true }); tmp = [] })

describe('independent playback (RFC) — a sub-loop is immune to a shorter ancestor', () => {
  it('synced under a short parent JUMPS at the wrap (the bug being fixed — control)', async () => {
    const doc = await preview(`${SLIDE}\n${parent('Short', 24, '')}`, 'Short')
    expect(durOf(doc)).toBe(24) // no MovieClip descendant → window unchanged
    expect(wrapRatio(doc)).toBeGreaterThan(2.5) // last frame snaps back mid-cycle → spike
  })

  it('`loop` traverses its full cycle and loops CLEANLY, parent still `timeline 24 24`', async () => {
    const doc = await preview(`${SLIDE}\n${parent('Short', 24, ' loop')}`, 'Short')
    expect(durOf(doc)).toBe(48) // preview window extends to LCM(24,48) to SHOW the loop
    expect(wrapRatio(doc)).toBeLessThan(2.5) // clean seam, no LCM hacking of the parent's own duration
  })

  it('`once` plays through then HOLDS its last frame across the parent wraps', async () => {
    const doc = await preview(`${SLIDE}\n${parent('Host', 96, ' once')}`, 'Host')
    expect(durOf(doc)).toBe(96)
    const { px } = player(doc)
    expect(mad(px(8), px(20))).toBeGreaterThan(0) // still progressing within [0, 48)
    expect(mad(px(60), px(80))).toBe(0) // past frame 48 → frozen on the last frame
  })
})
