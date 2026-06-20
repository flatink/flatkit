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
import { lerpColor, splitAlpha, withAlpha } from './color'

export const solid = (color: string): Paint => ({ type: 'solid', color })

/**
 * Resolve a "color ref" (hex | symbol color-param + optional alpha) to a concrete CSS color, given the
 * instance's color-param scope. THE shared primitive behind `fill <param>` (solid), gradient stops and tint:
 *  - `param` set & resolvable in `colorParams` → that color (else fall back to the literal `hex`);
 *  - `alpha` set → OVERRIDES the alpha channel (a param color is a 6-digit hue → a stop can fade it).
 * No param and no alpha → returns `hex` unchanged (the hot path for ordinary literal colors).
 */
export function resolveColorRef(hex: string, param: string | undefined, alpha: number | undefined, colorParams?: Record<string, string>): string {
  if (param == null && alpha == null) return hex
  let c = param != null ? (colorParams?.[param] ?? hex) : hex
  if (alpha != null) c = withAlpha(splitAlpha(c).rgb, alpha)
  return c
}

/** A gradient stop's resolved CSS color (param + per-stop alpha applied). */
export const resolveStopColor = (s: Stop, colorParams?: Record<string, string>): string => resolveColorRef(s.color, s.param, s.alpha, colorParams)

/** A tint's resolved color (its `param` resolved against the scope, else its literal `color`). */
export const resolveTintColor = (t: Tint, colorParams?: Record<string, string>): string => resolveColorRef(t.color, t.param, undefined, colorParams)

export function defaultGradient(type: 'linear' | 'radial', from = '#e63946', to = '#1d3557'): Paint {
  const stops: Stop[] = [
    { offset: 0, color: from },
    { offset: 1, color: to },
  ]
  return type === 'linear'
    ? { type: 'linear', angle: 90, stops }
    : { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops }
}

const n = (v: number) => Math.round(v * 1000) / 1000
// A param stop must NOT merge with a literal stop (or a different param): the key carries param + alpha so
// `paintKey` distinguishes them (two regions merge only if their paint resolves identically).
const stopsKey = (s: Stop[]) => s.map((x) => `${n(x.offset)}@${x.param ? `$${x.param}/${x.alpha ?? ''}` : x.color}`).join(',')
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

/** Effective paint of a region (falls back to the solid color). */
export function regionPaint(region: Region): Paint {
  return region.paint ?? solid(region.color)
}

const lerpN = (a: number, b: number, t: number) => a + (b - a) * t

/** Interpolate two stop lists (by index if same length, otherwise keep `a`). Carries `a`'s param binding
 *  (resolution happens at render, post-lerp) and lerps the per-stop alpha. */
function lerpStops(a: Stop[], b: Stop[], t: number): Stop[] {
  if (a.length !== b.length) return a
  return a.map((s, i) => ({
    offset: lerpN(s.offset, b[i].offset, t),
    color: lerpColor(s.color, b[i].color, t),
    ...(s.param ? { param: s.param } : {}),
    ...(s.alpha != null ? { alpha: lerpN(s.alpha, b[i].alpha ?? s.alpha, t) } : {}),
  }))
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

/** Interpolate two tints (color + amount). Carries `a`'s param binding (resolved at render). */
export function lerpTint(a: Tint, b: Tint, t: number): Tint {
  return { color: lerpColor(a.color, b.color, t), amount: lerpN(a.amount, b.amount, t), ...(a.param ? { param: a.param } : {}) }
}

/** Interpolate two strokes (width + paint); styles taken from `a`. */
export function lerpStroke(a: Stroke, b: Stroke, t: number): Stroke {
  return { ...a, width: lerpN(a.width, b.width, t), paint: lerpPaint(a.paint, b.paint, t) }
}
