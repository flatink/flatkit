// ─────────────────────────────────────────────────────────────────────────────
//  regionHit.ts — PURE geometric hit-testing (point-in-polygon).
//  These helpers are read-only (ray casting, even-odd rule) and have NO need for the boolean-ops
//  engine. Keeping them here lets the PLAYBACK runtime (groups.ts → player.ts) use them without
//  pulling the boolean engine (polygon-clipping/clipper2) into its graph — the geometry is already
//  baked by the compiler, the player never performs a boolean op.
// ─────────────────────────────────────────────────────────────────────────────
import type { Point, Region } from '@flatkit/types'
import { pathToPolygons } from './path'

/** Point-in-ring test (ray casting). */
export function pointInRing(ring: Point[], pt: Point): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x
    const yi = ring[i].y
    const xj = ring[j].x
    const yj = ring[j].y
    const intersect =
      yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** Point in a set of rings (EVEN-ODD rule: inside = an ODD number of containing rings). */
export function pointInRings(polygons: Point[][], pt: Point): boolean {
  let c = 0
  for (const ring of polygons) if (pointInRing(ring, pt)) c++
  return c % 2 === 1
}

/** Point in the region (inside the contour, outside the holes). */
export function pointInRegion(region: Region, pt: Point): boolean {
  return pointInRings(pathToPolygons(region.path), pt)
}
