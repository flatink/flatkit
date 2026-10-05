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

import type { Doc, Item, Layer } from '@flatkit/types'

/** Hard cap on a page dimension (px). Above this, a doc is treated as hostile/corrupt and clamped. */
export const MAX_DIMENSION = 16_384

/** Keys that must never be written into a plain object built from untrusted input (prototype-pollution
 *  defense). Canonical list — also used by the action interpreter for `send` record field names. */
export const DANGEROUS_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

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
    layers: Array.isArray(d.layers) ? withLayerDefaults(d.layers) : [],
    symbols: Array.isArray(d.symbols) ? d.symbols.map((s) => (Array.isArray(s?.layers) ? { ...s, layers: withLayerDefaults(s.layers) } : s)) : [],
    assets: Array.isArray(d.assets) ? d.assets : undefined,
    variables: safeVariables(d.variables),
  }
}

// ── Default-valued fields (flatink/flatink#62) ───────────────────────────────
// A document may leave out the fields at their default value (`compactDoc`, `flatc --compact`): about 10% of
// a heavy one. Some readers do not default them (a missing `visible` reads as HIDDEN), so they are put back
// ONCE, here, on the way in. Copy-on-write: the host's object is never touched, and a full document comes
// through as the very same objects.

const isIdentity = (t: unknown): boolean => {
  const m = t as Record<string, unknown> | undefined
  return !!m && m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0
}
/** Containers and leaves carry a `transform` (regions do not). */
const hasTransform = (it: Item): boolean => 'kind' in it && (it.kind === 'group' || it.kind === 'instance' || it.kind === 'text' || it.kind === 'image')

function withLayerDefaults(layers: Layer[]): Layer[] {
  let changed = false
  const out = layers.map((l) => {
    if (!l || typeof l !== 'object') return l
    const items = Array.isArray(l.items) ? withItemDefaults(l.items) : []
    if (l.visible !== undefined && l.locked !== undefined && l.opacity !== undefined && items === l.items) return l
    changed = true
    return { ...l, visible: l.visible ?? true, locked: l.locked ?? false, opacity: l.opacity ?? 1, items }
  })
  return changed ? out : layers
}

function withItemDefaults(items: Item[]): Item[] {
  let changed = false
  const out = items.map((it) => {
    if (!it || typeof it !== 'object') return it
    let next = it
    if (hasTransform(it) && !(it as { transform?: unknown }).transform) next = { ...next, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } } as Item
    if ('kind' in it && it.kind === 'group' && Array.isArray(it.layers)) {
      const layers = withLayerDefaults(it.layers)
      if (layers !== it.layers) next = { ...next, layers } as Item
    }
    if (next !== it) changed = true
    return next
  })
  return changed ? out : items
}

/**
 * The same document without the fields at their default value — what `sanitizeDoc` puts back (layer
 * `visible`/`locked`/`opacity`, an identity `transform`) and what the model already treats as optional
 * (`pivot` 0,0, an item's `opacity` 1). Cel poses are left alone: there a missing transform means
 * "inherit", not identity. Needs a reader on FlatKit 0.42 or later.
 */
export function compactDoc(doc: Doc): Doc {
  const items = (its: Item[]): Item[] => its.map((it) => {
    const o: Record<string, unknown> = { ...it }
    if (hasTransform(it) && isIdentity(o.transform)) delete o.transform
    const pv = o.pivot as { x?: number; y?: number } | undefined
    if (pv && pv.x === 0 && pv.y === 0) delete o.pivot
    if (o.opacity === 1) delete o.opacity
    if ('kind' in it && it.kind === 'group' && Array.isArray(it.layers)) o.layers = layers(it.layers)
    return o as unknown as Item
  })
  const layers = (ls: Layer[]): Layer[] => ls.map((l) => {
    const o: Record<string, unknown> = { ...l, items: items(l.items ?? []) }
    if (o.visible === true) delete o.visible
    if (o.locked === false) delete o.locked
    if (o.opacity === 1) delete o.opacity
    return o as unknown as Layer
  })
  return { ...doc, layers: layers(doc.layers), symbols: doc.symbols.map((s) => ({ ...s, layers: layers(s.layers) })) }
}
