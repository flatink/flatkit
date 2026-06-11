// ─────────────────────────────────────────────────────────────────────────────
//  viewport.ts — view math (pan / zoom), pure and testable.
//  Convention: screen = world * scale + t.
// ─────────────────────────────────────────────────────────────────────────────
import type { Point } from '@flatkit/types'

export type Viewport = { tx: number; ty: number; scale: number }

export const MIN_SCALE = 0.05
export const MAX_SCALE = 32

export const clampScale = (s: number): number => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s))

export function screenToWorld(vp: Viewport, sx: number, sy: number): Point {
  return { x: (sx - vp.tx) / vp.scale, y: (sy - vp.ty) / vp.scale }
}

export function worldToScreen(vp: Viewport, p: Point): Point {
  return { x: p.x * vp.scale + vp.tx, y: p.y * vp.scale + vp.ty }
}

/** Zoom by a factor around a screen point (cx, cy) that stays fixed on screen. */
export function zoomAround(vp: Viewport, factor: number, cx: number, cy: number): Viewport {
  const scale = clampScale(vp.scale * factor)
  const k = scale / vp.scale
  return { tx: cx - (cx - vp.tx) * k, ty: cy - (cy - vp.ty) * k, scale }
}

/** Fit a document (docW×docH) into a canvas (cw×ch) with a margin. */
export function fitViewport(
  cw: number,
  ch: number,
  docW: number,
  docH: number,
  margin = 80,
): Viewport {
  const scale = clampScale(Math.min((cw - margin) / docW, (ch - margin) / docH))
  return { tx: (cw - docW * scale) / 2, ty: (ch - docH * scale) / 2, scale }
}
