// -----------------------------------------------------------------------------
//  player.ts -- the FlatInk animation player, standalone and lightweight.
//
//  Loads a FlatInk document (the `.flatink` format = this JSON `Doc`) and plays it
//  in a <canvas>. No editor dependency: no React, no store, no material engine
//  (`polygon-clipping`) -- the material is already baked into the document, the
//  player only evaluates the timeline and draws.
// -----------------------------------------------------------------------------
import type { Asset, Doc, Layer, Point, Text } from '@flatkit/types'
import { resolveInstanceFrame, scheduleSounds, applyEasing, type Timeline, type Easing } from '@flatkit/engine/timeline'
import { stateValueOf, initialStateValue, stateMachineByParam } from '@flatkit/engine/states'
import { compileCached, evalExpr, exprScope, type ExprContext, type Compiled } from '@flatkit/engine/expr'
import { runActions, MAX_SEND_FIELDS, MAX_SEND_TEXT, SEND_EVENT_NAME, isSendField, type Action, type ActionHost, type Interaction, type ItemEvent } from '@flatkit/engine/actions'
import { containerLayers, getSymbol, isGroup, isInstance, isText } from '@flatkit/engine/layers'
import { renderLayers, collectModifierTargets, docHasModifiers, type FilterCacheEntry, type RenderCtx } from './drawScene'
import { restState, advanceModifier, type ModState } from '@flatkit/engine/channelModifiers'
import { withCels } from '@flatkit/engine/migrateCel'
import { sanitizeDoc } from '@flatkit/engine/validateDoc'
import { applyInstanceBinds } from '@flatkit/engine/instanceBind'
import { importedFunctions } from '@flatkit/engine/stdlib'
import { namedChannels, objectChannelsById, objectPlacementById, type NamedChannels, type ObjectChannels } from '@flatkit/engine/sceneRefs'
import { itemBoundsByName, itemBoundsById, itemBoundsByIds, dropZoneBounds, tracePathByName, groupTargets, revealGrid } from '@flatkit/engine/groups'
import { projectToPath, samplePathAt, pathArcLength, type Path } from '@flatkit/engine/path'
import { apply, invert, spaceConversions, IDENTITY, type Transform } from '@flatkit/engine/transform'
import type { Interactor } from '@flatkit/types'
import { hitChains, warmHitCache as warmHitPaths, type GrabZones } from './hit'
import type { ScratchMask } from './drawScene'

/** A replayable gesture (`--play` / `--record` format). Coords in SCENE units. `id` = pointerId (default 1).
 *  Prefer SEMANTIC gestures (`drag`/`tap` by object NAME): robust, readable, and it is the engine that
 *  resolves the coords (cf. [[flatink-semantic-gestures]]). The low-level gestures remain for special cases. */
export type Gesture =
  // Semantic (by NAME) -- the engine resolves them into down/move/up.
  | { type: 'drag'; source: string; target: string; id?: number } // drags the `source` object onto the `target` zone
  | { type: 'tap'; target: string; id?: number } // clicks at the center of the `target` object
  | { type: 'scratch'; target: string; id?: number } // sweeps a `reveal` target's bbox (covers it -> fraction ~1)
  | { type: 'connect'; source: string; target: string; id?: number } // pulls a `link` wire from `source` to `target` (resolves the target index)
  // rotates a `turn`/`turnDeg` target by `angle` around its pivot (signed; DEGREES for turnDeg, RADIANS for
  // turn), swept in sub-steps; `settle` = sim frames advanced between sub-steps (default 1) so a
  // delta-accumulating `every frame` integrates the turn. `from` = where the press lands (WORLD): the way to
  // name WHICH of two overlapping targets is grabbed, since the engine's own grab point picks the topmost.
  | { type: 'turn'; target: string; angle: number; from?: [number, number]; settle?: number; id?: number }
  // Low-level (scene coords).
  | { type: 'down' | 'move' | 'up' | 'cancel'; x: number; y: number; id?: number }
  | { type: 'set'; name: string; value: number } // drives a variable from the "host"
  | { type: 'wait'; frames: number } // lets the simulation run N fixed steps (60 Hz): `every frame` + playhead advance
  | { type: 'wheel'; dy: number; frames?: number } // scrolls the wheel by `dy` px, then advances `frames` sim steps (default 1) so `every frame` integrates `mouse.wheel`
  | { type: 'key'; name: string; frames?: number } // HOLDS a key (`keys.<name>` = 1) for `frames` sim steps (default 1), then releases it
  // Assertion (CI self-check): compares the `send`s emitted SINCE the last `expect` (sequence of names)
  // and the current state of the variables; any mismatch is reported in PlayResult.expectFailures (-> exit != 0 in CLI).
  | { type: 'expect'; sends?: string[]; vars?: Record<string, number | number[]> }

/** What the host receives on each DSL `send`. `value` = the number / `text("…")` form, `fields` = the
 *  record form `send "e", { a = …, b }` (named numbers, a state patch). Both absent = bare `send "e"`. */
export type SendEvent = { name: string; value?: number | string; fields?: Record<string, number> }

export type PlayerOptions = {
  autoplay?: boolean
  loop?: boolean
  padding?: number // margin around the page (CSS px)
  audio?: boolean // play the audio tracks (default: true)
  input?: boolean // attach the mouse/keyboard listeners (default: true); false = non-interactive preview (gallery): plays the anim without reacting to clicks/keys
  render?: boolean // paint the canvas (default: true); false = headless (logic/sends only, no Canvas API required)
  image?: (assetId: string) => CanvasImageSource | null // injected image provider (headless skia PNG rendering); absent = browser decoding via <img>
  // Maps an asset to a TRUSTED url/source to load (image src, audio fetch). Default: embedded `data:` URIs
  // only — never a remote URL. To serve EXTERNAL (local/same-origin) assets, pass `sameOriginAssetResolver(baseUrl)`:
  // the HOST picks the origin, the (untrusted) document only supplies a relative key, so the security contract holds.
  resolveAsset?: (asset: Asset) => string | null
  onEvent?: (event: SendEvent) => void // DSL `send` channel -> the embedding host
}

type View = { tx: number; ty: number; scale: number }
// `reveal` interactor: a grid of cells over the object's world bbox; ticked cells accumulate the coverage.
type RevealGrid = { minX: number; minY: number; cell: number; cols: number; rows: number }
type RevealState = { revealCells: Set<number>; revealGrid: RevealGrid }

/** "Contain" transform: the page fits entirely inside the canvas, centered. */
function fit(cssW: number, cssH: number, docW: number, docH: number, pad: number): View {
  const scale = Math.max(0.0001, Math.min((cssW - 2 * pad) / docW, (cssH - 2 * pad) / docH))
  return { tx: (cssW - docW * scale) / 2, ty: (cssH - docH * scale) / 2, scale }
}

const playerImgCache = new Map<string, HTMLImageElement>()

/**
 * An embedded asset MUST be a self-contained `data:` URI (cf. Asset.data). A `.flatpack` is untrusted
 * content (it may be embedded in a third-party page): we never let it drive the player to a remote URL,
 * which would otherwise turn an asset reference into a tracking beacon / SSRF / CSRF request to an
 * arbitrary origin. `blob:`/`http(s):`/`file:` references are rejected.
 */
const isEmbeddedData = (data: string | undefined): data is string => !!data && data.startsWith('data:')

/**
 * Resolver for EXTERNAL (non-embedded) assets. Pass it as `PlayerOptions.resolveAsset` to serve media from
 * a host-controlled folder instead of embedding everything as `data:`. It treats `asset.data` as a RELATIVE
 * key, resolves it against the host-trusted `baseUrl`, and returns the URL only if it stays SAME-ORIGIN as
 * baseUrl. An embedded `data:` URI is passed through; any absolute URL / scheme / protocol-relative `//host`
 * in `asset.data` (a document trying to pick its own origin) yields null. The HOST owns the origin; the
 * untrusted document only supplies a key — so the no-arbitrary-fetch contract still holds.
 */
export function sameOriginAssetResolver(baseUrl: string): (asset: Asset) => string | null {
  let base: URL
  try { base = new URL(baseUrl) } catch { return () => null }
  return (asset) => {
    const data = asset.data
    if (typeof data !== 'string' || !data) return null
    if (data.startsWith('data:')) return data // embedded asset → always fine
    if (data.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(data)) return null // carries its own scheme/authority → reject
    let url: URL
    try { url = new URL(data, base) } catch { return null }
    return url.origin === base.origin ? url.href : null
  }
}

// FIXED-STEP simulation for `onEnterFrame` (game logic / physics): we run it at a
// CONSTANT rate (independent of rAF/screen), not "once per rendered frame". Otherwise a
// loop doing "x += speed" every frame would run 2x too fast at 120 Hz and in slow motion below
// 60 Hz. 60 Hz = the reference cadence (the one the demos were tuned to). The PLAYHEAD
// (playback position, tweens) stays based on real time -> smooth rendering at any refresh rate.
/** Variables -> the player's working Map, CLONING the ARRAYS: `set arr[i] = ...` mutates in place,
 *  so without cloning the player would modify the editor doc's array (broken bricks that "stay broken"). */
export function cloneVars(vars: Record<string, number | number[]> | undefined): Map<string, number | number[]> {
  return new Map(Object.entries(vars ?? {}).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]))
}
/** Deep copy of a variables Map (clones the arrays) -- for the interpolation snapshot. */
export function cloneVarMap(m: Map<string, number | number[]>): Map<string, number | number[]> {
  const out = new Map<string, number | number[]>()
  for (const [k, v] of m) out.set(k, Array.isArray(v) ? [...v] : v)
  return out
}
/** Interpolated vars `lerp(prev, cur, alpha)` -- numbers and arrays; incompatible types -> `cur`. */
export function lerpVars(prev: Map<string, number | number[]>, cur: Map<string, number | number[]>, alpha: number): Map<string, number | number[]> {
  const out = new Map<string, number | number[]>()
  for (const [k, c] of cur) {
    const p = prev.get(k)
    if (typeof c === 'number' && typeof p === 'number') out.set(k, p + (c - p) * alpha)
    else if (Array.isArray(c) && Array.isArray(p) && p.length === c.length) out.set(k, c.map((ci, i) => (p[i] as number) + (ci - (p[i] as number)) * alpha))
    else out.set(k, c)
  }
  return out
}

const SIM_HZ = 60
const SIM_STEP = 1 / SIM_HZ // seconds per simulation step
const RESERVED = new Set(['time', 'frame', 'clock', 'value']) // runtime-provided names; never shadowed by a variable
/**
 * What the scene reads from the INPUT devices, over-approximated by ONE scan of the serialized document
 * (a literal "keys.X" inside a text is a false positive; harmless — it only makes the player listen).
 *  - `wheel`: the scene references `mouse.wheel` → listen to the wheel and `preventDefault` it (consume the
 *    scroll). Else the listener stays inert and the page scrolls normally.
 *  - `mousePos`: does any expression read the pointer POSITION (`mouse.x`/`mouse.y`)? If not, a pointermove
 *    changes no expression input, so the per-move `bustNamed()` (cache invalidation → rebuild) is pure waste.
 *  - `keys`: the key names the scene actually READS. The player consumes ONLY these; everything else keeps
 *    its native page behavior (scroll, shortcuts).
 *
 * The three used to ask their own question, each serializing the WHOLE `.flatpack` to do it — three full
 * stringifications of the document on every load.
 */
type InputUse = { wheel: boolean; mousePos: boolean; keys: Set<string> }
function docInputUse(doc: Doc): InputUse {
  const src = JSON.stringify(doc)
  const keys = new Set<string>()
  for (const m of src.matchAll(/keys\s*\.\s*([A-Za-z_]\w*)/g)) keys.add(m[1])
  return { wheel: /mouse\s*\.\s*wheel/.test(src), mousePos: /mouse\s*\.\s*[xy]/.test(src), keys }
}

/** Grab-time state of a `trace`: its WORLD path and that path's total length (the unit `step` is in). */
const traceGrab = (pathOf: (name: string) => Path | null, it: Interactor): { tracePath: Path | null; traceMaxT: number; traceLen: number } => {
  const tracePath = it.confine ? pathOf(it.confine) : null
  return { tracePath, traceMaxT: 0, traceLen: tracePath ? pathArcLength(tracePath) : 1 }
}

/** Progress variables of the CONTINUOUS traces (`step`) — the writes that must re-seat their state. */
const traceOutputNames = (doc: Doc): Set<string> =>
  new Set((doc.interactors ?? []).filter((i) => i.axis === 'trace' && i.step !== undefined && i.varX).map((i) => i.varX as string))

/** Keys we never consume, whatever the scene declares: browser/OS shortcuts (a modifier is held) and the
 *  navigation/system keys — swallowing those breaks accessibility and the surrounding page. */
const NEVER_CONSUMED = /^(Tab|F\d{1,2})$/
/** Is the event headed to a form field of the HOST page (its own <input>, a rich-text editor…)? The key
 *  listeners are global, so without this a scene would steal the keystrokes the user is typing there. */
const isEditableTarget = (t: EventTarget | null): boolean => {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null
  if (!el) return false
  return el.isContentEditable === true || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}
const SIM_MAX_STEPS = 30 // "spiral of death" safeguard after a long pause (backgrounded tab)

const CLICK_EVENTS: readonly ItemEvent[] = ['click']
const HOVER_EVENTS: readonly ItemEvent[] = ['enter', 'leave']
// Grabbing: an item carrying one of these handlers becomes "grabbed" on pointerdown. While it is,
// pointermove sends it `drag` (even if the pointer leaves the item), and pointerup -> `release`.
const GRAB_EVENTS: readonly ItemEvent[] = ['press', 'release', 'drag', 'longpress']
const MAX_FILL = 100_000 // bound of `arr = fill(n, v)` — mirrors the declaration's own cap
const LONGPRESS_MS = 500 // hold without moving -> `held`
const LONGPRESS_TOL = 6 // movement tolerance (world px) before canceling the hold
const TAP_TOL = 6 // movement tolerance (world px) under which a press+release counts as a `click` (tap, not drag)

/**
 * Fixed-step accumulator: how many simulation steps to run this tick, and the remainder to carry over.
 * Pure (testable without rAF/DOM). `dt` must already be clamped by the caller. The number of steps is
 * bounded by `max` (anti-runaway); the surplus time is then dropped (not hoarded).
 */
export function simSteps(acc: number, dt: number, step: number, max: number): { steps: number; acc: number } {
  let a = acc + dt
  let n = 0
  while (a >= step && n < max) { a -= step; n++ }
  if (n >= max) a = 0 // hit the ceiling -> drop the accumulated backlog
  return { steps: n, acc: a }
}

// -- Audio (WebAudio): context + decoded buffers, shared across players. --
let playerAudioCtx: AudioContext | null = null
const playerAudioBuffers = new Map<string, AudioBuffer | 'loading'>()
function getAudioCtx(): AudioContext {
  if (!playerAudioCtx) playerAudioCtx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  return playerAudioCtx
}

export class FlatPlayer {
  private readonly ctx: CanvasRenderingContext2D
  private doc: Doc
  private readonly loop: boolean
  private readonly pad: number
  private dpr = 1
  private cssW = 0
  private cssH = 0
  private view: View = { tx: 0, ty: 0, scale: 1 }
  private frame = 0
  private mono = 0 // MONOTONE frame count (never wrapped by the loop) → `clock = mono/fps` for ambient motion
  private playing = false
  private raf = 0
  private last = 0
  private simAcc = 0 // time accumulator for the fixed-step simulation (onEnterFrame)
  // Render interpolation (anti-judder): we draw the motion driven by `onEnterFrame` at the INTERPOLATED
  // position between the two last sim steps, by `simAlpha = simAcc/SIM_STEP`. Otherwise a 60 Hz sim
  // on a 120 Hz screen (ProMotion) stutters. Cf. "Fix Your Timestep" (Gaffer).
  private prevSimVars: Map<string, number | number[]> | null = null
  private simAlpha = 1
  private simActive = false
  private audioOn: boolean
  private readonly onEvent?: (event: SendEvent) => void
  private renderOn = true
  private readonly imageProvider?: (assetId: string) => CanvasImageSource | null
  private readonly resolveAsset: (asset: Asset) => string | null
  // Gesture recording (`--record`): we play by hand, capture down/up/cancel + the `move`s
  // DURING a drag (reduced volume), with `wait`s (elapsed frames) between them -> replayable script.
  private recording: Gesture[] | null = null
  private recordFrame = 0
  // Perf: cache of static filtered composites (set dressing). `imageEpoch` bumps on each decoded image
  // -> invalidates the entries depending on an asset that just loaded. Cleared when the doc changes.
  private readonly filterCache = new Map<string, FilterCacheEntry>()
  private imageEpoch = 0
  private activeSources: AudioBufferSourceNode[] = []
  // -- Interaction (Layer B) --
  private vars = new Map<string, number | number[]>()
  private procs = new Map<string, { params: string[]; body: Action[] }>() // fn name(p) { ... }
  private valueFuncs: { name: string; params: string[]; comp: Compiled }[] = [] // fn name(p) = expr (compiled)
  private funcDepth = 0 // anti-recursion guard (procedures + value functions)
  private readonly mouse = { x: 0, y: 0, dx: 0, dy: 0, wheel: 0 } // dx/dy = movement SINCE the last tick; wheel = accumulated wheel delta SINCE the last tick (both reset after onEnterFrame) -> "what happened this frame?"
  private usesWheel = false // does the scene read `mouse.wheel`? → capture the wheel + preventDefault (else let the page scroll over the canvas)
  private usesMousePos = false // does the scene read `mouse.x`/`mouse.y`? → only then must a pointermove bust the expr cache
  private readKeys = new Set<string>() // key names the scene reads (`keys.<Name>`) → the only ones consumed (preventDefault)
  private hitWarmId = 0 // requestIdleCallback handle for the deferred hit-cache warm-up (0 = none pending)
  private readonly heldKeys = new Set<string>()
  private readonly keyProxy = new Proxy(
    {},
    {
      get: (_t, k) => (typeof k === 'string' && this.heldKeys.has(k) ? 1 : 0),
      // The expression evaluator guards member access with `Object.hasOwn(o, prop)`
      // (sandbox: own props only). A bare get-trap proxy has an empty target, so
      // hasOwn is always false and `keys.<Name>` evaluates to NaN. Report every
      // string key as an own property so the guard passes; the value still comes
      // from the get trap.
      has: (_t, k) => typeof k === 'string',
      getOwnPropertyDescriptor: (_t, k) =>
        typeof k === 'string'
          ? { value: this.heldKeys.has(k) ? 1 : 0, writable: false, enumerable: true, configurable: true }
          : undefined,
    },
  ) as Record<string, number>
  private hovered: string | null = null
  private hoverIds = new Set<string>() // ALL ids in the topmost hit chain under the pointer (for self.hovered feedback, handler-independent)
  private selfChannels: ObjectChannels | null = null // `self` in a handler = the targeted object's channels (set for the duration of runActions)
  private selfParent: Transform | null = null // world transform of the targeted object's parent -> toLocal/toGlobal conversions
  // namedChannels resolves the WHOLE scene (costly); memoized per frame -- otherwise recomputed on every
  // evalNumber (hundreds/frame in a game) -> stutter. Invalidated by inputs (cf. bustNamed).
  private namedCache: NamedChannels | null = null
  private namedFrame = Number.NaN
  // Per-frame expression context cache: the `every frame` interpreter calls exprCtx hundreds of times/frame;
  // everything but the variables is stable within a frame (named channels memoized, funcs/mouse/keys reused),
  // so we build it ONCE per frame and only refresh the live vars on reuse. Bypassed when `self` is set
  // (a handler) or when called with interpolated vars (render between sim steps). Invalidated by bustNamed.
  private ctxCache: ExprContext | null = null
  private ctxFrame = Number.NaN
  private funcNames: Set<string> = new Set() // value-function names → keep priority over vars when refreshing
  // -- Grabbing (drag / press / long-press) --
  private grabbed: string | null = null // grabbed item (between pointerdown and pointerup)
  private grabStart: Point = { x: 0, y: 0 } // world point of the press (long-press + tap tolerance)
  // `click` is DEFERRED to pointerup: a tap fires it only if the pointer stayed within TAP_TOL of the press
  // (a press that becomes a drag is NOT a click). Lets a draggable surface and a tappable child coexist.
  private pendingClick: string | null = null // click target captured on press, fired on release if it stayed a tap
  private dragActive: { it: Interactor; offX: number; offY: number; parentInv: Transform; tracePath?: Path | null; traceMaxT?: number; traceLen?: number; revealCells?: Set<number>; revealGrid?: RevealGrid } | null = null // "drag" interactor in progress (parentInv cached at grab time)
  // `reveal` coverage PERSISTED per target across grabs → true monotonicity (a child scratching with
  // several short strokes keeps accumulating instead of resetting to the current stroke each grab).
  private readonly revealStates = new Map<string, RevealState>()
  // CONTINUOUS `trace` (`step`) — progress + the end it was entered from, per TARGET. Persisted across
  // grabs for the same reason: a child stops mid-letter, lifts, and puts the finger back where it was.
  // Reset by writing the progress variable from the scene (`avance = 0`), which is how an author restarts.
  private readonly traceStates = new Map<string, { progress: number; dir: 0 | 1 | -1 }>()
  private traceOutputs: Set<string> = new Set() // the progress variables of continuous traces (see `syncTraceState`)
  // Grab zones handed to the hit test: the WORLD bbox of each `reveal` target, so a veil stays grabbable
  // where the child already scratched it away (its cells sit at `opacity 0`, which normally lets the
  // pointer through). Built on load, when the scene geometry is known; UNDEFINED when the doc declares no
  // `reveal` — the hit test then skips the whole zone path (the overwhelmingly common case).
  private grabZones: GrabZones | undefined
  // `reveal … erase`: what the renderer must rub out of each target, by item id. The mask holds the SAME
  // `Set` the gesture ticks (a live view — no rebuild per frame, no copy per stroke) plus the grid geometry.
  // Filled on the first grab of an erasing `reveal`; empty otherwise, and the renderer then skips the branch.
  private readonly scratched = new Map<string, ScratchMask>()
  // Per-instance exposed-param runtime (P3 states): instanceId → param → in-progress transition.
  // `value` is the current eased value; it drives the instance's local playhead (see drawScene.paramsFor).
  private readonly paramRt = new Map<string, Map<string, { value: number; from: number; target: number; elapsed: number; dur: number; ease?: Easing }>>()
  // Stateful channel modifiers (smooth/spring): per-(instance,channel) integrator state, keyed
  // `statePath+itemId|channel`. Persists across frames; cleared on seek/load → snap to rest on the target.
  private readonly channelState = new Map<string, ModState>()
  // `velocity(arg)` inside a modifier target: previous value(s) of arg per `key|channel` (one slot per
  // velocity() occurrence in the target). Separate from channelState (pos/vel) so the spring's first-frame
  // rest-init never clobbers it. Advanced once per tick by the advance pass; cleared on seek/load.
  private readonly velocityState = new Map<string, number[]>()
  private modAcc = 0 // fixed-step accumulator for the modifier advance (independent of the onEnterFrame sim gate)
  private hasModifiers = false // doc declares ≥1 modifier → run the advance pass (else zero overhead)
  private hasSymbolTimelines = false // any symbol carries a timeline? (else `activeSymbolTimelines` is empty by construction)
  private instNameCache?: Map<string, { id: string; symbolId: string }>
  private assetCache?: Map<string, Asset> // asset id -> asset (see `assetById`); rebuilt on load
  // WORLD path of a `trace` target by name. It is built from the scene's ROSTER transforms, so playback
  // never moves it — yet it was rebuilt (a full document walk, plus a transformed copy of every subpath) on
  // every write of a trace's progress, i.e. on every pointer move while a child draws.
  private readonly tracePathCache = new Map<string, Path | null>()
  // Handlers and interactors indexed BY TARGET. Both sat on the pointer path: `pickTarget` scanned the whole
  // interaction list for each item of each hit chain on every move, and `fireEvent` re-filtered it —
  // allocating a fresh array — for each `drag` a grab emits.
  private handlerIndex?: Map<string, Map<ItemEvent, Interaction[]>>
  private interactorIndex?: Map<string, Interactor[]>
  private transRaf = 0 // lightweight rAF driving transitions while the playhead is NOT playing
  private longPressTimer: ReturnType<typeof setTimeout> | null = null
  private lastFrameInt = -1
  private readonly onResize = () => {
    this.measure()
    this.render()
  }
  /** Re-reads which input devices the current document uses (see `docInputUse`). Load-time only. */
  private applyInputUse(): void {
    const use = docInputUse(this.doc)
    this.usesWheel = use.wheel
    this.usesMousePos = use.mousePos
    this.readKeys = use.keys
  }
  /** Invalidates the named-objects cache (input changed outside of a frame advance). */
  private bustNamed(): void {
    this.namedFrame = Number.NaN
    this.ctxCache = null // its baked-in named channels are now stale
  }
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return // the user is typing in a field of the host page — not for us
    this.holdKey(e.key, true)
    // Consume the key ONLY if the scene reads it (cf. onWheel): an activity bound to the arrows/space
    // stops scrolling the page under it, while an unused key keeps its native behavior.
    if (this.readsKey(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && !NEVER_CONSUMED.test(e.key)) e.preventDefault()
  }
  // NB: no editable-target guard on keyup — a key pressed over the canvas then released while a host
  // input has the focus must still be cleared, or it stays "held" forever.
  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.holdKey(e.key, false)
  }
  /** Single write path for the held-keys set (physical key, `setKey`, headless replay). The space bar
   *  arrives as `" "` but is authored as `keys.Space` → both are held/released together. */
  private holdKey(key: string, down: boolean): void {
    const alias = key === ' ' ? 'Space' : null
    if (down) { this.heldKeys.add(key); if (alias) this.heldKeys.add(alias) }
    else { this.heldKeys.delete(key); if (alias) this.heldKeys.delete(alias) }
    this.bustNamed()
  }
  /** Losing the window (alt-tab, focus on another frame) never delivers the keyup → release everything,
   *  else the scene keeps running with a key stuck down. */
  private readonly onBlur = () => {
    if (!this.heldKeys.size) return
    this.heldKeys.clear()
    this.bustNamed()
    this.render()
  }
  /** Does the scene read this key? `" "` is authored as `keys.Space` (cf. onKeyDown's alias). */
  private readsKey(key: string): boolean {
    return this.readKeys.has(key === ' ' ? 'Space' : key)
  }
  private readonly onPointerLeave = () => {
    // Safety net: if pointer capture is not supported, a pointer that leaves releases the grab.
    if (this.grabbed) {
      const id = this.grabbed
      this.clearGrab()
      this.clearLinkTarget(id) // the pointer left the canvas -> no target reached
      this.fireEvent(id, 'release')
    }
    if (this.hovered) {
      this.fireEvent(this.hovered, 'leave')
      this.hovered = null
    }
    this.hoverIds.clear() // pointer left the canvas → nothing hovered
    this.render()
  }
  private worldPoint(e: { clientX: number; clientY: number }): Point {
    const r = this.canvas.getBoundingClientRect()
    return { x: (e.clientX - r.left - this.view.tx) / this.view.scale, y: (e.clientY - r.top - this.view.ty) / this.view.scale }
  }
  /** Handlers on an item, by event, in document order (the order they must run in). */
  private handlersFor(id: string): Map<ItemEvent, Interaction[]> | undefined {
    if (!this.handlerIndex) {
      const m = new Map<string, Map<ItemEvent, Interaction[]>>()
      for (const x of this.doc.interactions ?? []) {
        let byEvent = m.get(x.targetId)
        if (!byEvent) { byEvent = new Map(); m.set(x.targetId, byEvent) }
        const list = byEvent.get(x.event)
        if (list) list.push(x)
        else byEvent.set(x.event, [x])
      }
      this.handlerIndex = m
    }
    return this.handlerIndex.get(id)
  }
  /** Every interactor declared on an item, in document order. */
  private interactorsFor(id: string): Interactor[] | undefined {
    if (!this.interactorIndex) {
      const m = new Map<string, Interactor[]>()
      for (const x of this.doc.interactors ?? []) {
        const list = m.get(x.targetId)
        if (list) list.push(x)
        else m.set(x.targetId, [x])
      }
      this.interactorIndex = m
    }
    return this.interactorIndex.get(id)
  }
  /**
   * Target of an event at a point: we walk ALL the hit chains (top to bottom) and, within each,
   * from deepest to root. The first item carrying a handler for `event` wins. This way a click
   * "falls through" a non-interactive item placed on top down to the clickable one below, instead
   * of being swallowed by it.
   */
  private pickTarget(chains: string[][], events: readonly ItemEvent[]): string | null {
    if (!this.doc.interactions?.length) return null
    for (const chain of chains) {
      for (let i = chain.length - 1; i >= 0; i--) {
        const byEvent = this.handlersFor(chain[i])
        if (byEvent) for (const e of events) if (byEvent.has(e)) return chain[i]
      }
    }
    return null
  }
  private interactorFor(id: string): Interactor | undefined {
    return this.interactorsFor(id)?.[0] // first declared wins — what the `find` it replaces returned
  }
  /** Is the drag active? `enabled` absent = always; otherwise true iff the expression is != 0. */
  private interactorEnabled(it: Interactor): boolean {
    return !it.enabled || this.evalNumber(it.enabled) !== 0
  }
  /** Topmost grabbable item carrying an ACTIVE (drag) interactor, at a point. */
  private pickInteractor(chains: string[][]): string | null {
    if (!this.doc.interactors?.length) return null
    for (const chain of chains) for (let i = chain.length - 1; i >= 0; i--) {
      const its = this.interactorsFor(chain[i]) // ANY enabled one makes the item grabbable (as the scan did)
      if (its?.some((x) => this.interactorEnabled(x))) return chain[i]
    }
    return null
  }
  /** Applies the current drag: position = pointer + grab offset, then snap, then confine; writes varX/varY.
   *  Snap/confine are in WORLD space (where the visual grid and the zone bbox live); the result is brought back into
   *  the object's PARENT space (`parentInv` cached at grab time -- no scene walk per movement). */
  /** Writes a gesture output: simple variable `name`, or array element `name[idx]` (idx is EVALUATED).
   *  The indexed form is the natural output under `each` (e.g. `drag hx[i], hy[i]` -> `hx[0]`... after unfolding). */
  private writeOut(target: string, value: number): void {
    const lb = target.indexOf('[')
    if (lb < 0) { this.setVarLive(target, value); return }
    const a = this.vars.get(target.slice(0, lb))
    if (!Array.isArray(a)) return
    const i = Math.round(this.evalNumber(target.slice(lb + 1, target.lastIndexOf(']'))))
    if (i >= 0 && i < a.length) a[i] = value
  }
  /** `reveal … { cells <array> }`: marks the cell `i` as cleared. Silent when the name is not a declared
   *  array or the index is past its end — `--check` states the grid's exact size, which is where a
   *  mismatch belongs (a runtime throw would kill the gesture mid-stroke). */
  private markCell(name: string, i: number): void {
    const a = this.vars.get(name)
    if (Array.isArray(a) && i >= 0 && i < a.length) a[i] = 1
  }
  private applyDrag(p: Point): void {
    const d = this.dragActive
    if (!d) return
    if (d.it.axis === 'turn' || d.it.axis === 'turnDeg') { // the object points toward the cursor (pivot->pointer angle). `turn` = RADIANS (pairs with the `rotation` channel / `gesture.angle`); `turnDeg` = DEGREES (pairs with `rotationDeg`)
      const piv = d.it.pivot ?? { x: 0, y: 0 }
      const deg = d.it.axis === 'turnDeg'
      let a = Math.atan2(p.y - piv.y, p.x - piv.x) // radians
      if (deg) a = (a * 180) / Math.PI
      if (d.it.grid && d.it.grid > 0) { const step = deg ? d.it.grid : (d.it.grid * Math.PI) / 180; a = Math.round(a / step) * step } // `snap` is authored in degrees
      if (d.it.varX) this.writeOut(d.it.varX, a)
      this.bustNamed()
      return
    }
    if (d.it.axis === 'trace') { // follow a path: progress 0..1 (monotone) as long as we stay within tolerance
      const path = d.tracePath
      if (path && path.subpaths.length) {
        const t = projectToPath(path, p)
        const near = samplePathAt(path, t).point
        const tol = d.it.grid && d.it.grid > 0 ? d.it.grid : 24 // tolerance (px); default 24
        const onPath = Math.hypot(p.x - near.x, p.y - near.y) <= tol
        if (d.it.step === undefined) {
          // CURSOR (historical): the progress IS the projection, monotone within the grab. A press anywhere
          // on the path counts as having reached that point — fine for a slider, wrong for a tracing drill.
          if (onPath) d.traceMaxT = Math.max(d.traceMaxT ?? 0, t)
          if (d.it.varX) this.writeOut(d.it.varX, d.traceMaxT ?? 0)
        } else if (this.grabbed) {
          this.advanceTrace(this.grabbed, d.it, t, d.traceLen ?? 1, onPath)
        }
        if (d.it.pointX && d.it.pointY) this.writeTracePoint(d.it, path, this.tracePos(this.grabbed ?? '', d.it, d.traceMaxT ?? 0))
        this.bustNamed()
      }
      return
    }
    if (d.it.axis === 'reveal') { // scratch/wipe: ticks the cells of a grid covered by the brush -> fraction 0..1 (monotone)
      const g = d.revealGrid
      const cells = d.revealCells
      if (g && cells) {
        const brush = d.it.grid && d.it.grid > 0 ? d.it.grid : 24 // brush radius (px); default 24
        const c0 = Math.max(0, Math.floor((p.x - brush - g.minX) / g.cell)) // bounds of the nearby cells (avoids sweeping the whole grid)
        const c1 = Math.min(g.cols - 1, Math.floor((p.x + brush - g.minX) / g.cell))
        const r0 = Math.max(0, Math.floor((p.y - brush - g.minY) / g.cell))
        const r1 = Math.min(g.rows - 1, Math.floor((p.y + brush - g.minY) / g.cell))
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
          const cx = g.minX + (c + 0.5) * g.cell
          const cy = g.minY + (r + 0.5) * g.cell
          if (Math.hypot(p.x - cx, p.y - cy) > brush) continue // cell center outside the brush -> untouched
          const idx = r * g.cols + c
          const fresh = !cells.has(idx)
          cells.add(idx) // ticked (monotone: a cell never comes back)
          // `cells <array>`: hand the author WHERE it was scratched, not only how much. Written once per
          // cell (on the tick that clears it) — a full-frame grid is hundreds of cells and the pointer
          // sweeps it at ~120 Hz, so re-writing the whole array per move would be the expensive way.
          if (fresh && d.it.cells) this.markCell(d.it.cells, idx)
        }
        if (d.it.varX) this.writeOut(d.it.varX, cells.size / (g.cols * g.rows))
        this.bustNamed()
      }
      return
    }
    if (d.it.axis === 'link') { // pull a wire: the free end follows the pointer (the author DRAWS the wire via endX/endY); target resolved on release
      if (d.it.varX) this.writeOut(d.it.varX, p.x)
      if (d.it.varY) this.writeOut(d.it.varY, p.y)
      this.bustNamed()
      return
    }
    let x = p.x + d.offX
    let y = p.y + d.offY
    if (d.it.grid && d.it.grid > 0) { x = Math.round(x / d.it.grid) * d.it.grid; y = Math.round(y / d.it.grid) * d.it.grid }
    if (d.it.confine) {
      const b = itemBoundsByName(this.doc, d.it.confine)
      if (b) { x = Math.max(b.minX, Math.min(b.maxX, x)); y = Math.max(b.minY, Math.min(b.maxY, y)) }
    }
    const local = apply(d.parentInv, { x, y }) // world -> parent-local (identity at the root)
    if (d.it.axis !== 'y' && d.it.varX) this.writeOut(d.it.varX, local.x)
    if (d.it.axis !== 'x' && d.it.varY) this.writeOut(d.it.varY, local.y)
    this.bustNamed()
  }
  /**
   * CONTINUOUS trace (`step`): the progress may only grow through what the finger actually passes, by at
   * most `step` px of arc length per frame. Everything else follows from that single rule — a press near
   * the end advances nothing (the jump from 0 is the whole path), lifting the finger and putting it back
   * where it was resumes (the state is per TARGET, not per grab), and the entry point must be an END,
   * since nothing else is within `step` of a progress of 0.
   *
   * `both ends`: the far end is a legal entry too, so the run is measured from whichever end was entered
   * (`dir`), and on a CLOSED path — whose two ends are the same point — the direction is simply the one
   * the finger left in. The direction locks on the first ADVANCE, never on the press alone.
   */
  private advanceTrace(id: string, it: Interactor, t: number, length: number, onPath: boolean): void {
    const st = this.traceStates.get(id) ?? { progress: 0, dir: 0 as 0 | 1 | -1 }
    const step = it.step ?? 0
    if (onPath) {
      // The jump is compared with a hair of slack: a replay script that moves by exactly `step` px lands on
      // 40.000000000000004 once the fractions have been through a division, and would stall on its 3rd move.
      const room = step * (1 + 1e-9) + 1e-9
      for (const dir of (st.dir !== 0 ? [st.dir] : it.bothEnds ? [1, -1] as const : [1] as const)) {
        const u = dir === 1 ? t : 1 - t // the finger's position, measured from the entered end
        if (u > st.progress && (u - st.progress) * length <= room) { st.dir = dir; st.progress = u; break }
      }
    }
    this.traceStates.set(id, st)
    if (it.varX) this.writeOut(it.varX, st.progress)
  }
  /** Progress of a trace in the PATH's own parameter (what `samplePathAt` takes), whichever end was entered. */
  private tracePos(id: string, it: Interactor, fallback: number): number {
    if (it.step === undefined) return fallback // cursor mode: the projection is the position
    const st = this.traceStates.get(id)
    if (!st) return 0
    return st.dir === -1 ? 1 - st.progress : st.progress
  }
  /** `point <x>, <y>`: the WORLD point where the ink stops — the pen tip, and the spot to put the finger
   *  back on after a pause. Written on every move AND at load, so the marker starts on the path's start
   *  instead of at the origin. */
  private writeTracePoint(it: Interactor, path: Path, at: number): void {
    if (!it.pointX || !it.pointY) return
    const pt = samplePathAt(path, at).point
    this.writeOut(it.pointX, pt.x)
    this.writeOut(it.pointY, pt.y)
  }
  /**
   * Re-seats the state a gesture keeps OUTSIDE the variables on the variables the document was seeded with
   * — the moment a host restores an activity where a reader left it. `doc.variables` is that seed, and it
   * carried everything that IS a variable; what the player held on the side (a continuous trace's progress,
   * a scratched grid) came back empty, so a restored trace said "three quarters done", drew its ink to
   * three quarters, and sent the finger back to the start on the first touch.
   *
   * Both directions of the same format: a `trace`'s progress is its own variable, and a `reveal`'s grid is
   * the `cells` array it writes. Seed either and the gesture picks up where it was. Runs once per load,
   * before the first paint.
   */
  private reseedDerivedState(): void {
    for (const it of this.doc.interactors ?? []) {
      if (it.axis === 'trace') {
        const seeded = it.varX ? this.vars.get(it.varX) : undefined
        if (it.step !== undefined && typeof seeded === 'number' && seeded > 0) {
          // The END it was entered from is NOT in the seed: `dir` stays undecided and re-locks on the first
          // advance, which is right for a one-way path and picks the finger's side on a `both ends` one.
          this.traceStates.set(it.targetId, { progress: seeded > 1 ? 1 : seeded, dir: 0 })
        }
        if (it.pointX && it.pointY && it.confine) { // …and the marker lands where the ink stops, not at the origin
          const path = this.tracePathFor(it.confine)
          if (path?.subpaths.length) this.writeTracePoint(it, path, this.tracePos(it.targetId, it, 0))
        }
        continue
      }
      if (it.axis !== 'reveal' || !it.cells) continue
      const seeded = this.vars.get(it.cells)
      if (!Array.isArray(seeded) || !seeded.some((v) => v)) continue // nothing scratched (or no grid seeded)
      // The fraction is DERIVED from the grid, so it is recomputed from the cells rather than trusting a
      // second seeded number: one array brings a half-scratched veil back exactly as it was.
      this.reseatReveal(it, seeded)
    }
  }
  /** The reveal state a GRAB starts from: the grid, plus the author's array brought back in line with the
   *  coverage we hold. An ELEMENT write (`grid[i] = 0`) is cosmetic — the coverage behind it did not move —
   *  so it is corrected here rather than letting a scene show an intact cell over a cleared zone. (Writing
   *  the array WHOLE is the other thing entirely: that one re-seats the coverage, see `reseatReveal`.) */
  private revealGrabState(id: string, it: Interactor): RevealState | Record<string, never> {
    const st = this.revealGridFor(id, it)
    if (it.cells && 'revealCells' in st) for (const idx of st.revealCells) this.markCell(it.cells, idx)
    return st
  }
  /** WORLD bbox of every `reveal` target — the zones the hit test honours whatever their content looks like
   *  (see `GrabZones` in hit.ts). Built once per document: a zone is the item's GEOMETRY, which erasing the
   *  veil that fills it does not change. */
  private buildGrabZones(): void {
    const ids = new Set((this.doc.interactors ?? []).filter((i) => i.axis === 'reveal').map((i) => i.targetId))
    this.grabZones = ids.size ? itemBoundsByIds(this.doc, ids) : undefined // ONE walk for all of them
  }
  /** Reveal state for a target: the grid of cells (side = brush) over its WORLD bbox, with the ticked cells
   *  PERSISTED across grabs (`revealStates`) so coverage accumulates monotonically over several strokes. */
  private revealGridFor(id: string, it: Interactor): RevealState | Record<string, never> {
    const cached = this.revealStates.get(id)
    if (cached) return cached // keep accumulating from a previous grab
    const b = this.grabZones?.get(id) ?? itemBoundsById(this.doc, id) // same bbox the hit test uses as the zone
    if (!b) return {}
    // ONE definition of the grid, shared with the `--check` pass that tells the author how many cells to
    // declare (they drifted once, and the array silently lost every write past its end).
    const { cell, cols, rows } = revealGrid(b, it)
    const state: RevealState = { revealCells: new Set<number>(), revealGrid: { minX: b.minX, minY: b.minY, cell, cols, rows } }
    this.revealStates.set(id, state)
    // `erase`: hand the renderer a LIVE view of this grid (same Set) — every ticked cell shows up on the
    // next paint with nothing to copy or invalidate. `brush` = the radius the gesture itself rubs with.
    if (it.erase) this.scratched.set(id, { cells: state.revealCells, minX: b.minX, minY: b.minY, cell, cols, version: 0 })
    return state
  }
  /** On release of a `link`: 1st target (named child of the group) containing the pointer -> index 1..n (0 = none).
   *  If linked, the wire end (endX/endY) sticks to the target center; otherwise it stays at the pointer (the author handles
   *  the "return" via target == 0). Several links coexist: one `link` interactor per source object. */
  private resolveLink(it: Interactor, pointer: Point): void {
    const targets = it.confine ? groupTargets(this.doc, it.confine) : []
    let hit = 0
    for (let i = 0; i < targets.length; i++) {
      const b = targets[i].bbox
      if (pointer.x >= b.minX && pointer.x <= b.maxX && pointer.y >= b.minY && pointer.y <= b.maxY) {
        hit = i + 1
        if (it.varX) this.writeOut(it.varX, (b.minX + b.maxX) / 2)
        if (it.varY) this.writeOut(it.varY, (b.minY + b.maxY) / 2)
        break
      }
    }
    if (it.varT) this.writeOut(it.varT, hit)
    this.bustNamed()
  }
  /** A release that pulled NO thread (the `link` was `{ enabled … }`-gated off, or the gesture was canceled):
   *  its target index is 0 — "no target reached" — not whatever the LAST completed gesture left there.
   *  `{ enabled … }` gates the GESTURE, not the handler: `when released` still fires, so without this the
   *  handler re-read a stale index and, e.g., counted the same pair again on every further press. Only the
   *  target index is reset; the position outputs (varX/varY) are the wire end and stay where they were. */
  private clearLinkTarget(id: string): void {
    const it = this.interactorFor(id)
    if (it?.axis === 'link' && it.varT) { this.writeOut(it.varT, 0); this.bustNamed() }
  }
  /** On release: `when dropped on Zone` whose tested point falls within the zone bbox.
   *  Tested point = the object's CENTER by default, or the POINTER if `at pointer`. Zone = the group's
   *  explicit `hitbox` if present, otherwise the (static) bbox of its content. */
  private fireDrops(id: string, pointer: Point): void {
    const drops = this.handlersFor(id)?.get('drop')
    if (!drops?.length) return
    const pos = objectChannelsById(this.doc, id, this.frame, this.exprCtx(), this.fps)
    const center: Point = { x: pos?.x ?? pointer.x, y: pos?.y ?? pointer.y }
    for (const d of drops) {
      if (!d.over) continue
      const t = d.atPointer ? pointer : center
      const b = dropZoneBounds(this.doc, d.over)
      if (b && t.x >= b.minX && t.x <= b.maxX && t.y >= b.minY && t.y <= b.maxY) runActions(d.actions, this.host)
    }
  }
  private fireEvent(id: string, event: ItemEvent): void {
    const matched = this.handlersFor(id)?.get(event)
    if (!matched?.length) return // no handler -> we skip the self/conversion setup (a scene walk)
    // `self` + conversions in the handler: resolved BEFORE (ctx without self to avoid recursion),
    // set for the duration of the actions, then restored.
    const prevSelf = this.selfChannels
    const prevParent = this.selfParent
    this.selfChannels = null
    this.selfParent = null
    const ctx = this.exprCtx()
    const placed = objectPlacementById(this.doc, id, this.frame, ctx, this.fps) // ONE scene walk for both
    this.selfChannels = placed?.channels ?? null
    this.selfParent = placed?.parent ?? IDENTITY
    for (const x of matched) runActions(x.actions, this.host)
    this.selfChannels = prevSelf
    this.selfParent = prevParent
  }
  private readonly onPointerMove = (e: PointerEvent) => {
    const p = this.worldPoint(e)
    this.mouse.dx += p.x - this.mouse.x // accumulate the movement until the next tick
    this.mouse.dy += p.y - this.mouse.y
    this.mouse.x = p.x
    this.mouse.y = p.y
    if (this.usesMousePos) this.bustNamed() // refresh the expr cache only if something reads mouse.x/y (a drag self-busts in applyDrag); else a move changes no expression input
    if (this.pendingClick && Math.hypot(p.x - this.grabStart.x, p.y - this.grabStart.y) > TAP_TOL) this.pendingClick = null // moved past the tap tolerance → a drag, not a click
    // Grab in progress: the grabbed item receives `drag` (even if the pointer leaves it).
    if (this.grabbed) {
      this.record('move', p, e.pointerId) // record moves ONLY during a drag (reduced volume)
      if (Math.hypot(p.x - this.grabStart.x, p.y - this.grabStart.y) > LONGPRESS_TOL) this.cancelLongPress()
      this.canvas.style.cursor = 'grabbing'
      this.applyDrag(p) // "drag" interactor: writes varX/varY (no-op if no active drag)
      this.fireEvent(this.grabbed, 'drag')
      this.render()
      return
    }
    if (this.doc.interactions?.length || this.doc.interactors?.length) {
      const chains = hitChains(this.doc, this.frame, this.exprCtx(), p, this.grabZones)
      this.hoverIds = new Set(chains[0] ?? []) // topmost stack under the pointer → drives self.hovered feedback
      this.canvas.style.cursor = (this.pickTarget(chains, GRAB_EVENTS) ?? this.pickInteractor(chains)) ? 'grab' : this.pickTarget(chains, CLICK_EVENTS) ? 'pointer' : 'default'
      const hov = this.pickTarget(chains, HOVER_EVENTS)
      if (hov !== this.hovered) {
        if (this.hovered) this.fireEvent(this.hovered, 'leave')
        if (hov) this.fireEvent(hov, 'enter')
        this.hovered = hov
      }
    }
    // Coalesce the move render. A pointermove fires at 125–1000 Hz, but a full render costs ~ms. When a
    // render loop is ALREADY running (playback, or the transition rAF), it repaints the next frame at
    // ~60 fps and `bustNamed()` above makes that frame reflect the new pointer — so a synchronous per-event
    // render here is pure waste that saturates the main thread ("the scene lags when I move the mouse").
    // A static scene (no loop) still renders synchronously, so the cursor/hover follows immediately.
    if (!this.playing && !this.transRaf) this.render() // else: the running loop paints the next frame
  }
  /** Sync `mouse.x/y` to a pointer position WITHOUT the move-delta accumulation, so a `when pressed` /
   *  `when released` handler reads the ACTUAL press/release point. On touch there is no hover `move` to set
   *  it first, so without this `mouse.*` is stale (0,0 on the first touch) inside press/click/release. */
  private trackPointerPos(p: Point): void { this.mouse.x = p.x; this.mouse.y = p.y; this.bustNamed() }
  // Wheel/trackpad scroll → `mouse.wheel` (accumulated delta since the last tick, consumed + reset like dx/dy).
  // An `every frame` script reads it: `Off = clamp(Off + mouse.wheel * k, 0, max)`. `preventDefault` only when
  // the scene actually reads it, so a scene that ignores the wheel still lets the page scroll over the canvas.
  private readonly onWheel = (e: WheelEvent) => {
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (this.canvas.height || 600) : 1 // lines / pages → px
    this.mouse.wheel += e.deltaY * k
    if (this.usesWheel) e.preventDefault()
    this.bustNamed()
    this.render()
  }
  private readonly onPointerDown = (e: PointerEvent) => {
    if (!this.doc.interactions?.length && !this.doc.interactors?.length) return
    const p = this.worldPoint(e)
    this.trackPointerPos(p) // mouse.* must reflect the press point for `when pressed`/`when clicked` (touch: no prior hover)
    this.record('down', p, e.pointerId)
    const chains = hitChains(this.doc, this.frame, this.exprCtx(), p, this.grabZones)
    const clickId = this.pickTarget(chains, CLICK_EVENTS)
    const grabId = this.pickTarget(chains, GRAB_EVENTS) ?? this.pickInteractor(chains) // grabbable = handler OR interactor
    this.grabStart = p // press point (tap/long-press movement tolerance) — set for the click case too, not only grabs
    this.pendingClick = clickId // DEFERRED: fired on release iff the pointer stayed a tap (cleared by a drag move)
    if (clickId && !grabId) this.canvas.setPointerCapture?.(e.pointerId) // a click-only target still needs the release
    if (grabId) {
      this.grabbed = grabId
      const inter = this.interactorFor(grabId)
      if (inter && this.interactorEnabled(inter)) { // capture the grab offset (the clicked point stays under the cursor) + the parent transform
        const placed = objectPlacementById(this.doc, grabId, this.frame, this.exprCtx(), this.fps) // ONE scene walk for both
        const pos = placed?.channels
        const parent = placed?.parent ?? IDENTITY
        this.dragActive = { it: inter, offX: (pos?.x ?? p.x) - p.x, offY: (pos?.y ?? p.y) - p.y, parentInv: invert(parent), ...(inter.axis === 'trace' ? traceGrab((n) => this.tracePathFor(n), inter) : {}), ...(inter.axis === 'reveal' ? this.revealGrabState(grabId, inter) : {}) }
      }
      this.canvas.setPointerCapture?.(e.pointerId) // keep the drag even if the pointer leaves the canvas
      this.fireEvent(grabId, 'press')
      this.cancelLongPress()
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null
        if (this.grabbed === grabId) { this.fireEvent(grabId, 'longpress'); this.render() }
      }, LONGPRESS_MS)
    }
    if (clickId || grabId) this.render() // reflects the changes (variables/frame)
  }
  private readonly onPointerUp = (e: PointerEvent) => {
    // Release the capture acquired on down even if the press never became a grab/tap (e.g. a click-only
    // target whose press turned into a drag) — guarded so it never throws on an uncaptured pointer.
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)
    if (!this.grabbed && this.pendingClick === null) return
    const grabbedId = this.grabbed
    const click = this.pendingClick
    this.pendingClick = null
    const p = this.worldPoint(e)
    this.trackPointerPos(p) // mouse.* must reflect the release point for `when released`/`when clicked`
    this.record('up', p, e.pointerId)
    if (grabbedId) {
      // Write the gesture outputs BEFORE emitting `release`, so a `when released` handler can read them
      // (link target index / end position) — consistent with `drag`, which writes its vars before `dragged`.
      if (this.dragActive?.it.axis === 'link') this.resolveLink(this.dragActive.it, p) // tests the reached target -> writes the index (0 = none)
      else this.clearLinkTarget(grabbedId) // no thread was pulled (gated off) -> index 0, never a stale one
      this.fireEvent(grabbedId, 'release')
      if (this.dragActive) this.fireDrops(grabbedId, p) // `when dropped on Zone`
      this.clearGrab()
    }
    if (click) this.fireEvent(click, 'click') // the press stayed a tap (pointer within TAP_TOL) → click now, not on press
    this.render()
  }
  // Interrupted gesture (canceled touch, OS gesture): we release WITHOUT a drop (the pointer did not "let go" on a target).
  private readonly onPointerCancel = (e: PointerEvent) => {
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId) // release even a click-only capture
    this.pendingClick = null // an interrupted gesture is never a click
    if (!this.grabbed) return
    const id = this.grabbed
    this.record('cancel', this.worldPoint(e), e.pointerId)
    this.clearLinkTarget(id) // an interrupted gesture reached no target either
    this.fireEvent(id, 'release')
    this.clearGrab()
    this.render()
  }
  private cancelLongPress(): void {
    if (this.longPressTimer !== null) { clearTimeout(this.longPressTimer); this.longPressTimer = null }
  }
  private clearGrab(): void {
    this.grabbed = null
    this.dragActive = null
    this.cancelLongPress()
  }
  /** Surface exposed to the action interpreter (frame-actions, future onClick). */
  private readonly host: ActionHost = {
    play: () => this.play(),
    pause: () => this.pause(),
    seek: (f) => this.seek(f),
    labelFrame: (name) => this.doc.timeline?.labels?.find((l) => l.name === name)?.frame,
    setVar: (name, v) => { this.setVarLive(name, v) },
    setIndex: (name, i, v) => { const a = this.vars.get(name); if (Array.isArray(a) && i >= 0 && i < a.length) a[i] = v }, // in-place: ctx shares the array ref
    fillVar: (name, count, value) => this.setVarLive(name, new Array<number>(Math.max(0, Math.min(MAX_FILL, Math.floor(count)))).fill(value)),
    setParam: (target, param, value) => this.setParam(target, param, value),
    callProc: (name, args) => this.callProc(name, args),
    evalNumber: (src) => this.evalNumber(src),
    emit: (name, value, fields) => this.emit(name, value, fields),
    textContent: (itemId) => this.textContent(itemId),
    playSound: (assetId) => this.playSound(assetId),
  }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    doc: Doc,
    opts: PlayerOptions = {},
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('FlatPlayer: 2D context unavailable')
    this.ctx = ctx
    this.doc = applyInstanceBinds(withCels(sanitizeDoc(doc)))
    this.applyInputUse()
    this.hasModifiers = docHasModifiers(this.doc)
    this.hasSymbolTimelines = this.doc.symbols.some((s) => !!s.timeline)
    this.buildGrabZones()
    this.traceOutputs = traceOutputNames(this.doc)
    this.loop = opts.loop ?? true
    this.pad = opts.padding ?? 0
    this.audioOn = opts.audio ?? true
    this.onEvent = opts.onEvent
    this.renderOn = opts.render ?? true
    this.imageProvider = opts.image
    // Default resolver: embedded `data:` URIs only (no remote fetch) — the secure default.
    this.resolveAsset = opts.resolveAsset ?? ((a) => (isEmbeddedData(a.data) ? a.data : null))
    this.vars = cloneVars(doc.variables)
    this.buildFunctions()
    this.reseedDerivedState() // …once `vars` exists: a seeded trace/scratch comes back where it was
    this.measure()
    this.render()
    this.fireLoad()
    window.addEventListener('resize', this.onResize)
    if (opts.input ?? true) { // false (gallery preview): plays the anim but does not attach the inputs
      globalThis.addEventListener('keydown', this.onKeyDown)
      globalThis.addEventListener('keyup', this.onKeyUp)
      globalThis.addEventListener('blur', this.onBlur) // alt-tab: no keyup is delivered -> release the held keys
      this.canvas.addEventListener('pointermove', this.onPointerMove)
      this.canvas.addEventListener('pointerdown', this.onPointerDown)
      this.canvas.addEventListener('pointerup', this.onPointerUp)
      this.canvas.addEventListener('pointercancel', this.onPointerCancel)
      this.canvas.addEventListener('pointerleave', this.onPointerLeave)
      this.canvas.addEventListener('wheel', this.onWheel, { passive: false }) // non-passive: may preventDefault when the scene reads mouse.wheel
      this.scheduleHitWarm() // pre-flatten hittable paths on idle → the FIRST move/click isn't a cold-start jolt
    }
    if (opts.autoplay) this.play()
  }

  /**
   * Timelines of "active" symbols (referenced by >=1 instance), deduplicated,
   * with a representative local frame. NB (v1): single playhead -> the symbol
   * actions share the global state; gotoFrame/play acts on the root.
   */
  private activeSymbolTimelines(rootFrame: number): { tl: Timeline; frame: number }[] {
    // The walk can only ever report a symbol that HAS a timeline. When the library declares none — the
    // common case for a scene whose symbols are plain drawings — the answer is empty without walking, and
    // this runs once per rendered frame plus once per simulation step.
    if (!this.hasSymbolTimelines) return []
    const out: { tl: Timeline; frame: number }[] = []
    const seenSym = new Set<string>()
    const walk = (layers: Layer[], frame: number, seen: Set<string>) => {
      for (const layer of layers) {
        for (const it of layer.items) {
          if (isInstance(it)) {
            if (seen.has(it.symbolId)) continue
            const sym = getSymbol(this.doc, it.symbolId)
            const local = sym?.timeline ? resolveInstanceFrame(it.playback, frame, sym.timeline.durationFrames) : frame
            if (sym?.timeline && !seenSym.has(it.symbolId)) {
              seenSym.add(it.symbolId)
              out.push({ tl: sym.timeline, frame: local })
            }
            walk(containerLayers(this.doc, it), local, new Set([...seen, it.symbolId]))
          } else if (isGroup(it)) {
            walk(it.layers, frame, seen)
          }
        }
      }
    }
    walk(this.doc.layers, rootFrame, new Set())
    return out
  }

  /** Actions on load (onLoad): root + active symbols. */
  private fireLoad(): void {
    let changed = false
    if (this.doc.timeline?.onLoad?.length) {
      runActions(this.doc.timeline.onLoad, this.host)
      changed = true
    }
    for (const s of this.activeSymbolTimelines(0)) {
      if (s.tl.onLoad?.length) {
        runActions(s.tl.onLoad, this.host)
        changed = true
      }
    }
    if (changed) this.render()
  }

  /** (Re)compiles the available functions: imported packages (`use ...`) + doc functions (`fn ...`,
   *  which TAKE PRECEDENCE on a name clash). -> procedures + value functions. */
  private buildFunctions(): void {
    this.procs.clear()
    this.valueFuncs = []
    for (const f of [...importedFunctions(this.doc.imports), ...(this.doc.functions ?? [])]) {
      if (f.kind === 'proc') this.procs.set(f.name, { params: f.params, body: f.body })
      else this.valueFuncs.push({ name: f.name, params: f.params, comp: compileCached(f.expr) })
    }
    this.funcNames = new Set(this.valueFuncs.map((f) => f.name))
    this.ctxCache = null // function set changed → drop the cached context
  }

  /** Writes a variable AND keeps the per-frame ctx cache in sync (write-through), so `exprCtx` never has to
   *  re-copy every variable on each eval. Reserved names (time/frame/clock/value) and function names are
   *  never overwritten in the ctx. */
  private setVarLive(name: string, value: number | number[]): void {
    this.vars.set(name, value)
    if (this.ctxCache && !this.funcNames.has(name) && !RESERVED.has(name)) this.ctxCache[name] = value
    // A continuous `trace` keeps its progress across grabs, so the ONLY way to restart the exercise is the
    // one an author would write anyway: assign the progress variable (`avance = 0`). The variable stays the
    // source of truth — without this, `avance = 0` would blank the ink and the next touch would jump back
    // to where the finger had got to.
    if (this.traceOutputs.size && this.traceOutputs.has(name) && typeof value === 'number') this.syncTraceState(name, value)
    // Same rule for a scratch: the `cells` array is the truth, in BOTH directions. Writing it WHOLE
    // (`grid = fill(n, 0)` to blank a reopened board, or a host seeding a saved one) re-seats the coverage
    // — otherwise the zeroed array would be silently repopulated from the grid on the next grab.
    // Element writes (`grid[i] = …`) are left alone: the gesture itself makes thousands of them.
    if (Array.isArray(value)) for (const it of this.doc.interactors ?? []) if (it.axis === 'reveal' && it.cells === name) this.reseatReveal(it, value)
  }
  /** Rebuild a `reveal`'s ticked cells from its `cells` array, and recompute the fraction from them. The
   *  mask the renderer holds is the same `Set`, so `erase` follows without anything to invalidate. */
  private reseatReveal(it: Interactor, cells: number[]): void {
    const st = this.revealGridFor(it.targetId, it)
    if (!('revealGrid' in st) || !st.revealGrid) return
    const total = st.revealGrid.cols * st.revealGrid.rows
    st.revealCells.clear()
    for (let i = 0; i < cells.length && i < total; i++) if (cells[i]) st.revealCells.add(i)
    // The renderer stamps cells INCREMENTALLY (append-only). Rebuilding the set breaks that assumption, so
    // say it: the mask is restamped from scratch on the next paint instead of gaining a few discs.
    const mask = this.scratched.get(it.targetId)
    if (mask) mask.version = (mask.version ?? 0) + 1
    if (it.varX) this.setVarLive(it.varX, st.revealCells.size / total)
  }
  /** Re-seat every continuous trace whose progress variable is `name` on the value the scene just wrote. */
  private syncTraceState(name: string, value: number): void {
    const p = value < 0 ? 0 : value > 1 ? 1 : value
    for (const it of this.doc.interactors ?? []) {
      if (it.axis !== 'trace' || it.step === undefined || it.varX !== name) continue
      const st = this.traceStates.get(it.targetId)
      this.traceStates.set(it.targetId, { progress: p, dir: p === 0 ? 0 : (st?.dir ?? 0) }) // back to 0 ⇒ the entry end is open again
      if (it.pointX && it.pointY && it.confine) {
        const path = this.tracePathFor(it.confine)
        if (path?.subpaths.length) this.writeTracePoint(it, path, this.tracePos(it.targetId, it, p))
      }
    }
  }

  /** Calls a procedure `fn name(p) { ... }`: binds the params (save/restore), bounds the recursion. */
  private callProc(name: string, args: number[]): void {
    const f = this.procs.get(name)
    if (!f || this.funcDepth > 64) return
    const saved = f.params.map((p) => [p, this.vars.get(p)] as const)
    f.params.forEach((p, i) => this.setVarLive(p, args[i] ?? 0))
    this.funcDepth++
    runActions(f.body, this.host)
    this.funcDepth--
    for (const [p, v] of saved) {
      if (v === undefined) { this.vars.delete(p); if (this.ctxCache) delete this.ctxCache[p] }
      else this.setVarLive(p, v)
    }
  }

  /** Runtime context for expressions: variables (flattened), mouse, keys, random, value functions,
   *  + scene objects by name (`Hero.x`, cf. sceneRefs). */
  private exprCtx(vars: Map<string, number | number[]> = this.vars): ExprContext {
    const interp = vars !== this.vars // interpolated render context -> we do not touch the memo (frame unchanged)
    // FAST PATH: same frame, no handler `self`, real vars → reuse the cached ctx, refreshing only the live
    // variables (intra-frame `setVar`s). The costly parts (named-channel copy, func closures) are reused.
    // `funcNames` keep priority over a same-named var (matches the build order funcs-after-vars).
    const cacheable = !interp && !this.selfChannels && !this.selfParent
    // Cache HIT: the variables are kept in sync by `setVarLive` (write-through on every setVar), so we hand
    // back the cached ctx as-is — no per-call refresh loop (that was O(vars) on EVERY eval, hundreds/frame).
    if (cacheable && this.ctxCache && this.ctxFrame === this.frame && this.namedFrame === this.frame) return this.ctxCache
    // `time`/`frame`/`clock` baked in (per-frame constants) so `evalNumber` can evaluate against this ctx
    // DIRECTLY — no `exprScope` copy per statement (object construction dominated the sim profile). They are
    // reserved (never shadowed by a same-named variable), so the var loops skip them.
    const ctx: ExprContext = { mouse: this.mouse, keys: this.keyProxy, random: () => Math.random(), clock: this.mono / this.fps, time: this.frame / this.fps, frame: this.frame }
    for (const [k, v] of vars) if (!RESERVED.has(k)) ctx[k] = v
    for (const vf of this.valueFuncs) { // fn name(p) = expr -> closure (the body sees globals + math + time + params)
      ctx[vf.name] = (...args: number[]) => {
        if (this.funcDepth > 64 || !vf.comp.ok) return Number.NaN
        const local = exprScope(ctx, this.frame / this.fps, this.frame)
        vf.params.forEach((p, i) => { local[p] = args[i] ?? 0 })
        this.funcDepth++
        const r = evalExpr(vf.comp.node, local, Number.NaN)
        this.funcDepth--
        return r
      }
    }
    // Named scene objects (Hero.x, Enemy.y...): resolved with the BASE ctx (above) to
    // avoid any recursive cross-reference; never overwrites a variable/function of the same name.
    // Memoized for the current frame: reused by all the evalNumber of a single tick (the variable
    // mutations within a frame do not bust it -> a named object's position = start-of-frame snapshot,
    // consistent with the "one level" resolution; bustNamed() refreshes it on mouse/keyboard/seek/load).
    if (interp) {
      // Interpolated render: we recompute the named channels from the interpolated vars (no memo).
      const named = namedChannels(this.doc, this.frame, ctx, this.fps)
      for (const name in named) if (!(name in ctx)) ctx[name] = named[name]
    } else {
      if (!this.namedCache || this.namedFrame !== this.frame) {
        this.namedCache = namedChannels(this.doc, this.frame, ctx, this.fps)
        this.namedFrame = this.frame
      }
      for (const name in this.namedCache) if (!(name in ctx)) ctx[name] = this.namedCache[name]
    }
    // `self` set during a handler's execution (cf. fireEvent); in a channel binding, cel/timeline
    // re-inject it with the binding's object (priority). Absent (null) outside a handler -> no `self`.
    if (this.selfChannels) ctx.self = this.selfChannels
    // World<->local conversions relative to the handler's object (cf. RFC coordinate-spaces): a WORLD point
    // (mouse.x, Hero.x) -> the object's PARENT space (where its x/y live), and inverse.
    if (this.selfParent) Object.assign(ctx, spaceConversions(this.selfParent))
    if (cacheable) { this.ctxCache = ctx; this.ctxFrame = this.frame } // reuse this build for the rest of the frame
    return ctx
  }
  private evalNumber(src: string): number {
    const c = compileCached(src)
    if (!c.ok) return 0
    // Evaluate against the per-frame ctx DIRECTLY (it already carries time/frame/clock; math resolves via
    // evalNode's MATH_CTX fallback) — no `exprScope` copy per call. This is the hot `every frame` path.
    return evalExpr(c.node, this.exprCtx(), 0)
  }

  /**
   * Emits a `send` event toward the host. Silent no-op if no `onEvent` is provided
   * (e.g. editor preview). Defense-in-depth validation (the parser already guarantees the name):
   * conforming name, finite number (NaN -> 0, DSL convention), text <= MAX_SEND_TEXT (truncated),
   * record fields <= MAX_SEND_FIELDS with conforming keys. The host receives a VETTED object.
   * If the host callback throws, we catch and log -- the player does not break.
   */
  private emit(name: string, value?: number | string, fields?: Record<string, number>): void {
    if (!this.onEvent || !SEND_EVENT_NAME.test(name)) return
    let v = value
    if (typeof v === 'number') { if (!Number.isFinite(v)) v = 0 }
    else if (typeof v === 'string' && v.length > MAX_SEND_TEXT) v = v.slice(0, MAX_SEND_TEXT)
    let f: Record<string, number> | undefined
    if (fields) {
      // Own keys only, conforming names only (never `__proto__`/`constructor`/`prototype`: the host
      // spreads this patch into its own state), bounded count, each value a finite number (NaN -> 0).
      f = {}
      let n = 0
      for (const k of Object.keys(fields)) {
        if (n >= MAX_SEND_FIELDS) break
        if (!isSendField(k)) continue
        f[k] = Number.isFinite(fields[k]) ? fields[k] : 0
        n++
      }
    }
    try {
      const ev: SendEvent = { name }
      if (v !== undefined) ev.value = v
      if (f !== undefined) ev.fields = f
      this.onEvent(ev)
    } catch (e) {
      console.error('FlatPlayer: the onEvent callback threw an exception', e)
    }
  }

  /** Live content of a Text item resolved by id OR name (for `text("...")`). `''` + warning if absent. */
  private textContent(key: string): string {
    const t = this.findText(key)
    if (!t) {
      console.warn(`FlatPlayer: text("${key}") -- no Text item "${key}" (id or name) in the document`)
      return ''
    }
    return t.content.length > MAX_SEND_TEXT ? t.content.slice(0, MAX_SEND_TEXT) : t.content
  }

  /**
   * Looks up a Text item in the scene (layers + groups) and the library symbols.
   * Resolves by `id` first (stable id set via `text "..." as "<id>"`), then by `name` as a fallback --
   * like the rest of the text format references by name (`object "x"`, `instance "Sym" as "y"`).
   */
  private findText(key: string): Text | undefined {
    const scan = (layers: Layer[], match: (t: Text) => boolean): Text | undefined => {
      for (const layer of layers) {
        for (const it of layer.items) {
          if (isText(it)) { if (match(it)) return it }
          else if (isGroup(it)) { const f = scan(it.layers, match); if (f) return f }
        }
      }
      return undefined
    }
    const find = (match: (t: Text) => boolean): Text | undefined => {
      const inScene = scan(this.doc.layers, match)
      if (inScene) return inScene
      for (const s of this.doc.symbols) { const f = scan(s.layers, match); if (f) return f }
      return undefined
    }
    return find((t) => t.id === key) ?? find((t) => t.name === key)
  }

  /** Plays an audio clip (asset) as a one-shot (`sound "id"` DSL). No-op if audio is off / asset absent. */
  private playSound(assetId: string): void {
    if (!this.audioOn) return
    const c = getAudioCtx()
    if (c.state === 'suspended') void c.resume()
    const buf = playerAudioBuffers.get(assetId)
    if (!buf || buf === 'loading') { this.decodeAudio(assetId); return } // decoded in the background -> audible on the next trigger
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(c.destination)
    src.onended = () => { this.activeSources = this.activeSources.filter((s) => s !== src) } // frees the finished one-shot (anti-leak if `sound` is spammed)
    src.start()
    this.activeSources.push(src)
  }

  get fps(): number {
    return Math.max(1, this.doc.timeline?.fps ?? 24) // safeguard: fps <= 0 (dubious timeline directive) -> no division by 0
  }
  get duration(): number {
    return Math.max(1, this.doc.timeline?.durationFrames ?? 1)
  }
  get currentFrame(): number {
    return this.frame
  }
  get isPlaying(): boolean {
    return this.playing
  }

  /**
   * Reads a state variable (Layer B) from the host: score, difficulty... `undefined` if absent.
   * Returns a COPY of the arrays (the host cannot mutate the internal state by reference).
   */
  getVar(name: string): number | number[] | undefined {
    const v = this.vars.get(name)
    return Array.isArray(v) ? [...v] : v
  }

  /** Snapshot (copied) of all the state variables -- for debugging / the headless harness. */
  allVars(): Record<string, number | number[]> {
    const out: Record<string, number | number[]> = {}
    for (const [k, v] of this.vars) out[k] = Array.isArray(v) ? [...v] : v
    return out
  }

  // -- Gesture recording (`--record`) --
  /** Starts recording (clears the previous one). Play the activity by hand, then `stopRecording()`. */
  startRecording(): void { this.recording = []; this.recordFrame = this.frame }
  /** Stops recording and returns the gesture script (replayable by `--play` / `playHeadless`). */
  stopRecording(): Gesture[] { const r = this.recording ?? []; this.recording = null; return r }
  get isRecording(): boolean { return this.recording != null }

  /** Center (RESOLVED origin, expressions included) of a named object, in world coords -- for the
   *  semantic gestures `drag`/`tap` by name. `null` if the object does not exist. */
  objectCenter(name: string): Point | null {
    this.exprCtx() // (re)computes the named-objects cache for the current frame
    const ch = this.namedCache?.[name]
    return ch ? { x: ch.x, y: ch.y } : null
  }
  /** Captures a gesture (no-op outside recording). Inserts a `wait` = frames elapsed since the last gesture. */
  private record(type: 'down' | 'move' | 'up' | 'cancel', p: Point, id: number): void {
    if (!this.recording) return
    const dframes = Math.round(this.frame - this.recordFrame)
    if (dframes > 0) { this.recording.push({ type: 'wait', frames: dframes }); this.recordFrame = this.frame }
    const r = (n: number) => Math.round(n * 100) / 100
    this.recording.push({ type, x: r(p.x), y: r(p.y), ...(id !== 1 ? { id } : {}) })
  }

  /**
   * Writes a state variable (Layer B) from the host, then redraws -> bidirectional
   * driving channel (the host sets the difficulty, injects a value, etc.). Clones the arrays.
   */
  setVar(name: string, value: number | number[]): void {
    // The SAME path as an assignment written in the scene (`setVarLive`), never a bare `vars.set`: the two
    // used to differ, and the difference was invisible from outside — a host restoring a continuous trace's
    // progress got the right number, the right inked stroke, and a pen-tip marker still sitting at the
    // start, because only the scene-side path re-seated the derived state.
    this.setVarLive(name, Array.isArray(value) ? [...value] : value) // (arrays cloned: the host keeps its own)
    this.bustNamed() // host-driven change -> named objects bound to this variable must be refreshed
    this.render()
  }

  /**
   * Presses (`down: true`) or releases a key programmatically -- exactly what a physical key does to
   * `keys.<Name>` in the expressions. For an ON-SCREEN control (a touch D-pad, where there is no
   * keyboard) and for the headless `key` gesture. `name` is the authored one (`"ArrowRight"`,
   * `"Space"`). A pressed key STAYS held until released: pair every `true` with a `false`.
   */
  setKey(name: string, down: boolean): void {
    this.holdKey(name, down)
    this.render()
  }

  /** Replaces the played document (resets the framing + the variables, keeps the frame). */
  load(doc: Doc): void {
    this.doc = applyInstanceBinds(withCels(sanitizeDoc(doc)))
    this.applyInputUse()
    this.vars = cloneVars(doc.variables)
    this.namedCache = null // new document -> named-objects cache stale
    this.ctxCache = null // new document -> cached expr context stale (vars Map replaced just above)
    this.filterCache.clear() // new document -> filter bitmaps stale
    this.revealStates.clear() // new document -> reveal coverage resets
    this.traceStates.clear() // …and so does a continuous trace's progress
    this.scratched.clear() // …and so does what the renderer rubs out (`erase`)
    // Every by-document lookup, dropped BEFORE anything below can consult it — `reseedDerivedState` asks
    // for a `trace`'s path to place its pen tip, and answering that from the PREVIOUS document is exactly
    // the kind of bug a cache introduces.
    this.instNameCache = undefined // new document -> name→instance lookup stale
    this.assetCache = undefined // …and so is the asset lookup
    this.tracePathCache.clear() // …and the `trace` target geometry
    this.handlerIndex = undefined // …and the handler/interactor indexes
    this.interactorIndex = undefined
    this.traceOutputs = traceOutputNames(this.doc)
    this.buildGrabZones() // new document -> new geometry for the `reveal` grab zones
    this.reseedDerivedState() // …then the seeded variables put the derived state back (trace progress, scratched grid)
    this.paramRt.clear() // new document -> per-instance param transitions reset
    this.channelState.clear() // new document -> modifier integrator state resets
    this.velocityState.clear()
    this.modAcc = 0
    this.hasModifiers = docHasModifiers(this.doc)
    this.hasSymbolTimelines = this.doc.symbols.some((s) => !!s.timeline)
    if (this.transRaf) { cancelAnimationFrame(this.transRaf); this.transRaf = 0 }
    this.bustNamed()
    this.buildFunctions()
    this.measure()
    this.render()
    this.fireLoad()
  }

  private measure(): void {
    const r = this.canvas.getBoundingClientRect()
    this.dpr = window.devicePixelRatio || 1
    this.cssW = r.width
    this.cssH = r.height
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr))
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr))
    this.view = fit(r.width, r.height, this.doc.width, this.doc.height, this.pad)
  }

  /** Draws the current frame (pure, without advancing time). */
  render(): void {
    if (!this.renderOn) return // headless: no painting (no Canvas API required)
    const { ctx, doc, view, dpr } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, this.cssW, this.cssH)
    ctx.save()
    ctx.translate(view.tx, view.ty)
    ctx.scale(view.scale, view.scale)
    if (doc.background) {
      ctx.fillStyle = doc.background
      ctx.fillRect(0, 0, doc.width, doc.height)
    }
    ctx.beginPath()
    ctx.rect(0, 0, doc.width, doc.height)
    ctx.clip()
    // Anti-judder: during a game's playback (sim active), we draw the motion at the INTERPOLATED
    // position between the two last sim steps (the mouse/playhead themselves stay at the current instant).
    const expr = this.playing && this.simActive && this.prevSimVars && this.simAlpha < 1
      ? this.exprCtx(lerpVars(this.prevSimVars, this.vars, this.simAlpha))
      : this.exprCtx()
    renderLayers(ctx, doc, doc.layers, this.frame, null, new Set(), { fps: this.fps, expr, image: (id) => this.imageFor(id), filterCache: this.filterCache, imageEpoch: this.imageEpoch, itemState: (id) => this.itemStateFor(id), paramsFor: (id) => this.paramsForInstance(id), monoTime: this.mono / this.fps, ...(this.scratched.size ? { scratched: this.scratched } : {}), ...(this.hasModifiers ? { statePath: '', channelValue: (key: string, ch: string) => this.channelValueFor(key, ch) } : {}) })
    ctx.restore()
  }

  /** Interaction state of an item for `self.hovered`/`self.grabbed`/`self.pressed` in its channel exprs.
   *  Returns undefined when the item is neither hovered nor grabbed (the cheap, common path → flags 0). */
  private itemStateFor(id: string): { hovered: number; grabbed: number; pressed: number } | undefined {
    const hovered = this.hoverIds.has(id) ? 1 : 0
    const grabbed = this.grabbed === id ? 1 : 0
    return hovered || grabbed ? { hovered, grabbed, pressed: grabbed } : undefined
  }

  /** Integrated value of a stateful channel modifier for `statePath+itemId` (key) + channel — read by the
   *  render pass. Undefined (random access / no state yet) → the channel snaps to its target (rest pose). */
  private channelValueFor(key: string, ch: string): number | undefined {
    return this.channelState.get(key + '|' + ch)?.pos
  }

  /** Advance every stateful channel modifier by `steps` FIXED steps toward its current target (gathered by a
   *  render-free scene walk that composes the per-instance state path). NOT gated by `onEnterFrame`/input —
   *  an asset's own "feel" must animate even with no scene behavior (this is the whole point of the feature). */
  private advanceChannelModifiers(steps: number): void {
    if (!this.hasModifiers || steps <= 0) return
    const rctx: RenderCtx = { fps: this.fps, expr: this.exprCtx(), itemState: (id) => this.itemStateFor(id), paramsFor: (id) => this.paramsForInstance(id), monoTime: this.mono / this.fps, statePath: '' }
    // `velocity(arg)` resolver for this tick: per-(key,channel) prev values, delta PER SECOND (dt = real time
    // advanced this tick). A fresh closure per target carries its own occurrence index → one slot per velocity().
    const dt = steps * SIM_STEP
    const velocityFor = (key: string, ch: string) => {
      const k = key + '|' + ch
      let prev = this.velocityState.get(k)
      if (!prev) { prev = []; this.velocityState.set(k, prev) }
      const slots = prev
      let i = 0
      return (arg: number): number => { const last = slots[i]; slots[i] = arg; i++; return last === undefined || dt <= 0 ? 0 : (arg - last) / dt }
    }
    for (const t of collectModifierTargets(this.doc, this.frame, rctx, velocityFor)) {
      const k = t.key + '|' + t.ch
      const cur = this.channelState.get(k) ?? restState(t.target)
      this.channelState.set(k, advanceModifier(t.mod, cur, t.target, steps))
    }
  }

  // ── Per-instance exposed params (P3 states) ───────────────────────────────────
  /** Scene instance (id + symbol) by NAME; first carrier wins (document order), groups recursed. Cached. */
  private instanceByName(name: string): { id: string; symbolId: string } | undefined {
    if (!this.instNameCache) {
      const m = new Map<string, { id: string; symbolId: string }>()
      const walk = (layers: Layer[]) => {
        for (const l of layers) for (const it of l.items) {
          if (isInstance(it) && it.name && !m.has(it.name)) m.set(it.name, { id: it.id, symbolId: it.symbolId })
          if (isGroup(it)) walk(it.layers)
        }
      }
      walk(this.doc.layers)
      this.instNameCache = m
    }
    return this.instNameCache.get(name)
  }

  /** `Door.door = open`: set an instance's exposed param. Resolves a state NAME via the symbol's state
   *  machine (else evaluates the expression), and starts a transition over the state machine's `transition`
   *  frames (snap if 0). Drives the instance's local playhead through `paramsForInstance`. */
  private setParam(target: string, param: string, raw: string): void {
    const inst = this.instanceByName(target)
    if (!inst) return // unknown instance → no-op
    const sym = getSymbol(this.doc, inst.symbolId)
    const sm = stateMachineByParam(sym?.states, param)
    const trimmed = raw.trim()
    let targetVal = sm && sm.states.some((s) => s.name === trimmed) ? stateValueOf(sm, trimmed) : this.evalNumber(raw)
    if (!Number.isFinite(targetVal)) return
    // Clamp a declared number param to its range (consistent with call-site/default resolution).
    const def = sym?.params?.find((p) => p.name === param && p.type === 'number')
    if (def?.min != null && def.max != null && def.min <= def.max) targetVal = Math.max(def.min, Math.min(def.max, targetVal))
    let params = this.paramRt.get(inst.id)
    if (!params) { params = new Map(); this.paramRt.set(inst.id, params) }
    const cur = params.get(param)?.value ?? (sm ? initialStateValue(sm) : 0)
    const dur = Math.max(0, sm?.transition ?? 0)
    params.set(param, { value: dur > 0 ? cur : targetVal, from: cur, target: targetVal, elapsed: 0, dur, ease: sm?.ease })
    this.bustNamed()
    this.ensureTransitions()
    this.render()
  }

  /** Current values of an instance's params (for drawScene → drives the local frame + the subtree scope). */
  private paramsForInstance(id: string): Record<string, number> | undefined {
    const params = this.paramRt.get(id)
    if (!params || params.size === 0) return undefined
    const out: Record<string, number> = {}
    for (const [k, st] of params) out[k] = st.value
    return out
  }

  /** Advance in-progress param transitions by `deltaFrames`; eased from→target over `dur`. Returns whether
   *  any transition is still running (so the caller can keep ticking). */
  private advanceParams(deltaFrames: number): boolean {
    let active = false
    for (const params of this.paramRt.values()) {
      for (const st of params.values()) {
        if (st.elapsed >= st.dur) { st.value = st.target; continue }
        st.elapsed = Math.min(st.dur, st.elapsed + Math.max(0, deltaFrames))
        const p = st.dur > 0 ? st.elapsed / st.dur : 1
        st.value = st.from + (st.target - st.from) * applyEasing(p, st.ease)
        if (st.elapsed < st.dur) active = true
        else st.value = st.target
      }
    }
    return active
  }

  /** While the playhead is NOT playing, drive active transitions on their own rAF (handed back to the
   *  main tick once playback resumes). No-op without requestAnimationFrame (headless → advanced via stepSim). */
  private ensureTransitions(): void {
    if (this.playing || this.transRaf || typeof requestAnimationFrame !== 'function') return
    let any = false
    for (const ps of this.paramRt.values()) for (const st of ps.values()) if (st.elapsed < st.dur) { any = true; break }
    if (!any) return
    let prev = 0
    const step = (now: number) => {
      if (this.playing) { this.transRaf = 0; return } // the main tick takes over
      const dt = prev ? Math.min((now - prev) / 1000, 0.25) : 0
      prev = now
      const stillActive = this.advanceParams(dt * this.fps)
      this.render()
      this.transRaf = stillActive ? requestAnimationFrame(step) : 0
    }
    this.transRaf = requestAnimationFrame(step)
  }

  /** WORLD path of a `trace` target, by name (see `tracePathCache`). */
  private tracePathFor(name: string): Path | null {
    let p = this.tracePathCache.get(name)
    if (p === undefined) { p = tracePathByName(this.doc, name); this.tracePathCache.set(name, p) }
    return p
  }
  /** Assets by id. The renderer asks for an image's source on EVERY frame it draws it, and a scan of the
   *  asset list per image per frame is the kind of cost that only shows up on the scenes that have many of
   *  both. Built lazily, dropped on `load` (a new document brings new assets). */
  private assetById(id: string): Asset | undefined {
    if (!this.assetCache) this.assetCache = new Map((this.doc.assets ?? []).map((a) => [a.id, a]))
    return this.assetCache.get(id)
  }
  // Decoded image of an asset (module cache). `null` while not loaded -> re-render on decode.
  private imageFor(assetId: string): CanvasImageSource | null {
    if (this.imageProvider) return this.imageProvider(assetId) // headless backend (skia): pre-decoded images
    const a = this.assetById(assetId)
    if (!a) return null
    const url = this.resolveAsset(a) // host-trusted url (default: data: URIs only, no remote fetch)
    if (url == null) return null
    let img = playerImgCache.get(a.id)
    if (!img) {
      img = new Image()
      img.onload = () => { this.imageEpoch++; this.render() } // asset loaded -> invalidate the filter cache
      img.src = url
      playerImgCache.set(a.id, img)
    }
    return img.complete && img.naturalWidth > 0 ? img : null
  }

  seek(frame: number): void {
    this.frame = Math.max(0, Math.min(this.duration, frame))
    this.lastFrameInt = Math.floor(this.frame) // a seek does not trigger the frame-actions (anti-loop)
    this.channelState.clear() // random access: modifiers re-init at rest on their target (snap, no transient)
    this.velocityState.clear() // velocity() re-inits → 0 (no spurious jolt from a stale delta)
    this.modAcc = 0
    // While PLAYING, `mono` free-runs across loop wraps (kept monotone by the sim/rAF) → an `independent`
    // clip keeps its phase. A seek while NOT playing is a SCRUB / static render: anchor `mono` to the
    // scrubbed frame so MovieClip clips (independent/once) resolve deterministically (phase = frame mod dur)
    // — this is what makes a headless `seek`+`render` and `--render --frame N` reproducible.
    if (this.playing) this.startAudio(this.frame) // resyncs the audio
    else this.mono = this.frame
    this.render()
  }

  /**
   * Advances the simulation by `steps` FIXED steps (60 Hz) without RAF: runs `onEnterFrame`
   * (root + active symbols) and advances the playhead as if real time elapsed.
   * Used by the headless mode (`--play`, `wait` gesture) to let a physics simulation
   * unfold between two gestures -- in Node, requestAnimationFrame does not exist.
   */
  stepSim(steps: number): void {
    const rootSim = this.doc.timeline?.onEnterFrame
    for (let i = 0; i < Math.max(0, Math.floor(steps)); i++) {
      let f = this.frame + SIM_STEP * this.fps
      this.mono += SIM_STEP * this.fps // monotone clock: accumulate BEFORE the loop wrap
      if (f >= this.duration) f = this.loop ? f % this.duration : this.duration
      this.frame = f
      this.advanceParams(SIM_STEP * this.fps) // P3: advance per-instance state transitions in lockstep with the sim
      const symSims = this.activeSymbolTimelines(f).filter((s) => s.tl.onEnterFrame?.length)
      if (rootSim?.length) runActions(rootSim, this.host)
      for (const s of symSims) runActions(s.tl.onEnterFrame!, this.host)
      this.mouse.dx = 0 // movement consumed by this step (same contract as the real tick)
      this.mouse.dy = 0
      this.mouse.wheel = 0
      this.fireFrameActions()
    }
    this.advanceChannelModifiers(Math.max(0, Math.floor(steps))) // modifiers unfold in lockstep (headless determinism)
    this.render()
  }

  // -- Audio --
  get audioEnabled(): boolean {
    return this.audioOn
  }
  /** Enables/disables audio (cuts immediately if off; (re)starts if on and playing). */
  setAudio(on: boolean): void {
    if (on === this.audioOn) return
    this.audioOn = on
    if (!on) this.stopAudio()
    else if (this.playing) this.startAudio(this.frame)
  }
  private stopAudio(): void {
    for (const s of this.activeSources) { try { s.stop() } catch { /* already stopped */ } }
    this.activeSources = []
  }
  private decodeAudio(assetId: string): void {
    if (playerAudioBuffers.has(assetId)) return
    const a = this.assetById(assetId)
    if (!a) return
    const url = this.resolveAsset(a) // host-trusted url (default: data: URIs only, no remote fetch)
    if (url == null) return
    playerAudioBuffers.set(assetId, 'loading')
    fetch(url).then((r) => r.arrayBuffer()).then((b) => getAudioCtx().decodeAudioData(b)).then((buf) => playerAudioBuffers.set(assetId, buf)).catch(() => playerAudioBuffers.delete(assetId))
  }
  /** (Re)schedules the audio clips for a playback starting from `fromFrame`. */
  private startAudio(fromFrame: number): void {
    this.stopAudio()
    const sounds = this.doc.timeline?.sounds
    if (!this.audioOn || !sounds?.length) return
    const c = getAudioCtx()
    if (c.state === 'suspended') void c.resume()
    const now = c.currentTime + 0.03
    for (const sch of scheduleSounds(sounds, this.fps, fromFrame, now)) {
      const buf = playerAudioBuffers.get(sch.clip.assetId)
      if (!buf || buf === 'loading') { this.decodeAudio(sch.clip.assetId); continue } // heard on the next start
      if (!sch.clip.loop && sch.offset >= buf.duration) continue
      const src = c.createBufferSource()
      src.buffer = buf
      src.loop = !!sch.clip.loop
      const g = c.createGain()
      g.gain.value = sch.clip.gain ?? 1
      src.connect(g).connect(c.destination)
      src.start(sch.when, Math.max(0, sch.offset))
      this.activeSources.push(src)
    }
  }

  /** Triggers the frame-actions when the playhead enters a new whole frame. */
  private fireFrameActions(): void {
    const fi = Math.floor(this.frame)
    if (fi === this.lastFrameInt) return
    this.lastFrameInt = fi
    const fa = this.doc.timeline?.frameActions
    if (fa) for (const e of fa) if (e.frame === fi) runActions(e.actions, this.host)
  }

  play(): void {
    if (this.playing) return
    if (this.transRaf) { cancelAnimationFrame(this.transRaf); this.transRaf = 0 } // the main tick becomes the sole transition driver
    this.playing = true
    this.last = performance.now()
    this.simAcc = 0
    this.prevSimVars = null; this.simAlpha = 1; this.simActive = false // restart from a clean interpolation state
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0 // discard pointer deltas banked while paused (no jump on resume)
    this.startAudio(this.frame)
    const tick = (now: number) => {
      if (!this.playing) return
      const dt = Math.min((now - this.last) / 1000, 0.25) // clamp the big gaps (backgrounded tab) -> no explosive catch-up
      this.last = now

      // 1) PLAYHEAD: based on real time (smooth, independent of refresh rate) + looping.
      let f = this.frame + dt * this.fps
      this.mono += dt * this.fps // monotone clock: accumulate BEFORE the loop wrap
      if (f >= this.duration) {
        if (this.loop) { f %= this.duration; this.startAudio(f) } // restarts the audio on loop
        else {
          f = this.duration
          this.playing = false
          this.stopAudio()
        }
      }
      this.frame = f
      this.advanceParams(dt * this.fps) // P3: advance in-progress per-instance state transitions

      // 2) onEnterFrame at a FIXED step (60 Hz) -> framerate-independent physics. The set of active
      // symbols is frozen for this tick (the frame does not move between steps, except a gotoFrame from an action).
      const symTLs = this.activeSymbolTimelines(f)
      const rootSim = this.doc.timeline?.onEnterFrame
      const symSims = symTLs.filter((s) => s.tl.onEnterFrame?.length)
      if (rootSim?.length || symSims.length) {
        this.simActive = true
        const { steps, acc } = simSteps(this.simAcc, dt, SIM_STEP, SIM_MAX_STEPS)
        this.simAcc = acc
        for (let i = 0; i < steps && this.playing; i++) { // an action can pause -> we stop
          this.prevSimVars = cloneVarMap(this.vars) // state BEFORE the step -> interpolation target
          if (rootSim?.length) runActions(rootSim, this.host) // root
          for (const s of symSims) runActions(s.tl.onEnterFrame!, this.host) // active symbols
        }
        // Remaining step fraction -> we draw between `prevSimVars` and the current state (0..1).
        this.simAlpha = Math.min(1, this.simAcc / SIM_STEP)
      } else {
        this.simAcc = 0 // "pure tween" demo: no simulation, we do not hoard backlog
        this.simActive = false
        this.prevSimVars = null
      }
      // 2b) stateful channel modifiers (smooth/spring): advance at the SAME fixed step but UNGATED by
      // onEnterFrame (its own accumulator) -> an asset's "feel" animates even with zero scene behavior.
      if (this.hasModifiers) {
        const m = simSteps(this.modAcc, dt, SIM_STEP, SIM_MAX_STEPS)
        this.modAcc = m.acc
        this.advanceChannelModifiers(m.steps)
      }
      this.mouse.dx = 0 // movement consumed by this frame (onEnterFrame) -> the "mouse at rest" hands control back to the keyboard
      this.mouse.dy = 0
      this.mouse.wheel = 0

      // 3) frame-actions (on the current frame) + single render.
      this.fireFrameActions() // can change frame/playing (gotoFrame, pause...)
      this.render()
      if (this.playing) this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  pause(): void {
    this.playing = false
    this.simActive = false // no more playback -> the render goes back to the real values (not interpolated)
    cancelAnimationFrame(this.raf)
    this.stopAudio()
    this.ensureTransitions() // hand any in-progress state transition off to its own driver (keeps animating)
  }
  toggle(): void {
    if (this.playing) this.pause()
    else this.play()
  }
  stop(): void {
    this.pause()
    this.seek(0)
  }

  // -- Hit-cache warm-up --
  // The hit-test flattens each region's Bezier path to polygons on demand (cached by path identity). On a
  // cold cache the FIRST pointermove/pointerdown flattens the whole scene at once — a one-time jolt. Warm it
  // on idle after the first paint so that jolt lands during load, not on the user's first gesture.
  private scheduleHitWarm(): void {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
    if (!ric) return // no idle scheduler (headless / older browser) → host can call `warmHitCache()` instead
    this.hitWarmId = ric(() => { this.hitWarmId = 0; warmHitPaths(this.doc) }, { timeout: 2000 })
  }
  /** Pre-flatten the hittable paths NOW (and cancel the scheduled idle warm). For a host that wants to hide
   *  the one-time cost behind its own loading state, or runs in a browser without `requestIdleCallback`. */
  warmHitCache(): void {
    this.cancelHitWarm()
    warmHitPaths(this.doc)
  }
  private cancelHitWarm(): void {
    if (!this.hitWarmId) return
    ;(globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(this.hitWarmId)
    this.hitWarmId = 0
  }

  /** Releases the listeners. To be called when the player is no longer used. */
  destroy(): void {
    this.pause()
    this.cancelHitWarm()
    if (this.transRaf) { cancelAnimationFrame(this.transRaf); this.transRaf = 0 } // stop the transition driver on a torn-down player
    window.removeEventListener('resize', this.onResize)
    globalThis.removeEventListener('keydown', this.onKeyDown)
    globalThis.removeEventListener('keyup', this.onKeyUp)
    globalThis.removeEventListener('blur', this.onBlur)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.cancelLongPress()
  }
}
