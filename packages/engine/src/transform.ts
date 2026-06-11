// ─────────────────────────────────────────────────────────────────────────────
//  transform.ts — 2×3 affine transform (exact matrix, no decomposition).
//  Matrix [[a, c, e], [b, d, f]]: point' = (a·x + c·y + e, b·x + d·y + f).
//  Every composition (scale, rotation, shear) is exact.
// ─────────────────────────────────────────────────────────────────────────────
import type { Point, Transform } from '@flatkit/types'
export type { Transform } from '@flatkit/types'

export const IDENTITY: Transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

export const isIdentity = (t: Transform): boolean =>
  t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && t.e === 0 && t.f === 0

/** Point → transformed point. */
export function apply(t: Transform, p: Point): Point {
  return { x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f }
}

type Conversions = Record<string, (...a: number[]) => number>
// Root case (parent = identity) = the vast majority of objects: a SHARED object, zero allocation in the
// hot render path. toLocalX(px,py)=px, toLocalY(px,py)=py, etc.
const IDENTITY_CONVERSIONS: Conversions = {
  toLocalX: (px) => px,
  toLocalY: (_px, py) => py,
  toGlobalX: (lx) => lx,
  toGlobalY: (_lx, ly) => ly,
}

/**
 * World⇄local space conversion functions exposed to expressions, relative to `parent` (the WORLD
 * transform of the current object's parent). `toLocalX/Y`: world → local space; `toGlobalX/Y`: local →
 * world. At the root (`parent` = identity) they are the identity (shared object).
 */
export function spaceConversions(parent: Transform): Conversions {
  if (isIdentity(parent)) return IDENTITY_CONVERSIONS
  const inv = invert(parent)
  return {
    toLocalX: (px, py) => apply(inv, { x: px, y: py }).x,
    toLocalY: (px, py) => apply(inv, { x: px, y: py }).y,
    toGlobalX: (lx, ly) => apply(parent, { x: lx, y: ly }).x,
    toGlobalY: (lx, ly) => apply(parent, { x: lx, y: ly }).y,
  }
}

/** Inverse transform. */
export function invert(t: Transform): Transform {
  const det = t.a * t.d - t.b * t.c
  const id = det === 0 ? 0 : 1 / det
  const a = t.d * id
  const b = -t.b * id
  const c = -t.c * id
  const d = t.a * id
  return { a, b, c, d, e: -(a * t.e + c * t.f), f: -(b * t.e + d * t.f) }
}

/** `parent ∘ child`: applies `child` then `parent` (matrix product). */
export function compose(parent: Transform, child: Transform): Transform {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    e: parent.a * child.e + parent.c * child.f + parent.e,
    f: parent.b * child.e + parent.d * child.f + parent.f,
  }
}

/** Extra translation in world space. */
export function translate(t: Transform, dx: number, dy: number): Transform {
  return { ...t, e: t.e + dx, f: t.f + dy }
}

/** Pure translation transform. */
export function translation(dx: number, dy: number): Transform {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy }
}

/** Rotation angle (radians) of the transformed X axis — useful for gradients. */
export function rotationOf(t: Transform): number {
  return Math.atan2(t.b, t.a)
}

export type Decomposed = { x: number; y: number; scaleX: number; scaleY: number; rotation: number }

/** Decompose into position/scale/rotation (ignores any shear). */
export function decompose(t: Transform): Decomposed {
  const scaleX = Math.hypot(t.a, t.b)
  if (scaleX !== 0) {
    const det = t.a * t.d - t.b * t.c
    return { x: t.e, y: t.f, scaleX, scaleY: det / scaleX, rotation: Math.atan2(t.b, t.a) }
  }
  // First column is zero (scaleX = 0): scaleY/rotation are read from the second column (c, d) — otherwise
  // scaleY would collapse to 0 (bug: a mask/shutter starting at width 0 would lose all its height).
  return { x: t.e, y: t.f, scaleX: 0, scaleY: Math.hypot(t.c, t.d), rotation: Math.atan2(-t.c, t.d) }
}

/** Recompose a matrix from position/scale/rotation. */
export function recompose(d: Decomposed): Transform {
  const c = Math.cos(d.rotation)
  const s = Math.sin(d.rotation)
  return { a: d.scaleX * c, b: d.scaleX * s, c: -d.scaleY * s, d: d.scaleY * c, e: d.x, f: d.y }
}

/** SVG representation (`transform="matrix(...)"`). */
export function toSvg(t: Transform): string {
  if (isIdentity(t)) return ''
  const r = (v: number) => Math.round(v * 100000) / 100000
  return `matrix(${r(t.a)} ${r(t.b)} ${r(t.c)} ${r(t.d)} ${r(t.e)} ${r(t.f)})`
}
