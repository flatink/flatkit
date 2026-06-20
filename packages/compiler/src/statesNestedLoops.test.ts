// End-to-end (compile → play → pixels) for docs/rfc-states-vs-nested-loops.md (design A): a symbol's STATE
// pins its own pose, but the timelines NESTED inside it keep playing — a state can host a running loop /
// idle. Real-pixel harness (skia-canvas), the RFC §3 method: step the sim, render, compare PNG buffers at
// two instants (≠ ⇒ it animates). Lives here because the compiler package declares @flatkit/player + skia.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Canvas, Image, Path2D } from 'skia-canvas'
import { FlatPlayer } from '@flatkit/player'
import { compileFlatpack } from './compile'

// A cel-animated loop: rotates a square via keyframes (NOT an `expr` — we test the keyframe/timeline path,
// the one the state pin used to freeze; `clock`-driven motion already escaped the pin).
const SPIN = (name: string, dur: number, end: number) => `symbol "${name}" {
  timeline ${dur} ${dur}
  layer "c" {
    group "g" at 40,40 pivot 0,0 { layer "c" { rect -8 -8 16 16 4 fill #c9874a } }
    cel 0   tween ease linear { pose "g" rotate 0 }
    cel ${dur} tween ease linear { pose "g" rotate ${end} }
  }
}`
// Idle written as an expression on `clock` — the pre-existing half-escape (subtlety #2); guards no regression.
const SPIN_CLOCK = `symbol "SpinClock" {
  timeline 24 24
  layer "c" { group "g" at 40,40 pivot 0,0 expr rotation "clock*4" { layer "c" { rect -8 -8 16 16 4 fill #c9874a } } }
}`
// A state symbol that hosts a child instance, opacities cross-faded by the parent's own cels (state pose).
const HOST = (child: string) => `symbol "Host" {
  timeline 24 48
  states state { calme at 0  agite at 24  initial calme }
  layer "c" {
    instance "${child}" as "s"
    cel 0  { pose "s" opacity 1 }
    cel 24 { pose "s" opacity 1 }
  }
}`
// A state symbol that is a FROZEN pose (a wreck): no nested loop, just a region posed by the state. Must
// stay frozen — looping is opt-in (you put a sub-loop there), never imposed on every pose (subtlety #1).
const WRECK = `symbol "Wreck" {
  timeline 12 12
  states state { ok at 0  crashed at 12  initial crashed }
  layer "c" {
    group "g" at 40,40 pivot 0,0 { layer "c" { rect -8 -8 16 16 fill #6aa3e0 } }
    cel 0  tween ease linear { pose "g" rotate 0 }
    cel 12 tween ease linear { pose "g" rotate 90 }
  }
}`

const SCENE = (sym: string) => `size 80 80\nscene { layer "c" { instance "${sym}" as "p" } }`

function animates(prog: string, libs: string[]): boolean {
  const doc = compileFlatpack(prog, libs)
  const canvas = new Canvas(doc.width, doc.height) as unknown as HTMLCanvasElement
  ;(canvas as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => ({ width: doc.width, height: doc.height, left: 0, top: 0, right: doc.width, bottom: doc.height }) as DOMRect
  const player = new FlatPlayer(canvas, doc, { autoplay: false, input: false, audio: false } as never)
  const png = () => { player.render(); return (canvas as unknown as { toBufferSync: (f: string) => { equals(other: unknown): boolean } }).toBufferSync('png') }
  for (let i = 0; i < 3; i++) player.stepSim(1)
  const a = png()
  for (let i = 0; i < 8; i++) player.stepSim(1)
  const b = png()
  return !a.equals(b)
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).Path2D = Path2D
  ;(globalThis as Record<string, unknown>).Image = Image
  ;(globalThis as Record<string, unknown>).devicePixelRatio = 1
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {} })
})
afterEach(() => vi.unstubAllGlobals())

describe('states × nested loops (RFC design A) — a sub-loop plays under a pinned state', () => {
  it('Spin alone animates (control)', () => {
    expect(animates(SCENE('Spin'), [SPIN('Spin', 24, 360)])).toBe(true)
  })

  it('a stateless parent already animates its nested Spin (control)', () => {
    const parent = `symbol "Plain" { timeline 24 24  layer "c" { instance "Spin" as "s" } }`
    expect(animates(SCENE('Plain'), [SPIN('Spin', 24, 360), parent])).toBe(true)
  })

  it('a state-PINNED parent now animates its nested Spin (the fix)', () => {
    expect(animates(SCENE('Host'), [SPIN('Spin', 24, 360), HOST('Spin')])).toBe(true)
  })

  it('a frozen state with NO sub-loop stays frozen (looping is opt-in — the wreck)', () => {
    expect(animates(SCENE('Wreck'), [WRECK])).toBe(false)
  })

  it('a `clock`-driven idle still runs under the pin (no regression on subtlety #2)', () => {
    expect(animates(SCENE('Host'), [SPIN_CLOCK, HOST('SpinClock')])).toBe(true)
  })
})
