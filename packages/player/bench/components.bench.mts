// Perf benchmark for scenes built from COMPONENTS (instances of library symbols driven by params), the
// shape of a real activity rather than of a demo. Run with:
//   node --import tsx packages/player/bench/components.bench.mts
// Three questions, one line each:
//   - what does WRITING a param cost (`Inst.p = …` in `every frame`)?
//   - what does an instance with params cost to DRAW, in a scene with many named objects?
//   - what does a spring sitting in a library the scene does not use cost?
// NOT a unit test (timing varies by machine); a relative measuring stick while optimizing.
import { compileFlatpack } from '../../compiler/src/compile'
import { FlatPlayer } from '../src/player'

const g = globalThis as Record<string, unknown>
g.Path2D = class { addPath() {} rect() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {} closePath() {} arc() {} ellipse() {} }
g.DOMMatrix = class { a = 1; b = 0; c = 0; d = 1; e = 0; f = 0 }
g.window = { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1 }
g.addEventListener = () => {}
g.removeEventListener = () => {}
g.requestAnimationFrame = () => 0
g.cancelAnimationFrame = () => {}

let renders = 0
const noopCtx = new Proxy({}, {
  get(_t, k: string) {
    if (k === 'canvas') return { width: 800, height: 600 }
    if (k === 'clearRect') return () => { renders++ }
    if (k === 'measureText') return () => ({ width: 10 })
    if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} })
    return () => {}
  },
  set: () => true,
}) as unknown as CanvasRenderingContext2D
const canvas = { getContext: () => noopCtx, getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600 }), addEventListener() {}, removeEventListener() {}, style: {} } as unknown as HTMLCanvasElement

const N_INST = 40 // instances of the component
const N_NAMES = 300 // named groups elsewhere in the scene (what a real library brings along)

const LIB = `symbol "Pastille" {
  params { number v = 0 range 0 1 "level" }
  layer "a" {
    group "Halo" expr opacity "v" {
      layer "p" { circle 0 0 12 fill #ffcc00 }
    }
  }
}
`
const SPRING_LIB = `symbol "Jauge" {
  params { number niveau = 0 range 0 1 "level" }
  layer "a" {
    group "Aiguille" pivot 0,0 spring rotation "niveau * 2" stiffness 0.1 damping 0.3 {
      layer "p" { rect 0 -2 40 4 fill #000000 }
    }
  }
}
`
function program(writes: number): string {
  const L = ['size 800 600', 'timeline 24 600', 'scene {', '  layer "decor" {']
  for (let i = 0; i < N_NAMES; i++) L.push(`    group "D${i}" at ${(i % 30) * 26},${Math.floor(i / 30) * 26} { layer "c" { rect 0 0 20 20 fill #223344 } }`)
  L.push('  }', '  layer "world" {')
  for (let i = 0; i < N_INST; i++) L.push(`    instance "Pastille" as "P${i}" at ${40 + (i % 10) * 70},${400 + Math.floor(i / 10) * 40}`)
  L.push('  }', '}')
  if (writes) {
    L.push('every frame {')
    for (let i = 0; i < writes; i++) L.push(`  P${i}.v = (sin(clock * 3 + ${i}) + 1) / 2`)
    L.push('}')
  }
  return L.join('\n')
}

function run(src: string, libs: string[], frames: number): { ms: number; renders: number } {
  const pl = new FlatPlayer(canvas, compileFlatpack(src, libs), { input: false, audio: false })
  pl.stepSim(30) // warm
  renders = 0
  const t0 = process.hrtime.bigint()
  for (let f = 0; f < frames; f++) pl.stepSim(1)
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6 / frames, renders: renders / frames }
}

const F = 300
for (const k of [0, 1, 10, 40]) {
  const r = run(program(k), [LIB], F)
  console.log(`param writes/frame ${String(k).padStart(2)}: ${r.ms.toFixed(3)} ms/frame · ${r.renders.toFixed(1)} render(s)/frame`)
}
const plain = run(program(0), [LIB], F)
const withSpring = run(program(0), [LIB, SPRING_LIB], F)
console.log(`unused library with a spring: ${withSpring.ms.toFixed(3)} ms/frame (without it: ${plain.ms.toFixed(3)})`)
