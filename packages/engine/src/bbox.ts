// Bounding boxes — used for alignment, snapping, and marquee hit-test.
import type { Polygon, Region, Shape, BBox } from '@flatkit/types'
export type { BBox } from '@flatkit/types'
import { pathBBox } from './path'

export function ringsBBox(polygons: Polygon[]): BBox | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let has = false
  for (const ring of polygons) {
    for (const p of ring) {
      has = true
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  return has ? { minX, minY, maxX, maxY } : null
}

export function regionBBox(region: Region): BBox | null {
  return pathBBox(region.path)
}

export function shapeBBox(shape: Shape): BBox | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let has = false
  for (const group of shape) {
    for (const ring of group) {
      for (const p of ring) {
        has = true
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
        if (p.x > maxX) maxX = p.x
        if (p.y > maxY) maxY = p.y
      }
    }
  }
  return has ? { minX, minY, maxX, maxY } : null
}

export function combineBBox(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null
  const b: BBox = { ...boxes[0] }
  for (const x of boxes) {
    b.minX = Math.min(b.minX, x.minX)
    b.minY = Math.min(b.minY, x.minY)
    b.maxX = Math.max(b.maxX, x.maxX)
    b.maxY = Math.max(b.maxY, x.maxY)
  }
  return b
}

export function translateBBox(b: BBox, dx: number, dy: number): BBox {
  return { minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy }
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}
