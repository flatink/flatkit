// ─────────────────────────────────────────────────────────────────────────────
//  path.ts — Bezier PATH model (the vector foundation).
//
//  A `Path` = a set of subpaths; each subpath = a sequence of segments
//  `{ anchor, inHandle?, outHandle? }` (handles in ABSOLUTE coordinates, optional).
//
//  HYBRID MODEL:
//   - segment WITHOUT handles → smoothed at render (Catmull-Rom, the current "material" look);
//   - segment WITH handles    → literal cubic (pen tool).
//  For a CLOSED subpath without handles, `pathToBezier` produces EXACTLY the same result
//  as `smoothClosedRing` (a "zero regression" guard — see path.test.ts).
//
//  Bridge with the boolean engine (polygon-clipping stays confined to the boolean-ops module):
//  `pathToPolygons` flattens into point rings, `polygonsToPath` rebuilds. For handle-less
//  segments, the flattening = the anchors as-is → boolean/hit behavior IDENTICAL to the old
//  polygon model.
//
//  PURE module (no polygon-clipping, no React) → embeddable in the player.
// ─────────────────────────────────────────────────────────────────────────────
import type { Point, Polygon, Seg, Subpath, Path, BBox } from '@flatkit/types'
export type { Seg, Subpath, Path } from '@flatkit/types'
import { apply, type Transform } from './transform'
import type { BezierSeg } from './smooth'

// ── Construction / bridge with polygons (Shape) ──────────────────────────────

/** Polygons (linear rings) → path: each ring = a CLOSED subpath without handles. */
export function polygonsToPath(polygons: Polygon[]): Path {
  return {
    subpaths: polygons
      .filter((ring) => ring.length > 0)
      .map((ring) => ({ closed: true, segments: ring.map((p) => ({ anchor: { x: p.x, y: p.y } })) })),
  }
}

/** Flatness test of a cubic (distance of the controls to the chord). */
function flatEnough(p0: Point, c1: Point, c2: Point, p3: Point, tol: number): boolean {
  const ux = 3 * c1.x - 2 * p0.x - p3.x
  const uy = 3 * c1.y - 2 * p0.y - p3.y
  const vx = 3 * c2.x - p0.x - 2 * p3.x
  const vy = 3 * c2.y - p0.y - 2 * p3.y
  return Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy) <= 16 * tol * tol
}

/** Subdivide a cubic into points (EXCLUDES p0, INCLUDES p3) via adaptive de Casteljau. */
function flattenCubic(p0: Point, c1: Point, c2: Point, p3: Point, tol: number, out: Point[], depth = 0): void {
  if (depth >= 18 || flatEnough(p0, c1, c2, p3, tol)) {
    out.push({ x: p3.x, y: p3.y })
    return
  }
  const p01 = mid(p0, c1)
  const p12 = mid(c1, c2)
  const p23 = mid(c2, p3)
  const p012 = mid(p01, p12)
  const p123 = mid(p12, p23)
  const m = mid(p012, p123)
  flattenCubic(p0, p01, p012, m, tol, out, depth + 1)
  flattenCubic(m, p123, p23, p3, tol, out, depth + 1)
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/**
 * Flatten a path into point rings (for boolean ops / hit / bbox).
 * Handle-less edge → straight line (we only push the target anchor); edge with handle(s) →
 * adaptive subdivision of the cubic. `tol` = flatness tolerance (px).
 */
export function pathToPolygons(path: Path, tol = 0.25): Polygon[] {
  const out: Polygon[] = []
  for (const sub of path.subpaths) {
    const segs = sub.segments
    if (segs.length === 0) continue
    if (segs.length === 1) { out.push([{ ...segs[0].anchor }]); continue }
    const ring: Point[] = [{ ...segs[0].anchor }]
    const edges = sub.closed ? segs.length : segs.length - 1
    for (let i = 0; i < edges; i++) {
      const a = segs[i]
      const b = segs[(i + 1) % segs.length]
      const last = i === edges - 1 && sub.closed // last edge of a closed ring → do not duplicate the first point
      if (!a.outHandle && !b.inHandle) {
        if (!last) ring.push({ ...b.anchor }) // straight: just the target anchor
      } else {
        const c1 = a.outHandle ?? a.anchor
        const c2 = b.inHandle ?? b.anchor
        const pts: Point[] = []
        flattenCubic(a.anchor, c1, c2, b.anchor, tol, pts)
        if (last) pts.pop() // drop the closing point (= anchor[0])
        for (const p of pts) ring.push(p)
      }
    }
    if (ring.length) out.push(ring)
  }
  return out
}

// ── Arc-length sampling (motion guides) ──────────────────────────────────────

const clamp01s = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Flatten ONE subpath into a polyline via pathToBezier (explicit handles OR Catmull-Rom). */
function flattenSubpath(sub: Subpath, tol: number): Point[] {
  const pts: Point[] = []
  const bz = pathToBezier(sub)
  if (bz) {
    pts.push({ ...bz.start })
    let prev = bz.start
    for (const s of bz.segs) { flattenCubic(prev, s.c1, s.c2, s.p, tol, pts); prev = s.p }
  } else if (sub.segments[0]) {
    pts.push({ ...sub.segments[0].anchor })
  }
  return pts
}

/** Polyline of the first non-empty subpath (motion guides). */
function guidePolyline(path: Path, tol: number): Point[] {
  const sub = path.subpaths.find((s) => s.segments.length > 0)
  return sub ? flattenSubpath(sub, tol) : []
}

/**
 * Resample a subpath into `n` points EVENLY spaced by arc length (for morphing).
 * Closed subpath → loop (n points around); open → from the first to the last endpoint.
 */
export function resampleSubpath(sub: Subpath, n: number, tol = 0.25): Point[] {
  const poly = flattenSubpath(sub, tol)
  if (poly.length === 0) return Array.from({ length: n }, () => ({ x: 0, y: 0 }))
  if (poly.length === 1) return Array.from({ length: n }, () => ({ ...poly[0] }))
  const ring = sub.closed ? [...poly, poly[0]] : poly
  const cum: number[] = [0]
  let total = 0
  for (let i = 1; i < ring.length; i++) { total += Math.hypot(ring[i].x - ring[i - 1].x, ring[i].y - ring[i - 1].y); cum.push(total) }
  const out: Point[] = []
  if (total === 0) return Array.from({ length: n }, () => ({ ...poly[0] }))
  for (let i = 0; i < n; i++) {
    const target = (sub.closed ? i / n : i / (n - 1)) * total
    // segment containing `target`
    let k = 1
    while (k < cum.length && cum[k] < target) k++
    const a = ring[k - 1]
    const b = ring[k] ?? ring[k - 1]
    const seg = cum[k] - cum[k - 1]
    const u = seg > 0 ? (target - cum[k - 1]) / seg : 0
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u })
  }
  return out
}

/**
 * Interpolate two paths at `t` (morph / shape tween). Subpaths matched by index, each resampled to a
 * common resolution then interpolated point by point (anchors only → smoothed at render). Different
 * subpath counts → only the common minimum is handled.
 */
export function lerpPath(a: Path, b: Path, t: number): Path {
  const m = Math.min(a.subpaths.length, b.subpaths.length)
  const subpaths: Subpath[] = []
  for (let i = 0; i < m; i++) {
    const sa = a.subpaths[i]
    const sb = b.subpaths[i]
    const n = Math.max(8, sa.segments.length, sb.segments.length)
    const pa = resampleSubpath(sa, n)
    const pb = resampleSubpath(sb, n)
    const segments: Seg[] = pa.map((p, j) => ({ anchor: { x: p.x + (pb[j].x - p.x) * t, y: p.y + (pb[j].y - p.y) * t } }))
    subpaths.push({ closed: sa.closed && sb.closed, segments })
  }
  return { subpaths }
}

/**
 * Sample a path at `t` ∈ [0,1] by **arc length** (constant speed along the curve).
 * Uses the first subpath (a guide = an open path); flattens via `pathToBezier` → the motion follows
 * EXACTLY the displayed curve. Returns point + unit tangent.
 * `t` is CLAMPED to [0,1]: the object never leaves the path (Flash behavior — the easing curve is
 * bounded 0–100 %, so no backtrack/overshoot beyond the endpoints).
 */
export function samplePathAt(path: Path, t: number, tol = 0.1): { point: Point; tangent: Point } {
  const pts = guidePolyline(path, tol)
  if (pts.length === 0) return { point: { x: 0, y: 0 }, tangent: { x: 1, y: 0 } }
  if (pts.length === 1) return { point: { ...pts[0] }, tangent: { x: 1, y: 0 } }
  // Cumulative lengths of the polyline segments.
  const seg: number[] = []
  let total = 0
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(d); total += d }
  if (total === 0) return { point: { ...pts[0] }, tangent: { x: 1, y: 0 } }
  const target = clamp01s(t) * total
  let acc = 0
  for (let i = 0; i < seg.length; i++) {
    if (acc + seg[i] >= target || i === seg.length - 1) {
      const localT = seg[i] > 0 ? (target - acc) / seg[i] : 0
      const a = pts[i]
      const b = pts[i + 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      return { point: { x: a.x + dx * localT, y: a.y + dy * localT }, tangent: { x: dx / len, y: dy / len } }
    }
    acc += seg[i]
  }
  // Unreachable (the loop is guaranteed to return) — defensive fallback.
  return { point: { ...pts[pts.length - 1] }, tangent: { x: 1, y: 0 } }
}

/**
 * Project `p` onto the path → parameter `t` ∈ [0,1] (arc length) of the nearest point.
 * Inverse of `samplePathAt` (guide layer: position of a keyframe along the guide).
 */
export function projectToPath(path: Path, p: Point, tol = 0.1): number {
  const pts = guidePolyline(path, tol)
  if (pts.length < 2) return 0
  // Cumulative lengths + search for the nearest segment.
  let total = 0
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); cum.push(total) }
  if (total === 0) return 0
  let bestD = Infinity
  let bestLen = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const segLen2 = dx * dx + dy * dy
    const u = segLen2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / segLen2)) : 0
    const cx = a.x + dx * u
    const cy = a.y + dy * u
    const d = (p.x - cx) ** 2 + (p.y - cy) ** 2
    if (d < bestD) { bestD = d; bestLen = cum[i] + u * Math.sqrt(segLen2) }
  }
  return bestLen / total
}

// ── Hybrid render: path → Bezier cubics ──────────────────────────────────────

/**
 * Subpath → Bezier curves for render/export. Honors explicit handles; for missing tangents, derives
 * them via Catmull-Rom with sharp-angle preservation (logic identical to `smooth.ts`). `cornerCos` =
 * cosine of the threshold deviation (0.5 = 60°).
 *
 * For a CLOSED subpath without handles, output === `smoothClosedRing(anchors)`.
 */
export function pathToBezier(sub: Subpath, cornerCos = 0.5): { start: Point; segs: BezierSeg[] } | null {
  const seg = sub.segments
  const n = seg.length
  if (n < 2) return null
  const A = (i: number): Point => seg[i].anchor
  const closed = sub.closed
  // Neighbors: wrapped if closed, otherwise clamped to the edge.
  const prev = (i: number) => (closed ? (i - 1 + n) % n : Math.max(0, i - 1))
  const next = (i: number) => (closed ? (i + 1) % n : Math.min(n - 1, i + 1))

  // Hard corner if the deviation between edges exceeds the threshold (same math as smooth.ts).
  const corner: boolean[] = new Array(n)
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) { corner[i] = true; continue } // endpoints of an open path = corners
    const p = A(prev(i)); const c = A(i); const q = A(next(i))
    const ax = c.x - p.x, ay = c.y - p.y
    const bx = q.x - c.x, by = q.y - c.y
    const la = Math.hypot(ax, ay) || 1
    const lb = Math.hypot(bx, by) || 1
    corner[i] = (ax * bx + ay * by) / (la * lb) < cornerCos
  }

  const segs: BezierSeg[] = []
  const edges = closed ? n : n - 1
  for (let i = 0; i < edges; i++) {
    const i1 = i
    const i2 = next(i)
    const p0 = A(prev(i1)); const p1 = A(i1); const p2 = A(i2); const p3 = A(next(i2))
    // c1: explicit outgoing handle, otherwise Catmull-Rom (straight if corner).
    const c1 = seg[i1].outHandle ?? (corner[i1]
      ? { x: p1.x + (p2.x - p1.x) / 3, y: p1.y + (p2.y - p1.y) / 3 }
      : { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 })
    // c2: explicit incoming handle, otherwise Catmull-Rom (straight if corner).
    const c2 = seg[i2].inHandle ?? (corner[i2]
      ? { x: p2.x + (p1.x - p2.x) / 3, y: p2.y + (p1.y - p2.y) / 3 }
      : { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 })
    segs.push({ c1, c2, p: p2 })
  }
  return { start: A(0), segs }
}

// ── Transforms / bbox / clone ────────────────────────────────────────────────

const mapSeg = (s: Seg, f: (p: Point) => Point): Seg => ({
  anchor: f(s.anchor),
  ...(s.inHandle ? { inHandle: f(s.inHandle) } : {}),
  ...(s.outHandle ? { outHandle: f(s.outHandle) } : {}),
})

/** Apply an affine transform to the whole path (anchors + handles). */
export function transformPath(path: Path, t: Transform): Path {
  return { subpaths: path.subpaths.map((sp) => ({ closed: sp.closed, segments: sp.segments.map((s) => mapSeg(s, (p) => apply(t, p))) })) }
}

/** Offset the whole path by (dx, dy). */
export function translatePath(path: Path, dx: number, dy: number): Path {
  const f = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy })
  return { subpaths: path.subpaths.map((sp) => ({ closed: sp.closed, segments: sp.segments.map((s) => mapSeg(s, f)) })) }
}

/** Bounding box (anchors + present handles → a safe superset of the curve). */
export function pathBBox(path: Path): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, has = false
  const acc = (p: Point) => { has = true; if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y }
  for (const sp of path.subpaths) for (const s of sp.segments) { acc(s.anchor); if (s.inHandle) acc(s.inHandle); if (s.outHandle) acc(s.outHandle) }
  return has ? { minX, minY, maxX, maxY } : null
}

/** Deep clone of a path. */
export function clonePath(path: Path): Path {
  return { subpaths: path.subpaths.map((sp) => ({ closed: sp.closed, segments: sp.segments.map((s) => mapSeg(s, (p) => ({ x: p.x, y: p.y }))) })) }
}
