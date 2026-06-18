// ─────────────────────────────────────────────────────────────────────────────
//  cel.ts — the "cel" model (Flash-style timeline) + PURE per-layer resolution.
//
//  The layer IS the time track: a sequence of layer-wide keyframes (`Cel`). Each keyframe carries the
//  layer's full content at that instant — the material (regions, HOLD) AND the present symbols (with
//  their pose, tweened). The span between two keys is either held (HOLD) or interpolated (TWEEN,
//  containers matched by id).
//
//  GOLDEN RULE: pure module (a function of `frame`, no mutation), depending only on pure modules
//  (transform/paint/timeline/expr/layers). Reusable as-is by the runtime player. Replaces
//  `evaluateTimeline` + `resolveContent`.
//
//  "cel layer" invariant: `layer.items` = the ROSTER of containers (bodies stored ONCE); material lives
//  in `cel.matter`. A layer without `cels` = static (items rendered at every frame, historical behavior).
// ─────────────────────────────────────────────────────────────────────────────
import { IDENTITY, apply, compose, decompose, spaceConversions, type Transform } from './transform'
import { lerpTint, lerpPaint, lerpStroke, type Tint } from './paint'
import { lerpFilters, type Filter } from './filters'
import { lerpColor } from './color'
import { samplePathAt, projectToPath, lerpPath, type Path } from './path'
import { applyEasing, rotDelta, EXPR_CHANNELS, type ExprChannel } from './timeline'
import { compileCached, evalExpr, exprScope } from './expr'
import { isPoseable, isText } from './layers'
import type { Point, Region, Item, Layer, Pose, Cel, ResolveOpts } from '@flatkit/types'
export type { Pose, Cel, ResolveOpts } from '@flatkit/types'

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

// ── API ──────────────────────────────────────────────────────────────────

/**
 * Resolve a layer's content at a frame → a list of items ready to draw (held material + present
 * containers with resolved pose). Pure, no mutation.
 *
 *  - Without `cels` → `layer.items` as-is (static layer).
 *  - Before the first keyframe → empty (Flash style).
 *  - Material: HOLD (last key ≤ frame that defines `matter`), never interpolated.
 *  - Containers: present = those with a pose in the current key `A`; tween toward `B` if `A.tween` and
 *    the same id is present in `B`; otherwise pose held.
 *  - z-order v1: material behind, containers in front (split into layers for another order).
 */
export function resolveLayerAt(layer: Layer, frame: number, opts: ResolveOpts = {}): Item[] {
  const cels = layer.cels
  if (!cels || cels.length === 0) {
    // STATIC layer: items as-is — but we still apply a container's channel expressions (a static object
    // can be animated/driven by an expression, e.g. opacity:'lit').
    const hasChannels = (it: Item) => 'expressions' in it && it.expressions && Object.keys(it.expressions).length > 0
    if (!layer.items.some((it) => hasChannels(it) || (isText(it) && it.bind))) return layer.items
    return layer.items.map((it) => {
      let out: Item = it
      if (hasChannels(it) && isPoseable(it) && it.expressions) {
        const base: ResolvedPose = { transform: it.transform, opacity: it.opacity ?? 1, tint: it.tint, filters: it.filters }
        const pose = applyExprChannels(it.expressions, base, frame, opts, it.id, it.pivot)
        out = { ...it, transform: pose.transform, opacity: pose.opacity, ...(pose.tint ? { tint: pose.tint } : {}), ...(pose.filters ? { filters: pose.filters } : {}) } as Item
      }
      if (isText(out) && out.bind) out = { ...out, content: resolveBoundText(out, frame, opts) }
      return out
    })
  }
  const cs = cels.length > 1 ? [...cels].sort((a, b) => a.frame - b.frame) : cels

  // A = last key ≤ frame; B = first key > frame.
  let A: Cel | undefined
  let B: Cel | undefined
  for (const c of cs) {
    if (c.frame <= frame) A = c
    else { B = c; break }
  }
  if (!A) return [] // before the first keyframe = empty layer

  // Material: MORPH (shape tween) if A interpolates toward B (material defined on both sides); otherwise
  // HOLD (last key ≤ frame whose `matter` is defined).
  let matter: Region[] | undefined
  if (A.shapeTween && B && A.matter && A.matter.length && B.matter && B.matter.length) {
    const span = B.frame - A.frame
    const t = applyEasing(span <= 0 ? 0 : (frame - A.frame) / span, A.ease)
    matter = morphMatter(A.matter, B.matter, t)
  } else {
    for (const c of cs) {
      if (c.frame > frame) break
      if (c.matter !== undefined) matter = c.matter
    }
  }
  const out: Item[] = matter && matter.length ? [...matter] : []

  // Containers present at A (poses), tweened toward B if applicable (or guided by a guide layer).
  for (const p of A.poses) {
    const body = layer.items.find((b) => b.id === p.id)
    if (!body || !isPoseable(body)) continue
    let pose = opts.guide ? guidedPose(p, A, B, frame, body, opts.guide, opts.orient) : poseAt(p, A, B, frame, body)
    if ('expressions' in body && body.expressions) pose = applyExprChannels(body.expressions, pose, frame, opts, body.id, body.pivot)
    out.push({ ...body, transform: pose.transform, opacity: pose.opacity, ...(pose.tint ? { tint: pose.tint } : { tint: undefined }), ...(pose.filters ? { filters: pose.filters } : { filters: undefined }) } as Item)
  }
  return out
}

// ── Internal ────────────────────────────────────────────────────────────────

type ResolvedPose = { transform: Transform; opacity: number; tint?: Tint; filters?: Filter[] }
/** The resting attributes of a body (roster item) a pose patches on top of. */
type PoseBody = { transform?: Transform; pivot?: Point; opacity?: number; tint?: Tint; filters?: Filter[] }

const DEG = Math.PI / 180

/** Decomposed geometry of a pose, around the body's pivot. */
type PoseGeom = { px: number; py: number; rot: number; sx: number; sy: number; explicitRot: boolean }

/**
 * Decompose a pose's geometry around the body's pivot. The decomposed channels (`rotate` in DEGREES,
 * `scaleX`, `scaleY`) are PATCHES: an absent channel is inherited from the base (the pose's own
 * `transform`, else the body's resting transform) — never reset (#2). `px`/`py` is the pivot's
 * parent-space position (kept fixed by rotate/scale). `rot` keeps the AUTHORED angle (degrees → radians,
 * not wrapped) so a `rotate 360` tween is a full turn, not a no-op of the decomposed matrix.
 */
function poseGeom(p: Pose, baseT: Transform, pivot: Point): PoseGeom {
  const src = p.transform ?? baseT // `at`/`matrix(...)` on the pose, else inherit the body's position (#2)
  const d = decompose(src)
  const pv = apply(src, pivot)
  return {
    px: pv.x, py: pv.y,
    rot: p.rotate != null ? p.rotate * DEG : d.rotation,
    sx: p.scaleX ?? d.scaleX,
    sy: p.scaleY ?? d.scaleY,
    explicitRot: p.rotate != null,
  }
}

/** Recompose a matrix from pose geometry, around the pivot (rotation·scale turn around it; pivot → px/py). */
function geomToMatrix(g: PoseGeom, pivot: Point): Transform {
  const cos = Math.cos(g.rot), sin = Math.sin(g.rot)
  const la = g.sx * cos, lb = g.sx * sin, lc = -g.sy * sin, ld = g.sy * cos
  return { a: la, b: lb, c: lc, d: ld, e: g.px - (la * pivot.x + lc * pivot.y), f: g.py - (lb * pivot.x + ld * pivot.y) }
}

/** Resolved matrix of a single (HOLD) pose. A matrix-only pose (no `rotate`/`scale`) is returned exactly
 *  (no decompose/recompose round-trip → preserves any shear). */
function poseMatrix(p: Pose, baseT: Transform, pivot: Point): Transform {
  if (p.rotate == null && p.scaleX == null && p.scaleY == null) return p.transform ?? baseT
  return geomToMatrix(poseGeom(p, baseT, pivot), pivot)
}

/**
 * Effective pose of a container at `frame` (tween A→B if requested, otherwise HOLD of A).
 * PATCH semantics: any channel a pose does not state (position, rotation, scale, opacity, tint, filters)
 * is inherited from the body's resting attributes — `pose "G" opacity 0.5` keeps the body's place (#2).
 */
function poseAt(p: Pose, A: Cel, B: Cel | undefined, frame: number, body: PoseBody): ResolvedPose {
  const pivot = body.pivot ?? { x: 0, y: 0 }
  const baseT = body.transform ?? IDENTITY
  const aO = p.opacity ?? body.opacity ?? 1
  const aTint = p.tint ?? body.tint
  const aFilters = p.filters ?? body.filters
  if (A.tween && B) {
    const q = B.poses.find((x) => x.id === p.id)
    if (q) {
      const span = B.frame - A.frame
      const t = applyEasing(span <= 0 ? 0 : (frame - A.frame) / span, A.ease)
      const ga = poseGeom(p, baseT, pivot), gb = poseGeom(q, baseT, pivot)
      // Rotation: `spin`/`turns` force the direction (+ full turns); when BOTH ends state `rotate`,
      // interpolate LINEARLY in degrees (0→360 = a full turn, ±172° stays ±172°); otherwise take the
      // shortest arc (matrix-only, or a mixed pair — avoids a spurious long sweep from a wrapped angle).
      const rot = p.spin ? ga.rot + rotDelta(ga.rot, gb.rot, p.spin, p.turns) * t
        : ga.explicitRot && gb.explicitRot ? lerp(ga.rot, gb.rot, t)
          : ga.rot + rotDelta(ga.rot, gb.rot, undefined, 0) * t
      const g: PoseGeom = { px: lerp(ga.px, gb.px, t), py: lerp(ga.py, gb.py, t), sx: lerp(ga.sx, gb.sx, t), sy: lerp(ga.sy, gb.sy, t), rot, explicitRot: false }
      return {
        transform: geomToMatrix(g, pivot),
        opacity: clamp01(lerp(aO, q.opacity ?? body.opacity ?? 1, t)),
        tint: lerpTintPair(aTint, q.tint ?? body.tint, t),
        filters: lerpFilters(aFilters, q.filters ?? body.filters, t),
      }
    }
  }
  return { transform: poseMatrix(p, baseT, pivot), opacity: aO, tint: aTint, filters: aFilters }
}

/**
 * Pose of a container on a GUIDE LAYER: scale/rotation/opacity/tint interpolated normally, but POSITION
 * along the path. The `t` parameter comes from PROJECTING the keyframe poses onto the guide (interpolated
 * over the span) → the forward pass projects toward the end, the return reprojects toward the start
 * (ping-pong on the SAME guide, with no special case).
 */
function guidedPose(p: Pose, A: Cel, B: Cel | undefined, frame: number, body: PoseBody, guide: Path, orient?: boolean): ResolvedPose {
  const base = poseAt(p, A, B, frame, body) // scale/rotation/opacity/tint (position is overwritten by the guide)
  const piv = body.pivot ?? { x: 0, y: 0 }
  const baseT = body.transform ?? IDENTITY
  const projOf = (pose: Pose) => projectToPath(guide, apply(poseMatrix(pose, baseT, piv), piv))
  let t = projOf(p)
  if (A.tween && B) {
    const q = B.poses.find((x) => x.id === p.id)
    if (q) {
      const span = B.frame - A.frame
      const tt = applyEasing(span <= 0 ? 0 : (frame - A.frame) / span, A.ease)
      t = projOf(p) + (projOf(q) - projOf(p)) * tt
    }
  }
  return { transform: applyGuide(base.transform, guide, t, piv, orient), opacity: base.opacity, tint: base.tint, filters: base.filters }
}

/**
 * Motion guide: place the object's PIVOT on the path at `t` (by arc length), keeping the interpolated
 * scale/rotation. If `orient`, add a rotation equal to the tangent angle, AROUND the guide point (the
 * object "follows" the path direction).
 */
function applyGuide(m: Transform, guide: Path, t: number, pivot: Point, orient?: boolean): Transform {
  const { point, tangent } = samplePathAt(guide, t)
  // Translation to bring the pivot (already placed by `m`) onto the guide point.
  const pw = apply(m, pivot)
  let out: Transform = { ...m, e: m.e + (point.x - pw.x), f: m.f + (point.y - pw.y) }
  if (orient) {
    const ang = Math.atan2(tangent.y, tangent.x)
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    // World rotation around `point`: R = T(point)·R(ang)·T(-point), then R ∘ out.
    const rot: Transform = { a: c, b: s, c: -s, d: c, e: point.x - c * point.x + s * point.y, f: point.y - s * point.x - c * point.y }
    out = compose(rot, out)
  }
  return out
}

/** Interpolate a region (shape + paint) — morph between two drawings. Keeps the id/style of `a`. */
function lerpRegion(a: Region, b: Region, t: number): Region {
  return {
    ...a,
    path: lerpPath(a.path, b.path, t),
    color: lerpColor(a.color, b.color, t),
    ...(a.paint && b.paint ? { paint: lerpPaint(a.paint, b.paint, t) } : {}),
    ...(a.stroke && b.stroke ? { stroke: lerpStroke(a.stroke, b.stroke, t) } : {}),
    opacity: clamp01(lerp(a.opacity ?? 1, b.opacity ?? 1, t)),
  }
}

/**
 * Morph the material A→B at `t`. Same number of regions → 1:1 interpolation (matched by index).
 * Different counts (incompatible structure) → CROSS-FADE (A fades out, B appears).
 */
function morphMatter(a: Region[], b: Region[], t: number): Region[] {
  if (a.length === b.length) return a.map((ra, i) => lerpRegion(ra, b[i], t))
  return [
    ...a.map((r) => ({ ...r, opacity: clamp01((r.opacity ?? 1) * (1 - t)) })),
    ...b.map((r) => ({ ...r, opacity: clamp01((r.opacity ?? 1) * t) })),
  ]
}

/** Interpolate a tint; a missing side = the same color at 0% (fade instead of "hold"). */
function lerpTintPair(a: Tint | undefined, b: Tint | undefined, t: number): Tint | undefined {
  if (a && b) return lerpTint(a, b, t)
  if (a) return lerpTint(a, { color: a.color, amount: 0 }, t)
  if (b) return lerpTint({ color: b.color, amount: 0 }, b, t)
  return undefined
}

// ── Dynamic text (read-only): `bind` evaluates an expression → injected into `content`. ──
const fmtNum = (v: number, decimals?: number): string => {
  if (!Number.isFinite(v)) return '0'
  if (decimals != null) return v.toFixed(Math.max(0, Math.floor(decimals)))
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000)
}
/** Resolved content of a `bind` text: the formatted numeric value, substituted into the `{}` slot (or alone). */
function resolveBoundText(t: { content: string; bind?: string; decimals?: number }, frame: number, opts: ResolveOpts): string {
  if (!t.bind) return t.content
  const compiled = compileCached(t.bind)
  if (!compiled.ok) return t.content // invalid expression → literal content (the UI reports the error)
  const fps = opts.fps ?? 24
  const time = fps > 0 ? frame / fps : frame
  const v = evalExpr(compiled.node, exprScope(opts.ctx, time, frame), 0)
  const s = fmtNum(v, t.decimals)
  return t.content.includes('{}') ? t.content.replaceAll('{}', s) : s
}

// ── Container expressions (take priority over tween/HOLD) ────────────────────

/**
 * Apply a container's channel expressions on top of its resolved pose.
 * `value` = the decomposed component / current opacity; `time` = frame/fps.
 */
function applyExprChannels(
  ex: Partial<Record<ExprChannel, string>>,
  pose: ResolvedPose,
  frame: number,
  opts: ResolveOpts,
  id?: string,
  pivot: Point = { x: 0, y: 0 },
): ResolvedPose {
  if (!EXPR_CHANNELS.some((ch) => ex[ch])) return pose
  const dec = decompose(pose.transform)
  // Position channels track the PIVOT's parent-space position (kept fixed by scale/rotation), so
  // `scaleX`/`scaleY`/`rotation` turn around the declared `pivot` — consistent with cel poses
  // (`poseGeom`/`geomToMatrix`). With pivot = {0,0} (the default), `pv` = the raw translation → identical
  // to the previous origin-based behavior (no change for content without a pivot).
  const pv = apply(pose.transform, pivot)
  const ch: Record<ExprChannel, number> = {
    x: pv.x, y: pv.y, scaleX: dec.scaleX, scaleY: dec.scaleY, rotation: dec.rotation, opacity: pose.opacity,
  }
  const fps = opts.fps ?? 24
  const time = fps > 0 ? frame / fps : frame
  // `self` = the object's own channels (current position/scale/rotation/opacity) → avoids the mirror
  // variable: `rotation = atan2(Target.y - self.y, Target.x - self.x)`. Live reference to `ch` (x/y,
  // computed before rotation, are already up to date when rotation reads them). + world⇄local conversions
  // relative to the object's parent (`toLocalX/Y`/`toGlobalX/Y`).
  // `self` also carries the object's interaction state (hovered/grabbed/pressed → 0/1) so channel
  // expressions can do hover-lift / grab-tilt feedback. Stashed on `ch` (same ref) → stays live with x/y.
  const self = ch as Record<string, number>
  const st = id !== undefined ? opts.itemState?.(id) : undefined
  self.hovered = st?.hovered ?? 0
  self.grabbed = st?.grabbed ?? 0
  self.pressed = st?.pressed ?? 0
  const withSelf = { ...opts.ctx, self, ...spaceConversions(opts.parent ?? IDENTITY) }
  let touchedT = false
  for (const c of EXPR_CHANNELS) {
    const src = ex[c]
    if (!src) continue
    const compiled = compileCached(src)
    if (!compiled.ok) continue // invalid expression → ignored (the UI reports the error)
    ch[c] = evalExpr(compiled.node, exprScope(withSelf, time, frame, ch[c]), ch[c])
    if (c !== 'opacity') touchedT = true
  }
  return {
    transform: touchedT ? geomToMatrix({ px: ch.x, py: ch.y, rot: ch.rotation, sx: ch.scaleX, sy: ch.scaleY, explicitRot: false }, pivot) : pose.transform,
    opacity: clamp01(ch.opacity),
    tint: pose.tint,
    filters: pose.filters,
  }
}
