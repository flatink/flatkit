// -----------------------------------------------------------------------------
//  headless.ts -- plays a Doc WITHOUT a real canvas and replays a gesture SCRIPT.
//
//  Automatable verification of interactions (CI, LLM loop): we instantiate the
//  `FlatPlayer` on a fake canvas (client coords = scene coords, scale 1), fire
//  synthetic PointerEvents, and collect the emitted `send`s plus the final state
//  of the variables. Pure Node: stubs the missing DOM globals.
// -----------------------------------------------------------------------------
import { FlatPlayer } from './player'
import { itemBoundsByName, dropZoneBounds } from '@flatkit/engine/groups'
import { isGroup } from '@flatkit/engine/layers'
import type { Doc, Item } from '@flatkit/types'
export type { Gesture } from './player' // defined on the player side (reused by `--record`)
import type { Gesture } from './player'

type Box = { minX: number; minY: number; maxX: number; maxY: number }
/** Cap on the moves a `scratch` synthesizes (anti-DoS: a huge bbox / tiny brush must not blow up). */
const MAX_SWEEP = 2000

/** First named item matching `name` (walks groups). Used to find the reveal interactor's brush. */
function findItemByName(items: Item[], name: string): Item | null {
  for (const it of items) {
    if ('name' in it && it.name === name) return it
    if (isGroup(it)) for (const l of it.layers) { const r = findItemByName(l.items, name); if (r) return r }
  }
  return null
}
/** Brush radius (= grid) of the `reveal` interactor on a named target; default 24 if none. */
function revealBrushFor(doc: Doc, name: string): number {
  let id: string | null = null
  for (const l of doc.layers) { const it = findItemByName(l.items, name); if (it) { id = it.id; break } }
  const inter = id ? doc.interactors?.find((x) => x.targetId === id) : undefined
  return inter?.grid && inter.grid > 0 ? inter.grid : 24
}
/** The `turn`/`turnDeg` interactor on a named target: its WORLD pivot + unit (deg/rad), or null if none. */
function turnTargetFor(doc: Doc, name: string): { pivot: { x: number; y: number }; deg: boolean } | null {
  let id: string | null = null
  for (const l of doc.layers) { const it = findItemByName(l.items, name); if (it) { id = it.id; break } }
  const inter = id ? doc.interactors?.find((x) => x.targetId === id) : undefined
  if (!inter || (inter.axis !== 'turn' && inter.axis !== 'turnDeg')) return null
  return { pivot: inter.pivot ?? { x: 0, y: 0 }, deg: inter.axis === 'turnDeg' }
}
/** Boustrophedon sweep over `b` at ~`brush` spacing (cell centers), bounded to MAX_SWEEP points. */
function sweepPoints(b: Box, brush: number): { x: number; y: number }[] {
  const w = b.maxX - b.minX, h = b.maxY - b.minY
  let step = Math.max(1, brush)
  let cols = Math.max(1, Math.ceil(w / step)), rows = Math.max(1, Math.ceil(h / step))
  if (cols * rows > MAX_SWEEP) { // too fine -> coarsen to stay bounded (coverage may be < 1; documented)
    const f = Math.sqrt((cols * rows) / MAX_SWEEP)
    step *= f; cols = Math.max(1, Math.ceil(w / step)); rows = Math.max(1, Math.ceil(h / step))
  }
  const pts: { x: number; y: number }[] = []
  for (let r = 0; r < rows; r++) {
    const y = Math.min(b.maxY, b.minY + (r + 0.5) * step)
    const cs = Array.from({ length: cols }, (_v, c) => c)
    if (r % 2) cs.reverse() // zig-zag: continuous stroke, no jump back to the left edge
    for (const c of cs) pts.push({ x: Math.min(b.maxX, b.minX + (c + 0.5) * step), y })
  }
  return pts
}

export type PlayResult = {
  sends: { name: string; value?: number | string }[]
  vars: Record<string, number | number[]>
  steps?: TraceStep[] // present if `trace`: one record per gesture (inspection / debug-player)
  expectFailures?: string[] // mismatches reported by the `expect` gestures (empty/absent = all verified) -> exit != 0 in CLI
}

/** Trace of ONE gesture: its description, the `send`s emitted during it, and the variable diff. */
export type TraceStep = {
  gesture: string
  sends: { name: string; value?: number | string }[]
  changed: Record<string, [number | number[] | undefined, number | number[]]> // var -> [before, after]
}

type Handlers = Record<string, (e: { clientX: number; clientY: number; pointerId: number }) => void>

const fakeCtx = (): CanvasRenderingContext2D =>
  new Proxy({}, {
    get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 }) : p === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : () => {}),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D

const fakeCanvas = (handlers: Handlers, w: number, h: number): HTMLCanvasElement => ({
  getContext: () => fakeCtx(),
  getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h }),
  addEventListener: (type: string, fn: Handlers[string]) => { handlers[type] = fn },
  removeEventListener: (type: string) => { delete handlers[type] },
  setPointerCapture: () => {},
  releasePointerCapture: () => {},
  style: {},
} as unknown as HTMLCanvasElement)

/** Stubs the missing DOM globals (pure Node); returns a restore function. */
function ensureDomGlobals(): () => void {
  const g = globalThis as Record<string, unknown>
  const undo: (() => void)[] = []
  const set = (k: string, v: unknown) => { if (g[k] === undefined) { g[k] = v; undo.push(() => { delete g[k] }) } }
  set('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 })
  set('requestAnimationFrame', () => 0)
  set('cancelAnimationFrame', () => {})
  set('addEventListener', () => {})
  set('removeEventListener', () => {})
  return () => undo.forEach((f) => f())
}

/** Describes a gesture for the trace. */
const describeGesture = (g: Gesture): string =>
  g.type === 'drag' ? `drag ${g.source}->${g.target}` : g.type === 'tap' ? `tap ${g.target}`
    : g.type === 'connect' ? `connect ${g.source}->${g.target}` : g.type === 'scratch' ? `scratch ${g.target}`
      : g.type === 'turn' ? `turn ${g.target} ${g.angle}` : g.type === 'set' ? `set ${g.name}=${g.value}`
        : g.type === 'wait' ? `wait ${g.frames}` : g.type === 'expect' ? 'expect' : `${g.type} (${g.x},${g.y})`

/** Plays `doc`, replays `gestures`, returns the collected `send`s plus the final state of the variables.
 *  `trace`: adds `steps` (sends + variable diff PER gesture) -- for inspection / the debug-player. */
export function playHeadless(doc: Doc, gestures: Gesture[], opts: { trace?: boolean } = {}): PlayResult {
  const restore = ensureDomGlobals()
  const handlers: Handlers = {}
  const sends: PlayResult['sends'] = []
  const pl = new FlatPlayer(fakeCanvas(handlers, doc.width, doc.height), doc, { input: true, padding: 0, render: false, onEvent: (e) => sends.push(e) })
  const ev = (x: number, y: number, id = 1) => ({ clientX: x, clientY: y, pointerId: id })
  const fire = (type: string, p: { x: number; y: number }, id = 1) => { const h = handlers[`pointer${type}`]; if (h) h(ev(p.x, p.y, id)) }
  // GRAB: the RESOLVED position of the object (expressions included -> we touch the object exactly where it is).
  const grabPoint = (name: string): { x: number; y: number } => {
    const c = pl.objectCenter(name)
    if (c) return c
    const b = itemBoundsByName(doc, name)
    if (!b) throw new Error(`gesture: object "${name}" not found in the scene`)
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
  }
  // DROP: center of the drop zone (static bbox / hitbox) -- that is what the drop is tested against.
  const dropPoint = (name: string): { x: number; y: number } => {
    const b = dropZoneBounds(doc, name)
    if (!b) throw new Error(`gesture: zone "${name}" not found in the scene`)
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
  }
  // `expect`: self-verified assertions. `sendCursor` = window of sends SINCE the last `expect`.
  let sendCursor = 0
  const expectFailures: string[] = []
  const applyGesture = (g: Gesture): void => {
    if (g.type === 'set') { pl.setVar(g.name, g.value); return }
    if (g.type === 'wait') { pl.stepSim(g.frames); return }
    if (g.type === 'drag') { const id = g.id ?? 1, t = dropPoint(g.target); fire('down', grabPoint(g.source), id); fire('move', t, id); fire('up', t, id); return }
    if (g.type === 'tap') { const id = g.id ?? 1, c = grabPoint(g.target); fire('down', c, id); fire('up', c, id); return }
    if (g.type === 'connect') { const id = g.id ?? 1, t = grabPoint(g.target); fire('down', grabPoint(g.source), id); fire('move', t, id); fire('up', t, id); return } // pull a link wire source -> target
    if (g.type === 'scratch') { // sweep the reveal target's bbox so its coverage reaches ~1
      const id = g.id ?? 1
      const b = itemBoundsByName(doc, g.target)
      if (!b) throw new Error(`gesture: object "${g.target}" not found in the scene`)
      const pts = sweepPoints(b, revealBrushFor(doc, g.target))
      fire('down', pts[0], id)
      for (let i = 1; i < pts.length; i++) fire('move', pts[i], id)
      fire('up', pts[pts.length - 1], id)
      return
    }
    if (g.type === 'turn') { // rotate a turn/turnDeg target by `angle` around its WORLD pivot, swept in <=maxStep sub-moves
      const id = g.id ?? 1
      const ti = turnTargetFor(doc, g.target)
      if (!ti) throw new Error(`gesture: object "${g.target}" has no turn/turnDeg interactor`)
      const start = grabPoint(g.target) // a point ON the object -> starts the grab (fires `when pressed`); the angle is written on the first MOVE
      const piv = ti.pivot
      const R = Math.max(24, Math.hypot(start.x - piv.x, start.y - piv.y)) // radius to place the rotating pointer (only the ANGLE matters, not R)
      const at = (v: number) => { const rad = ti.deg ? (v * Math.PI) / 180 : v; return { x: piv.x + R * Math.cos(rad), y: piv.y + R * Math.sin(rad) } } // target value (deg/rad) -> pointer position
      const maxStep = ti.deg ? 60 : Math.PI / 3 // <= per sub-move: keeps each delta small (under the atan2 wrap / typical author jump-guards) so multi-turn works
      const N = Math.max(2, Math.ceil(Math.abs(g.angle) / maxStep))
      const settle = g.settle ?? 1
      fire('down', start, id)
      for (let k = 1; k <= N; k++) { fire('move', at((g.angle * k) / N), id); if (settle > 0) pl.stepSim(settle) } // sweep; advance the sim so a delta-accumulating `every frame` integrates each sub-step
      fire('up', at(g.angle), id)
      return
    }
    if (g.type === 'expect') {
      const got = sends.slice(sendCursor).map((s) => s.name) // sequence of send names emitted since the last expect
      sendCursor = sends.length
      if (g.sends && JSON.stringify(got) !== JSON.stringify(g.sends)) expectFailures.push(`expect: expected sends [${g.sends.join(', ')}], received [${got.join(', ')}]`)
      if (g.vars) for (const [k, v] of Object.entries(g.vars)) { const cur = pl.getVar(k); if (JSON.stringify(cur) !== JSON.stringify(v)) expectFailures.push(`expect: ${k} expected ${JSON.stringify(v)}, got ${JSON.stringify(cur)}`) }
      return
    }
    fire(g.type, { x: g.x, y: g.y }, g.id) // low-level (down/move/up/cancel)
  }
  try {
    const steps: TraceStep[] = []
    for (const g of gestures) {
      if (!opts.trace) { applyGesture(g); continue }
      const before = pl.allVars(), sIdx = sends.length
      applyGesture(g)
      const after = pl.allVars()
      const changed: TraceStep['changed'] = {}
      for (const k of new Set([...Object.keys(before), ...Object.keys(after)]))
        if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed[k] = [before[k], after[k]]
      steps.push({ gesture: describeGesture(g), sends: sends.slice(sIdx), changed })
    }
    return { sends, vars: pl.allVars(), ...(opts.trace ? { steps } : {}), ...(expectFailures.length ? { expectFailures } : {}) }
  } finally {
    pl.destroy()
    restore()
  }
}
