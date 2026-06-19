// Perf benchmark for the player's hot paths (render resolution + every-frame eval). Run with:
//   node --import tsx packages/player/bench/render.bench.mts
// Prints ms/frame for a representative heavy scene. Use to catch perf regressions: a number that
// jumps between two runs of the same commit-range is a red flag. NOT a unit test (timing varies by
// machine); it's a relative measuring stick while optimizing.
import { parseProgramFull } from '@flatkit/engine/flatFormat'
import { renderLayers } from '../src/drawScene'
import { playHeadless } from '../src/headless'
import { IDENTITY } from '@flatkit/engine/transform'

// Minimal no-op canvas context that records nothing (we measure resolution + eval, not raster).
;(globalThis as Record<string, unknown>).Path2D = class { addPath() {} rect() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {} closePath() {} arc() {} ellipse() {} }
;(globalThis as Record<string, unknown>).DOMMatrix = class { a = 1; b = 0; c = 0; d = 1; e = 0; f = 0 }
const noopCtx = new Proxy({}, {
  get(_t, k: string) {
    if (k === 'canvas') return { width: 800, height: 600 }
    if (k === 'measureText') return () => ({ width: 10 })
    if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} })
    return () => {}
  },
  set: () => true,
}) as unknown as CanvasRenderingContext2D

// Heavy-ish representative scene: N named groups, each animated by channel expressions referencing
// time/clock/named objects, + an every-frame script with M statements (the sim interpreter path).
const N_GROUPS = 60
const M_STMTS = 120
function buildSrc(): string {
  const L: string[] = ['size 800 600', 'timeline 24 600']
  for (let i = 0; i < M_STMTS; i++) L.push(`var v${i} = 0`)
  L.push('scene {', '  layer "bg" { rect 0 0 800 600 fill #101020 }', '  layer "world" {')
  for (let i = 0; i < N_GROUPS; i++) {
    L.push(`    group "G${i}" at ${50 + (i % 12) * 60},${50 + Math.floor(i / 12) * 60} pivot 0,0 {`)
    L.push(`      layer "c" { circle 0 0 12 fill #ffcc00  path "M-8 -8L8 -8L8 8Z" fill #3366ff }`)
    L.push('    }')
  }
  L.push('  }', '}')
  // channel expressions on each group (x/y/rotation/opacity) — the cel/applyExprChannels path
  for (let i = 0; i < N_GROUPS; i++) {
    L.push(`object "G${i}" {`)
    L.push(`  x = ${50 + (i % 12) * 60} + sin(clock * 1.${i % 9} + ${i}) * 20`)
    L.push(`  y = ${50 + Math.floor(i / 12) * 60} + cos(clock * 0.7) * 10`)
    L.push(`  rotation = sin(clock + ${i}) * 0.5`)
    L.push(`  opacity = 0.5 + 0.5 * sin(clock * 2 + ${i})`)
    L.push('}')
  }
  // every-frame script: M statements doing arithmetic over vars + named refs
  L.push('every frame {')
  for (let i = 0; i < M_STMTS; i++) L.push(`  v${i} = v${i} + sin(clock * 0.${(i % 9) + 1}) + G${i % N_GROUPS}.x * 0.001`)
  L.push('}')
  return L.join('\n')
}

const doc = parseProgramFull(buildSrc()) as unknown as Parameters<typeof renderLayers>[1]

// Realistic scene expression context — named objects' channels + variables — exactly what the PLAYER
// threads to renderLayers as `rctx.expr`. WITHOUT it (`expr: undefined`) `applyExprChannels` has nothing
// to resolve and the bench misses the dominant cost of heavy scenes (every channel expr re-reading the
// scene-wide ctx). The channel exprs above reference `G<i>.x`, so those names must be present here.
const exprCtx: Record<string, unknown> = { mouse: { x: 0, y: 0, dx: 0, dy: 0, wheel: 0 } }
for (let i = 0; i < N_GROUPS; i++) exprCtx[`G${i}`] = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }
for (let i = 0; i < M_STMTS; i++) exprCtx[`v${i}`] = 0

function benchRender(frames: number): number {
  // resolve + draw (no-op ctx) per frame, advancing the frame each time
  const t0 = process.hrtime.bigint()
  for (let f = 0; f < frames; f++) {
    renderLayers(noopCtx, doc, (doc as { layers: unknown[] }).layers as never, f % 600, null, new Set(), { fps: 24, expr: exprCtx } as never, IDENTITY, 0)
  }
  return Number(process.hrtime.bigint() - t0) / 1e6
}

function benchSim(frames: number): number {
  const t0 = process.hrtime.bigint()
  playHeadless(doc as never, [{ type: 'wait', frames } as never])
  return Number(process.hrtime.bigint() - t0) / 1e6
}

// warm
benchRender(30); benchSim(30)
const RF = 600, SF = 600
const r = benchRender(RF)
const s = benchSim(SF)
console.log(`render: ${(r / RF).toFixed(4)} ms/frame  (${N_GROUPS} animated groups)`)
console.log(`sim:    ${(s / SF).toFixed(4)} ms/frame  (${M_STMTS} statements/frame)`)
console.log(`total:  ${((r / RF) + (s / SF)).toFixed(4)} ms/frame`)
