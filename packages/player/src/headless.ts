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
import type { Gesture, SendEvent } from './player'

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
function turnTargetFor(doc: Doc, name: string): { id: string; pivot: { x: number; y: number }; deg: boolean } | null {
  let id: string | null = null
  for (const l of doc.layers) { const it = findItemByName(l.items, name); if (it) { id = it.id; break } }
  const inter = id ? doc.interactors?.find((x) => x.targetId === id) : undefined
  if (!inter || (inter.axis !== 'turn' && inter.axis !== 'turnDeg')) return null
  return { id: inter.targetId, pivot: inter.pivot ?? { x: 0, y: 0 }, deg: inter.axis === 'turnDeg' }
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
  sends: SendEvent[]
  vars: Record<string, number | number[]>
  steps?: TraceStep[] // present if `trace`: one record per gesture (inspection / debug-player)
  expectFailures?: string[] // mismatches reported by the `expect` gestures (empty/absent = all verified) -> exit != 0 in CLI
  warnings?: string[] // what the replay noticed and did not treat as a failure (a `turn` whose press did not grab its target)
}

/** Trace of ONE gesture: its description, the `send`s emitted during it, and the variable diff. */
export type TraceStep = {
  gesture: string
  sends: SendEvent[]
  changed: Record<string, [number | number[] | undefined, number | number[]]> // var -> [before, after]
}

/** The pointer listeners a player registered on its canvas, by event type — what a replay fires into. */
export type Handlers = Record<string, (e: { clientX: number; clientY: number; pointerId: number }) => void>

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
  g.type === 'drag' ? `drag ${g.source}->${g.target}` : g.type === 'tap' ? `tap ${g.target ?? `(${g.x},${g.y})`}`
    : g.type === 'connect' ? `connect ${g.source}->${g.target}` : g.type === 'scratch' ? `scratch ${g.target}`
      : g.type === 'turn' ? `turn ${g.target} ${g.angle}${g.from ? ` from (${g.from[0]},${g.from[1]})` : ''}` : g.type === 'set' ? `set ${g.name}=${g.value}`
        : g.type === 'wait' ? `wait ${g.frames}` : g.type === 'wheel' ? `wheel ${g.dy}` : g.type === 'shot' ? `shot ${g.name ?? ''}`
          : g.type === 'key' ? `key ${g.name}${g.frames && g.frames !== 1 ? ` x${g.frames}` : ''}` : g.type === 'expect' ? 'expect' : `${g.type} (${g.x},${g.y})`

/** Replays gestures on a LIVE player: `apply` one at a time, `expectFailures` filling up as `expect`
 *  gestures are met. `handlers` are the listeners the player registered on its canvas (client coordinates
 *  = scene coordinates), `sends` the list its `onEvent` appends to. Shared by `playHeadless` and by the
 *  renderer, which replays a script and then draws what the scene has become. */
export type Replayer = { apply(g: Gesture): void; readonly expectFailures: string[]; readonly warnings: string[] }

/** What a replay needs of a player — its public surface only, so a player built from another entry point
 *  of the package is accepted. */
export type ReplayTarget = Pick<FlatPlayer, 'stepSim' | 'setVar' | 'setKey' | 'getVar' | 'objectCenter' | 'grabTargetAt'>

export function createReplayer(pl: ReplayTarget, doc: Doc, handlers: Handlers, sends: SendEvent[], opts: { settle?: number } = {}): Replayer {
  const ev = (x: number, y: number, id = 1) => ({ clientX: x, clientY: y, pointerId: id })
  // A pointer event TAKES A FRAME: a real pointer stays at least one frame on each position, so
  // `every frame` runs between a press, its moves and its release. `settle` = sim steps after each event
  // (default 1; 0 = the instantaneous replay). A gesture's own `settle` wins over the script's.
  const settleOf = (g: { settle?: number }): number => Math.max(0, Math.floor(g.settle ?? opts.settle ?? 1))
  const fire = (type: string, p: { x: number; y: number }, id = 1, settle = 0) => {
    const h = handlers[`pointer${type}`]
    if (h) h(ev(p.x, p.y, id))
    if (settle > 0) pl.stepSim(settle)
  }
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
  const warnings: string[] = []
  const apply = (g: Gesture): void => {
    if (g.type === 'set') { pl.setVar(g.name, g.value); return }
    if (g.type === 'wait') { pl.stepSim(g.frames); return }
    if (g.type === 'shot') return // a marker for the renderer (`flatc --render --script`): nothing to replay
    // Keyboard: no DOM event in Node (the global listeners are stubs) -> drive the held-keys set directly.
    if (g.type === 'key') { pl.setKey(g.name, true); pl.stepSim(g.frames ?? 1); pl.setKey(g.name, false); return }
    if (g.type === 'wheel') { const h = handlers['wheel']; if (h) (h as unknown as (e: { deltaY: number; deltaMode: number; preventDefault: () => void }) => void)({ deltaY: g.dy, deltaMode: 0, preventDefault: () => {} }); pl.stepSim(g.frames ?? 1); return }
    if (g.type === 'drag') { const id = g.id ?? 1, n = settleOf(g), t = dropPoint(g.target); fire('down', grabPoint(g.source), id, n); fire('move', t, id, n); fire('up', t, id, n); return }
    if (g.type === 'tap') {
      // By NAME (the object's resolved position) or at a POINT (`x`, `y`) — a rail, an unnamed area.
      const id = g.id ?? 1, n = settleOf(g)
      const at = g.target != null ? grabPoint(g.target) : typeof g.x === 'number' && typeof g.y === 'number' ? { x: g.x, y: g.y } : null
      if (!at) throw new Error('gesture: tap needs a "target" (an object name), or "x" and "y" (a point of the scene)')
      fire('down', at, id, n); fire('up', at, id, n)
      return
    }
    if (g.type === 'connect') { const id = g.id ?? 1, n = settleOf(g), t = grabPoint(g.target); fire('down', grabPoint(g.source), id, n); fire('move', t, id, n); fire('up', t, id, n); return } // pull a link wire source -> target
    if (g.type === 'scratch') { // sweep the reveal target's bbox so its coverage reaches ~1
      const id = g.id ?? 1, n = settleOf(g)
      const b = itemBoundsByName(doc, g.target)
      if (!b) throw new Error(`gesture: object "${g.target}" not found in the scene`)
      const pts = sweepPoints(b, revealBrushFor(doc, g.target))
      fire('down', pts[0], id, n)
      for (let i = 1; i < pts.length; i++) fire('move', pts[i], id, n)
      fire('up', pts[pts.length - 1], id, n)
      return
    }
    if (g.type === 'turn') { // turns a turn/turnDeg target TO `angle` around its WORLD pivot, swept in <=maxStep sub-moves
      const id = g.id ?? 1
      const ti = turnTargetFor(doc, g.target)
      if (!ti) throw new Error(`gesture: object "${g.target}" has no turn/turnDeg interactor`)
      // WHERE the press lands. `from` names it: two hands of a clock overlap at noon, and no default can
      // tell which one a test means. Without it, the object's resolved position, then the centre of its
      // drawn box — a hand drawn FROM its pivot has its origin on the very edge of its shape, where a
      // press grabs nothing. A press that does not grab THIS object is REPORTED (it used to turn another
      // object, or none, and say nothing) and the gesture is replayed all the same: a script may be
      // proving precisely that a locked object does not respond, and that is not a failure.
      const tries = g.from ? [{ x: g.from[0], y: g.from[1] }] : [grabPoint(g.target), boxCentre(doc, g.target)].filter((p): p is { x: number; y: number } => p != null)
      const found = tries.find((p) => pl.grabTargetAt(p) === ti.id)
      const start = found ?? tries[0]
      if (!found) {
        warnings.push(g.from
          ? `turn: the press at (${start.x}, ${start.y}) does not grab "${g.target}" (${describeGrab(doc, pl.grabTargetAt(start))}). If it should: "from" must be a point ON its shape, where nothing covers it.`
          : `turn: no press point grabs "${g.target}" (${describeGrab(doc, pl.grabTargetAt(start))}). If it should: name one with "from": [x, y], a point ON its shape, where nothing covers it.`)
      }
      const piv = ti.pivot
      const R = Math.max(24, Math.hypot(start.x - piv.x, start.y - piv.y)) // radius to place the rotating pointer (only the ANGLE matters, not R)
      const at = (v: number) => { const rad = ti.deg ? (v * Math.PI) / 180 : v; return { x: piv.x + R * Math.cos(rad), y: piv.y + R * Math.sin(rad) } } // target value (deg/rad) -> pointer position
      const maxStep = ti.deg ? 60 : Math.PI / 3 // <= per sub-move: keeps each delta small (under the atan2 wrap / typical author jump-guards) so multi-turn works
      const N = Math.max(2, Math.ceil(Math.abs(g.angle) / maxStep))
      // The sub-moves have ALWAYS taken a step each (a delta-accumulating `every frame` integrates the
      // turn), whatever the script's `settle`: only the gesture's own `settle` turns that off. So
      // `settle: 0` for a script is exactly the replay of before, `turn` included.
      const n = settleOf(g), between = Math.max(0, Math.floor(g.settle ?? Math.max(1, opts.settle ?? 1)))
      fire('down', start, id, n)
      for (let k = 1; k <= N; k++) fire('move', at((g.angle * k) / N), id, between) // sweep
      fire('up', at(g.angle), id, n)
      return
    }
    if (g.type === 'expect') {
      const got = sends.slice(sendCursor).map((s) => s.name) // sequence of send names emitted since the last expect
      sendCursor = sends.length
      if (g.sends && JSON.stringify(got) !== JSON.stringify(g.sends)) expectFailures.push(`expect: expected sends [${g.sends.join(', ')}], received [${got.join(', ')}]`)
      if (g.vars) for (const [k, v] of Object.entries(g.vars)) { const cur = pl.getVar(k); if (JSON.stringify(cur) !== JSON.stringify(v)) expectFailures.push(`expect: ${k} expected ${JSON.stringify(v)}, got ${JSON.stringify(cur)}`) }
      return
    }
    fire(g.type, { x: g.x, y: g.y }, g.id, settleOf(g)) // low-level (down/move/up/cancel)
  }
  return { apply, expectFailures, warnings }
}

/** Centre of an object's drawn box (static), or null when it has none. */
function boxCentre(doc: Doc, name: string): { x: number; y: number } | null {
  const b = itemBoundsByName(doc, name)
  return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : null
}
const describeGrab = (doc: Doc, id: string | null): string => {
  if (!id) return 'nothing is grabbed there'
  let name: string | null = null
  for (const l of doc.layers) { name = nameOfId(l.items, id); if (name) break }
  return `"${name ?? id}" is grabbed there instead`
}
/** Name of the item with this id (walks groups), for a message. */
function nameOfId(items: Item[], id: string): string | null {
  for (const it of items) {
    if (it.id === id) return 'name' in it && it.name ? it.name : id
    if (isGroup(it)) for (const l of it.layers) { const r = nameOfId(l.items, id); if (r) return r }
  }
  return null
}

/** Plays `doc`, replays `gestures`, returns the collected `send`s plus the final state of the variables.
 *  `trace`: adds `steps` (sends + variable diff PER gesture) -- for inspection / the debug-player.
 *  `seed`: what `random()` draws from. A replay is ALWAYS seeded (default 1), so that it says the same
 *  thing twice; pass another seed to see another draw.
 *  `settle`: sim steps after each pointer event (default 1 — a pointer event takes a frame; 0 = none). */
export function playHeadless(doc: Doc, gestures: Gesture[], opts: { trace?: boolean; seed?: number; settle?: number } = {}): PlayResult {
  const restore = ensureDomGlobals()
  const handlers: Handlers = {}
  const sends: PlayResult['sends'] = []
  const pl = new FlatPlayer(fakeCanvas(handlers, doc.width, doc.height), doc, { input: true, padding: 0, render: false, audio: false, seed: opts.seed ?? 1, onEvent: (e) => sends.push(e) })
  const { apply: applyGesture, expectFailures, warnings } = createReplayer(pl, doc, handlers, sends, { settle: opts.settle })
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
    return { sends, vars: pl.allVars(), ...(opts.trace ? { steps } : {}), ...(expectFailures.length ? { expectFailures } : {}), ...(warnings.length ? { warnings } : {}) }
  } finally {
    pl.destroy()
    restore()
  }
}
