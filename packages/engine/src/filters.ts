// ─────────────────────────────────────────────────────────────────────────────
//  filters.ts — per-poseable FILTER stack. Pure, with no render dependency.
//
//  Flash-style model: blur, drop shadow, glow, color adjustment. Each filter maps to a CSS `filter`
//  function (native `ctx.filter` rendering on the canvas side → the player stays light). Parameters are
//  INTERPOLATABLE (animated over tweens).
// ─────────────────────────────────────────────────────────────────────────────
import type { Filter } from '@flatkit/types'
export type { Filter } from '@flatkit/types'
import { lerpColor, splitAlpha, withAlpha } from './color'

const r = (v: number) => Math.round(v * 1000) / 1000

/** Default filter of a given type (neutral/soft values) — for adding from the UI. */
export function defaultFilter(type: Filter['type']): Filter {
  switch (type) {
    case 'blur': return { type: 'blur', radius: 4 }
    case 'shadow': return { type: 'shadow', dx: 4, dy: 4, blur: 4, color: '#00000080' }
    case 'glow': return { type: 'glow', blur: 8, color: '#ffd24d' }
    case 'adjust': return { type: 'adjust', brightness: 1, contrast: 1, saturate: 1, hue: 0 }
  }
}

/** One stack entry → a CSS `filter` function. `s` = length scale factor (doc px → screen px). */
function filterCss(f: Filter, s: number): string {
  switch (f.type) {
    case 'blur': return `blur(${r(Math.max(0, f.radius) * s)}px)`
    case 'shadow': return `drop-shadow(${r(f.dx * s)}px ${r(f.dy * s)}px ${r(Math.max(0, f.blur) * s)}px ${f.color})`
    case 'glow': return `drop-shadow(0 0 ${r(Math.max(0, f.blur) * s)}px ${f.color})`
    case 'adjust': {
      const parts: string[] = []
      if (f.brightness != null && f.brightness !== 1) parts.push(`brightness(${r(f.brightness)})`)
      if (f.contrast != null && f.contrast !== 1) parts.push(`contrast(${r(f.contrast)})`)
      if (f.saturate != null && f.saturate !== 1) parts.push(`saturate(${r(f.saturate)})`)
      if (f.hue != null && f.hue !== 0) parts.push(`hue-rotate(${r(f.hue)}deg)`)
      return parts.join(' ')
    }
  }
}

/**
 * CSS `filter` string of a stack (order = application order). Empty → '' (no filter).
 * `scale` brings lengths (blur, shadow) to the render scale (canvas CSS filters are in screen px,
 * independent of the current transform → we scale them to follow the zoom).
 */
export function cssFilterString(filters: Filter[] | undefined, scale = 1): string {
  if (!filters || filters.length === 0) return ''
  return filters.map((f) => filterCss(f, scale)).filter(Boolean).join(' ')
}

const lerpN = (a: number, b: number, t: number) => a + (b - a) * t
const lerpDef = (a: number | undefined, b: number | undefined, t: number, dflt: number) =>
  lerpN(a ?? dflt, b ?? dflt, t)

/** Interpolate TWO filters of the same type (matched by index). */
function lerpFilter(a: Filter, b: Filter, t: number): Filter {
  if (a.type !== b.type) return t < 0.5 ? a : b // different types → switch (no morph)
  switch (a.type) {
    case 'blur': return { type: 'blur', radius: lerpN(a.radius, (b as typeof a).radius, t) }
    case 'shadow': {
      const o = b as typeof a
      return { type: 'shadow', dx: lerpN(a.dx, o.dx, t), dy: lerpN(a.dy, o.dy, t), blur: lerpN(a.blur, o.blur, t), color: lerpColor(a.color, o.color, t) }
    }
    case 'glow': {
      const o = b as typeof a
      return { type: 'glow', blur: lerpN(a.blur, o.blur, t), color: lerpColor(a.color, o.color, t) }
    }
    case 'adjust': {
      const o = b as typeof a
      return { type: 'adjust', brightness: lerpDef(a.brightness, o.brightness, t, 1), contrast: lerpDef(a.contrast, o.contrast, t, 1), saturate: lerpDef(a.saturate, o.saturate, t, 1), hue: lerpDef(a.hue, o.hue, t, 0) }
    }
  }
}

/** "Neutral" version of a filter (invisible) — fade target when the other key lacks this filter. */
function identityOf(f: Filter): Filter {
  switch (f.type) {
    case 'blur': return { type: 'blur', radius: 0 }
    case 'shadow': return { type: 'shadow', dx: f.dx, dy: f.dy, blur: f.blur, color: withAlpha(splitAlpha(f.color).rgb, 0) }
    case 'glow': return { type: 'glow', blur: f.blur, color: withAlpha(splitAlpha(f.color).rgb, 0) }
    case 'adjust': return { type: 'adjust', brightness: 1, contrast: 1, saturate: 1, hue: 0 }
  }
}

/**
 * Interpolate two filter stacks (matched by index). A filter present on ONE side only FADES to/from its
 * neutral version (a blur set on a single key fades out) → no need to duplicate the filter on both
 * keyframes. Index-matched entries of different types → switch.
 */
export function lerpFilters(a: Filter[] | undefined, b: Filter[] | undefined, t: number): Filter[] | undefined {
  const A = a ?? []
  const B = b ?? []
  if (A.length === 0 && B.length === 0) return undefined
  const n = Math.max(A.length, B.length)
  const out: Filter[] = []
  for (let i = 0; i < n; i++) {
    const fa = A[i]
    const fb = B[i]
    if (fa && fb) out.push(fa.type === fb.type ? lerpFilter(fa, fb, t) : (t < 0.5 ? fa : fb))
    else if (fa) out.push(lerpFilter(fa, identityOf(fa), t)) // fade out
    else if (fb) out.push(lerpFilter(identityOf(fb), fb, t)) // fade in
  }
  return out.length ? out : undefined
}
