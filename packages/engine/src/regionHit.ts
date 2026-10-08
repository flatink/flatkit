// ─────────────────────────────────────────────────────────────────────────────
//  regionHit.ts — PURE geometric hit-testing (point-in-polygon).
//  These helpers are read-only (ray casting, even-odd or nonzero rule) and have NO need for the boolean-ops
//  engine. Keeping them here lets the PLAYBACK runtime (groups.ts → player.ts) use them without
//  pulling the boolean engine (polygon-clipping/clipper2) into its graph — the geometry is already
//  baked by the compiler, the player never performs a boolean op.
// ─────────────────────────────────────────────────────────────────────────────
import type { Point, Region } from '@flatkit/types'
import { pathToPolygons } from './path'

/**
 * Point in a set of rings (ray casting), by a fill rule. EVEN-ODD, the default: inside = an odd number of
 * rings contain the point (a nested ring is a hole). NONZERO, the SVG / Canvas default: inside = the rings
 * wind around the point a non-zero number of times — two rings of the same direction add up where they
 * overlap, a ring of the opposite direction cuts a hole.
 */
export function pointInRings(polygons: Point[][], pt: Point, nonzero = false): boolean {
  let crossings = 0
  let winding = 0
  for (const ring of polygons) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j]
      const b = ring[i]
      if (a.y > pt.y === b.y > pt.y || pt.x >= a.x + ((pt.y - a.y) / (b.y - a.y)) * (b.x - a.x)) continue
      crossings++
      winding += b.y > a.y ? 1 : -1
    }
  }
  return nonzero ? winding !== 0 : crossings % 2 === 1
}

/** Point-in-ring test (ray casting). */
export const pointInRing = (ring: Point[], pt: Point): boolean => pointInRings([ring], pt)

/** Point in the region's fill, by ITS rule: even-odd (inside the contour, outside the holes) or `nonzero`. */
export function pointInRegion(region: Region, pt: Point): boolean {
  return pointInRings(pathToPolygons(region.path), pt, region.fillRule === 'nonzero')
}
