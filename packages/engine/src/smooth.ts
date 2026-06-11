// ─────────────────────────────────────────────────────────────────────────────
//  smooth.ts — smoothing of contours into cubic Bezier curves, at RENDER and EXPORT
//  only (material stays stored as polygons for boolean ops).
//
//  Catmull-Rom → Bezier, with SHARP-ANGLE PRESERVATION: a vertex whose deviation
//  exceeds a threshold stays a hard corner. Consequences:
//   - rectangles / corners (≈90°): unchanged (controls land on the edge → straight);
//   - disc facets, gentle brush turns: smoothed → clean curves at any zoom.
//  No point added: we emit one Bezier per existing edge.
// ─────────────────────────────────────────────────────────────────────────────
import type { Point } from '@flatkit/types'

export type BezierSeg = { c1: Point; c2: Point; p: Point }

/**
 * Smooth a closed ring. `cornerCos` = cosine of the threshold deviation (0.5 = 60°):
 * beyond it, the vertex is treated as a hard corner.
 */
export function smoothClosedRing(ring: Point[], cornerCos = 0.5): { start: Point; segs: BezierSeg[] } | null {
  const n = ring.length
  if (n < 3) return null

  // Classify each vertex: hard corner if the deviation between edges exceeds the threshold.
  const corner: boolean[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n]
    const c = ring[i]
    const q = ring[(i + 1) % n]
    const ax = c.x - p.x
    const ay = c.y - p.y
    const bx = q.x - c.x
    const by = q.y - c.y
    const la = Math.hypot(ax, ay) || 1
    const lb = Math.hypot(bx, by) || 1
    const dot = (ax * bx + ay * by) / (la * lb) // 1 = aligned, 0 = 90°, -1 = reversal
    corner[i] = dot < cornerCos
  }

  const segs: BezierSeg[] = []
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i - 1 + n) % n]
    const p1 = ring[i]
    const p2 = ring[(i + 1) % n]
    const p3 = ring[(i + 2) % n]
    // Outgoing tangent at p1: straight if p1 is a corner, otherwise Catmull-Rom.
    const c1 = corner[i]
      ? { x: p1.x + (p2.x - p1.x) / 3, y: p1.y + (p2.y - p1.y) / 3 }
      : { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    // Incoming tangent at p2: straight if p2 is a corner, otherwise Catmull-Rom.
    const c2 = corner[(i + 1) % n]
      ? { x: p2.x + (p1.x - p2.x) / 3, y: p2.y + (p1.y - p2.y) / 3 }
      : { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    segs.push({ c1, c2, p: p2 })
  }
  return { start: ring[0], segs }
}
