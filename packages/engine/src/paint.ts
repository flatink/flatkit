// ─────────────────────────────────────────────────────────────────────────────
//  paint.ts — the "paint" model of a region: solid | linear gradient | radial gradient.
//  Pure, with no render dependency.
//
//  Integration with the "material" mode: automatic merging only joins regions with IDENTICAL paint
//  (cf. paintKey). Gradients therefore do not merge on their own, but still cut the other colors.
//
//  Gradient geometry is expressed in the bounding box's normalized frame (0..1), SVG
//  objectBoundingBox style: the paint follows the shape when it is moved or resized.
// ─────────────────────────────────────────────────────────────────────────────
import type { Region, Stop, Tint, Paint, Stroke, BBox } from '@flatkit/types'
export type { Stop, Tint, Paint, Stroke } from '@flatkit/types'
import { lerpColor } from './color'

export const solid = (color: string): Paint => ({ type: 'solid', color })

/** Default stroke (inkwell / pen): a black line, rounded caps/joins. */
export const defaultStroke = (): Stroke => ({ width: 4, paint: solid('#1b1d22'), cap: 'round', join: 'round' })

export function defaultGradient(type: 'linear' | 'radial', from = '#e63946', to = '#1d3557'): Paint {
  const stops: Stop[] = [
    { offset: 0, color: from },
    { offset: 1, color: to },
  ]
  return type === 'linear'
    ? { type: 'linear', angle: 90, stops }
    : { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops }
}

/** "Representative" color (solid fallback, thumbnails, fallback SVG fill). */
export function primaryColor(p: Paint): string {
  if (p.type === 'solid') return p.color
  return p.stops[0]?.color ?? '#000000'
}

const n = (v: number) => Math.round(v * 1000) / 1000
const stopsKey = (s: Stop[]) => s.map((x) => `${n(x.offset)}@${x.color}`).join(',')
const boxKey = (b?: BBox) => (b ? `#${n(b.minX)},${n(b.minY)},${n(b.maxX)},${n(b.maxY)}` : '')

/** Stable key: two paints merge iff their keys are equal. */
export function paintKey(p: Paint): string {
  switch (p.type) {
    case 'solid':
      return `s:${p.color.toLowerCase()}`
    case 'linear':
      return `l:${n(p.angle)}:${stopsKey(p.stops)}${boxKey(p.box)}`
    case 'radial':
      return `r:${n(p.cx)},${n(p.cy)},${n(p.r)}:${stopsKey(p.stops)}${boxKey(p.box)}`
  }
}

export const paintEquals = (a: Paint, b: Paint): boolean => paintKey(a) === paintKey(b)

/** Anchor a gradient's geometry to an absolute box (solid unchanged). */
export function bakePaint(paint: Paint, box: BBox): Paint {
  return paint.type === 'solid' ? paint : { ...paint, box }
}

/** Translate the anchor box (follow the shape when moving). */
export function translatePaintBox(paint: Paint, dx: number, dy: number): Paint {
  if (paint.type === 'solid' || !paint.box) return paint
  const b = paint.box
  return {
    ...paint,
    box: { minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy },
  }
}

/** Effective paint of a region (falls back to the solid color). */
export function regionPaint(region: Region): Paint {
  return region.paint ?? solid(region.color)
}

const lerpN = (a: number, b: number, t: number) => a + (b - a) * t

/** Interpolate two stop lists (by index if same length, otherwise keep `a`). */
function lerpStops(a: Stop[], b: Stop[], t: number): Stop[] {
  if (a.length !== b.length) return a
  return a.map((s, i) => ({ offset: lerpN(s.offset, b[i].offset, t), color: lerpColor(s.color, b[i].color, t) }))
}

/**
 * Interpolate two paints at `t` ∈ [0,1]. Same type → continuous interpolation (color / stops /
 * geometry); different types → switch at mid-course (no morph).
 */
export function lerpPaint(a: Paint, b: Paint, t: number): Paint {
  if (a.type !== b.type) return t < 0.5 ? a : b
  if (a.type === 'solid' && b.type === 'solid') return { type: 'solid', color: lerpColor(a.color, b.color, t) }
  if (a.type === 'linear' && b.type === 'linear') {
    return { type: 'linear', angle: lerpN(a.angle, b.angle, t), stops: lerpStops(a.stops, b.stops, t), box: a.box ?? b.box }
  }
  if (a.type === 'radial' && b.type === 'radial') {
    return {
      type: 'radial',
      cx: lerpN(a.cx, b.cx, t),
      cy: lerpN(a.cy, b.cy, t),
      r: lerpN(a.r, b.r, t),
      stops: lerpStops(a.stops, b.stops, t),
      box: a.box ?? b.box,
    }
  }
  return a
}

/** Interpolate two tints (color + amount). */
export function lerpTint(a: Tint, b: Tint, t: number): Tint {
  return { color: lerpColor(a.color, b.color, t), amount: lerpN(a.amount, b.amount, t) }
}

/** Interpolate two strokes (width + paint); styles taken from `a`. */
export function lerpStroke(a: Stroke, b: Stroke, t: number): Stroke {
  return { ...a, width: lerpN(a.width, b.width, t), paint: lerpPaint(a.paint, b.paint, t) }
}

/** CSS preview (swatch buttons, thumbnail of the current paint). */
export function cssPreview(p: Paint): string {
  if (p.type === 'solid') return p.color
  const list = p.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ')
  return p.type === 'linear'
    ? `linear-gradient(${p.angle}deg, ${list})`
    : `radial-gradient(circle at ${Math.round(p.cx * 100)}% ${Math.round(p.cy * 100)}%, ${list})`
}
