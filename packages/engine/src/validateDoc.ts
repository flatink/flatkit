// ─────────────────────────────────────────────────────────────────────────────
//  validateDoc.ts — a lightweight, defensive normalizer for an UNTRUSTED `Doc`.
//
//  A `.flatpack` is plain JSON that may come from anywhere (it can be embedded in a third-party page).
//  `JSON.parse(...) as Doc` trusts it blindly. This pass is NOT a full schema validator — the renderer
//  and hit-tester already cap recursion depth, and the action interpreter caps per-tick work — it only
//  rejects a non-object top level and clamps the few fields whose raw value could itself be harmful:
//    • width/height → finite, positive, bounded (no giant-canvas allocation);
//    • layers/symbols → arrays (a missing/garbage value would crash the player);
//    • variables → no `__proto__`/`constructor`/`prototype` keys (prototype-pollution defense, since
//      variables are spread into plain objects, e.g. `allVars()`).
//  It returns a shallow-cloned, safe-to-play Doc, or throws if the input is not a Doc-shaped object.
// ─────────────────────────────────────────────────────────────────────────────

import type { Doc } from '@flatkit/types'

/** Hard cap on a page dimension (px). Above this, a doc is treated as hostile/corrupt and clamped. */
export const MAX_DIMENSION = 16_384

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function clampDimension(v: unknown, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback
  return Math.max(1, Math.min(MAX_DIMENSION, n))
}

/** Drop dangerous keys from the variable table (prototype-pollution defense). Returns undefined if empty. */
function safeVariables(vars: unknown): Doc['variables'] {
  if (!vars || typeof vars !== 'object') return undefined
  const out: Record<string, number | number[]> = {}
  for (const [k, v] of Object.entries(vars as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(k)) continue
    if (typeof v === 'number' || (Array.isArray(v) && v.every((x) => typeof x === 'number'))) out[k] = v as number | number[]
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Normalize an untrusted, freshly-parsed `Doc` into a safe-to-play one. Throws if `raw` is not an object.
 * Cheap (shallow): deep recursion bounds live in the renderer/hit-tester/action interpreter.
 */
export function sanitizeDoc(raw: unknown): Doc {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid .flatpack: expected a Doc object')
  const d = raw as Partial<Doc>
  return {
    ...(d as Doc),
    width: clampDimension(d.width, 512),
    height: clampDimension(d.height, 512),
    layers: Array.isArray(d.layers) ? d.layers : [],
    symbols: Array.isArray(d.symbols) ? d.symbols : [],
    assets: Array.isArray(d.assets) ? d.assets : undefined,
    variables: safeVariables(d.variables),
  }
}
