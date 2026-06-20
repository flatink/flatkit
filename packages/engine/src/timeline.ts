// ─────────────────────────────────────────────────────────────────────────────
//  timeline.ts — the temporal model + PURE evaluation.
//
//  A "property tracks" model (After Effects style): a Timeline animates the items of its scope
//  (doc.layers or symbol.layers) by interpolating transform / opacity / visible. Material is NEVER
//  shape-animated — a Region moves/rotates rigidly (the matrix is applied at render).
//
//  GOLDEN RULE: this module depends ONLY on transform.ts (and a few pure helpers). It is pure (a
//  function of `frame`, no mutation) → deterministic scrubbing + reproducible export, and reusable
//  as-is by the runtime player. The material engine stays completely time-unaware.
// ─────────────────────────────────────────────────────────────────────────────
import { apply, decompose, recompose, IDENTITY, spaceConversions, type Transform } from './transform'
import { lerpColor } from './color'
import { lerpPaint, lerpTint, type Paint, type Tint } from './paint'
import { compileExpr, evalExpr, exprScope, type Compiled, type ExprContext } from './expr'
import type {
  Point, Region,
  Easing, SpinDir, Keyframe, ExprChannel, TimelineTrack, SoundClip,
  ContentKey, Timeline, InstancePlayback,
} from '@flatkit/types'
export type {
  Easing, SpinDir, Keyframe, ExprChannel, TimelineTrack, SoundClip,
  ContentKey, ContentTrack, Timeline, InstanceBind, PlaybackMode, InstancePlayback,
} from '@flatkit/types'

// The temporal types (Easing, SpinDir, Keyframe, TimelineTrack, Timeline, InstanceBind, PlaybackMode,
// InstancePlayback, SoundClip, ContentKey/Track) are defined in @flatkit/types; this module ANIMATES
// them (pure per-frame resolution).
export const EXPR_CHANNELS: ExprChannel[] = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity']

// ── Evaluation result ────────────────────────────────────────────────────────
/** Overrides applied to ONE item at render. Any absent key = base value. */
export type ItemOverride = { transform?: Transform; opacity?: number; color?: string; paint?: Paint; tint?: Tint; visible?: boolean }
/** targetId → override, for a scope (one timeline) at a given frame. */
export type ResolvedScope = Map<string, ItemOverride>

/** Provides the BASE pose of an item (for the `value` of expressions). */
export type BaseOf = (targetId: string) => { transform?: Transform; opacity?: number } | undefined

const EMPTY_SCOPE: ResolvedScope = new Map()
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Evaluate all the tracks of a timeline at a frame. Pure, no mutation.
 * `baseOf` (optional) provides the base pose of items → needed so that expressions have `value` and
 * the non-animated channels.
 */
export function evaluateTimeline(tl: Timeline | undefined, frame: number, baseOf?: BaseOf, extraCtx?: ExprContext): ResolvedScope {
  if (!tl || tl.tracks.length === 0) return EMPTY_SCOPE
  const out: ResolvedScope = new Map()
  for (const track of tl.tracks) {
    let ov = sampleTrack(track, frame)
    if (track.expressions) ov = applyExpressions(track, frame, tl.fps, baseOf, ov, extraCtx)
    if (ov) out.set(track.targetId, ov)
  }
  return out
}

/**
 * Resolve frame-by-frame material at a frame: for each layer with a content track, return the items of
 * the LAST keyframe ≤ frame (HOLD, no interpolation). Before the first keyframe → empty (blank), Flash
 * style. Pure.
 */
export function resolveContent(tl: Timeline | undefined, frame: number): Map<string, Region[]> {
  const out = new Map<string, Region[]>()
  for (const ct of tl?.contentTracks ?? []) {
    let cur: ContentKey | undefined
    for (const k of ct.keyframes) if (k.frame <= frame && (!cur || k.frame > cur.frame)) cur = k
    out.set(ct.layerId, cur ? cur.items : [])
  }
  return out
}

/**
 * Local frame of an instance according to its playback mode (nested timeline).
 *
 * `parentFrame` = the ancestor's advancing clock (the SLAVE source for `synced`). `monoFrame` = the
 * runtime's MONOTONE heartbeat already expressed in THIS instance's fps domain (`mono` seconds × clip fps)
 * — the INDEPENDENT source for `independent`/`once`. Absent (no runtime clock, e.g. a static editor walk) →
 * `independent`/`once` gracefully fall back to the synced (parent-driven) frame so a bare render still works.
 *
 *  - `singleFrame`           → the pinned frame.
 *  - `independent` (`loop`)  → `mono mod dur`: loops on its OWN duration, immune to the parent's wrap.
 *  - `once`                  → `clamp(mono, 0, dur-1)`: plays through once, then holds the last frame.
 *  - `synced` (default)      → `parentFrame mod dur`: graphic-symbol style, truncated by the parent.
 */
export function resolveInstanceFrame(
  pb: InstancePlayback | undefined,
  parentFrame: number,
  symbolDuration: number,
  monoFrame?: number,
): number {
  if (pb?.mode === 'singleFrame') return pb.frame ?? 0
  const dur = Math.max(1, symbolDuration)
  if (monoFrame != null && (pb?.mode === 'independent' || pb?.mode === 'once')) {
    if (pb.mode === 'once') return Math.max(0, Math.min(dur - 1, monoFrame))
    return ((monoFrame % dur) + dur) % dur
  }
  // 'synced' (default), and independent/once with no runtime clock: loop on the parent's (wrapped) frame.
  return ((parentFrame % dur) + dur) % dur
}

/** Apply an easing curve to a progress `t` ∈ [0,1]. */
export function applyEasing(t: number, e: Easing | undefined): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  if (!e || e === 'linear') return t
  if (e === 'easeIn') return t * t * t
  if (e === 'easeOut') {
    const u = 1 - t
    return 1 - u * u * u
  }
  if (e === 'easeInOut') return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
  return cubicBezierEase(t, e.cubic)
}

/** Interpolate two transforms via their decomposition. `rotate`/`turns` set the spin direction. */
export function lerpTransform(a: Transform, b: Transform, t: number, rotate?: SpinDir, turns = 0): Transform {
  const da = decompose(a)
  const db = decompose(b)
  return recompose({
    x: lerp(da.x, db.x, t),
    y: lerp(da.y, db.y, t),
    scaleX: lerp(da.scaleX, db.scaleX, t),
    scaleY: lerp(da.scaleY, db.scaleY, t),
    rotation: da.rotation + rotDelta(da.rotation, db.rotation, rotate, turns) * t,
  })
}

/**
 * Interpolation AROUND A PIVOT (the transform point, in the container's LOCAL coords).
 * The pivot's POSITION in parent space is interpolated linearly, while rotation and scale turn/scale
 * around it → the rotation follows an arc around the pivot (Flash style), instead of rotating around the
 * local origin with a position sliding in a straight line.
 * With `pivot = {0,0}`, identical to `lerpTransform` (the pivot lands on the raw translation e/f).
 */
export function lerpTransformPivot(a: Transform, b: Transform, t: number, pivot: Point, rotate?: SpinDir, turns = 0): Transform {
  const da = decompose(a)
  const db = decompose(b)
  const sx = lerp(da.scaleX, db.scaleX, t)
  const sy = lerp(da.scaleY, db.scaleY, t)
  const rot = da.rotation + rotDelta(da.rotation, db.rotation, rotate, turns) * t
  const pa = apply(a, pivot)
  const pb = apply(b, pivot)
  const px = lerp(pa.x, pb.x, t)
  const py = lerp(pa.y, pb.y, t)
  // Linear part (rotation·scale), same convention as recompose.
  const cos = Math.cos(rot), sin = Math.sin(rot)
  const la = sx * cos, lb = sx * sin, lc = -sy * sin, ld = sy * cos
  // Translation such that the local pivot lands on (px,py): T·pivot = (px,py).
  return { a: la, b: lb, c: lc, d: ld, e: px - (la * pivot.x + lc * pivot.y), f: py - (lb * pivot.x + ld * pivot.y) }
}

// ── Audio: scheduling (PURE) ─────────────────────────────────────────────────
/** When (audio clock) and at which offset (s) to start a clip, for a playback starting at `fromFrame`. */
export type ScheduledSound = { clip: SoundClip; when: number; offset: number }
export function scheduleSounds(sounds: SoundClip[], fps: number, fromFrame: number, now: number): ScheduledSound[] {
  const head = fromFrame / fps // playhead instant (s)
  return sounds.map((clip) => {
    const start = clip.startFrame / fps
    return start >= head
      ? { clip, when: now + (start - head), offset: 0 } // starts in the future
      : { clip, when: now, offset: head - start } // already started → we jump in mid-clip
  })
}

// ── Expressions ──────────────────────────────────────────────────────────────

const exprCache = new Map<string, Compiled>()
function compileCached(src: string): Compiled {
  let c = exprCache.get(src)
  if (!c) {
    c = compileExpr(src)
    exprCache.set(src, c)
  }
  return c
}

/**
 * Apply a track's expressions on top of the keyframe override.
 * For each expressed channel: `value` = keyframe/base value, `time` = frame/fps.
 * Non-expressed channels keep their keyframe/base value.
 */
function applyExpressions(
  track: TimelineTrack,
  frame: number,
  fps: number,
  baseOf: BaseOf | undefined,
  kf: ItemOverride | null,
  extraCtx: ExprContext | undefined,
): ItemOverride | null {
  const ex = track.expressions!
  if (!EXPR_CHANNELS.some((ch) => ex[ch])) return kf

  const base = baseOf?.(track.targetId)
  const baseT = kf?.transform ?? base?.transform ?? IDENTITY
  const dec = decompose(baseT)
  const ch: Record<ExprChannel, number> = {
    x: dec.x,
    y: dec.y,
    scaleX: dec.scaleX,
    scaleY: dec.scaleY,
    rotation: dec.rotation,
    opacity: kf?.opacity ?? base?.opacity ?? 1,
  }
  const time = fps > 0 ? frame / fps : frame
  const withSelf = { ...extraCtx, self: ch, ...spaceConversions(IDENTITY) } // self + conversions (legacy tracks model = root)
  let touchedT = false

  for (const c of EXPR_CHANNELS) {
    const src = ex[c]
    if (!src) continue
    const compiled = compileCached(src)
    if (!compiled.ok) continue // invalid expression → ignored (the UI reports the error)
    ch[c] = evalExpr(compiled.node, exprScope(withSelf, time, frame, ch[c]), ch[c])
    if (c !== 'opacity') touchedT = true
  }

  const ov: ItemOverride = kf ? { ...kf } : {}
  if (touchedT || kf?.transform) {
    ov.transform = recompose({ x: ch.x, y: ch.y, scaleX: ch.scaleX, scaleY: ch.scaleY, rotation: ch.rotation })
  }
  ov.opacity = clamp01(ch.opacity)
  return ov
}

// ── Internal ──────────────────────────────────────────────────────────────────

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * Signed rotation delta from `a` to `b`:
 *  - no direction → shortest arc (∈ (-π, π]);
 *  - 'cw'  → clockwise (increasing angle) + `turns` full turns;
 *  - 'ccw' → counter-clockwise (decreasing angle) + `turns` full turns.
 * Lifts the limit of rotations ≥ π and full turns (which a bare matrix loses).
 */
export function rotDelta(a: number, b: number, rotate?: SpinDir, turns = 0): number {
  const TAU = Math.PI * 2
  const norm = (x: number) => ((x % TAU) + TAU) % TAU
  if (rotate === 'cw') return norm(b - a) + turns * TAU
  if (rotate === 'ccw') return -norm(a - b) - turns * TAU
  let d = norm(b - a)
  if (d > Math.PI) d -= TAU
  return d
}

/** Sample a track at a frame → override (or null if empty). */
function sampleTrack(track: TimelineTrack, frame: number): ItemOverride | null {
  const kfs = track.keyframes
  if (kfs.length === 0) return null
  // Defensive sort (the store keeps order, but eval must stay robust).
  const ks = kfs.length > 1 ? [...kfs].sort((a, b) => a.frame - b.frame) : kfs

  if (frame <= ks[0].frame) return channelsOf(ks[0])
  const last = ks[ks.length - 1]
  if (frame >= last.frame) return channelsOf(last)

  // Bracketing: k0.frame ≤ frame < k1.frame.
  let i = 0
  while (i < ks.length - 1 && !(ks[i].frame <= frame && frame < ks[i + 1].frame)) i++
  const k0 = ks[i]
  const k1 = ks[i + 1]
  if (frame === k0.frame) return channelsOf(k0)

  const span = k1.frame - k0.frame
  const tRaw = span <= 0 ? 0 : (frame - k0.frame) / span
  const t = applyEasing(tRaw, k0.easing)
  return interpChannels(k0, k1, t)
}

/** Raw override of a keyframe (defined channels only). */
function channelsOf(k: Keyframe): ItemOverride {
  const ov: ItemOverride = {}
  if (k.transform) ov.transform = k.transform
  if (k.opacity != null) ov.opacity = k.opacity
  if (k.color != null) ov.color = k.color
  if (k.paint != null) ov.paint = k.paint
  if (k.tint != null) ov.tint = k.tint
  if (k.visible != null) ov.visible = k.visible
  return ov
}

/** Interpolate the channels between two keyframes (each channel independently). */
function interpChannels(a: Keyframe, b: Keyframe, t: number): ItemOverride {
  const ov: ItemOverride = {}

  if (a.transform && b.transform) ov.transform = lerpTransform(a.transform, b.transform, t, a.rotate, a.turns)
  else if (a.transform) ov.transform = a.transform
  else if (b.transform) ov.transform = b.transform

  if (a.opacity != null && b.opacity != null) ov.opacity = lerp(a.opacity, b.opacity, t)
  else if (a.opacity != null) ov.opacity = a.opacity
  else if (b.opacity != null) ov.opacity = b.opacity

  if (a.color != null && b.color != null) ov.color = lerpColor(a.color, b.color, t)
  else if (a.color != null) ov.color = a.color
  else if (b.color != null) ov.color = b.color

  if (a.paint && b.paint) ov.paint = lerpPaint(a.paint, b.paint, t)
  else if (a.paint) ov.paint = a.paint
  else if (b.paint) ov.paint = b.paint

  // Tint: a missing side = the same color at 0% (the tint fades, instead of "holding").
  if (a.tint && b.tint) ov.tint = lerpTint(a.tint, b.tint, t)
  else if (a.tint) ov.tint = lerpTint(a.tint, { color: a.tint.color, amount: 0 }, t)
  else if (b.tint) ov.tint = lerpTint({ color: b.tint.color, amount: 0 }, b.tint, t)

  // `visible` is a step: we hold the value of the active (left) keyframe.
  if (a.visible != null) ov.visible = a.visible

  return ov
}

/** CSS-style cubic-bezier: solve t(x) via Newton-Raphson then return y(t). */
function cubicBezierEase(x: number, [x1, y1, x2, y2]: [number, number, number, number]): number {
  const bx = (u: number) => {
    const v = 1 - u
    return 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u
  }
  const by = (u: number) => {
    const v = 1 - u
    return 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u
  }
  const dbx = (u: number) => {
    const v = 1 - u
    return 3 * v * v * x1 + 6 * v * u * (x2 - x1) + 3 * u * u * (1 - x2)
  }
  let u = x
  for (let i = 0; i < 8; i++) {
    const err = bx(u) - x
    if (Math.abs(err) < 1e-6) break
    const d = dbx(u)
    if (Math.abs(d) < 1e-6) break
    u -= err / d
  }
  return by(Math.max(0, Math.min(1, u)))
}
