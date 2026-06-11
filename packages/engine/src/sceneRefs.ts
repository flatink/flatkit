// ─────────────────────────────────────────────────────────────────────────────
//  sceneRefs.ts — references to scene objects by NAME ("animator mode").
//
//  The expression language only knew `mouse`/`keys`/variables/math: to target an object you had to keep
//  mirror variables by hand (`let ax = 180 … x = ax`). Here we resolve each NAMED scene item to its LIVE
//  channels at the current frame (position/scale/rotation/opacity, in WORLD coords), ready to inject into
//  the evaluation context → the author writes `x = Hero.x`, `rotation = angle(x, y, Enemy.x, Enemy.y)`.
//
//  Pure (no DOM, no mutation). Same tree walk as the hit-test: each layer is resolved (`resolveLayerAt`),
//  transforms are composed (parent→child), the world matrix is decomposed. Only POSEABLE items carry a
//  name (material does not).
//
//  ONE-LEVEL resolution: channels are computed with the BASE context (without the other named objects)
//  → no recursion or infinite cross-reference. `Bullet.x = Enemy.x` works (Enemy resolved by its
//  timeline); a chain `Foo.x = Bullet.x` sees Bullet's base pose, not Bullet-following-Enemy. Sufficient
//  and deterministic in v1.
// ─────────────────────────────────────────────────────────────────────────────
import type { Doc, ExprContext, Group, Image, Instance, Item, Layer, Text } from '@flatkit/types'
import { IDENTITY, compose, decompose, type Transform } from './transform'
import { resolveLayerAt } from './cel'
import { resolveInstanceFrame } from './timeline'
import { containerLayers, getSymbol, isGroup, isInstance, isPoseable } from './layers'

/** Live channels of an object (same keys as `ExprChannel`). Read-only. */
export type ObjectChannels = Record<string, number>
/** Object name → channels table. Compatible with member access in expressions (`Hero.x`). */
export type NamedChannels = Record<string, ObjectChannels>

/** World channels of a poseable item from its resolved matrix. */
const channelsOf = (t: Transform, opacity: number): ObjectChannels => {
  const d = decompose(t)
  return { x: d.x, y: d.y, scaleX: d.scaleX, scaleY: d.scaleY, rotation: d.rotation, opacity }
}

/** Walk of the rendered tree (layers → resolved poses), composing parent→child. `visit` receives each
 *  poseable item and its WORLD matrix. Shared by the by-name and by-id resolvers. */
type Poseable = Group | Instance | Text | Image
type Visit = (it: Poseable, world: Transform, parent: Transform) => void
const MAX_NEST = 256 // overflow guard (an untrusted doc with pathological nesting); beyond any real rig
function walk(doc: Doc, items: Item[], frame: number, matrix: Transform, fps: number, ctx: ExprContext | undefined, seen: Set<string>, visit: Visit, depth = 0): void {
  if (depth > MAX_NEST) return
  for (const it of items) {
    if (!isPoseable(it)) continue // material (Region) has no name
    const t = compose(matrix, it.transform)
    visit(it, t, matrix) // matrix = the parent's WORLD transform (the space where the item's x/y live)
    if (isInstance(it)) {
      if (seen.has(it.symbolId)) continue // recursion guard (a self-referencing symbol)
      const sym = getSymbol(doc, it.symbolId)
      const local = sym?.timeline ? resolveInstanceFrame(it.playback, frame, sym.timeline.durationFrames) : frame
      const next = new Set([...seen, it.symbolId])
      for (const l of containerLayers(doc, it)) if (l.visible) walk(doc, resolveLayerAt(l, local, { fps, ctx, parent: t }), local, t, fps, ctx, next, visit, depth + 1)
    } else if (isGroup(it)) {
      for (const l of it.layers) if (l.visible) walk(doc, resolveLayerAt(l, frame, { fps, ctx, parent: t }), frame, t, fps, ctx, seen, visit, depth + 1)
    }
  }
}

const roots = (doc: Doc, frame: number, ctx: ExprContext | undefined, fps: number, visit: Visit) => {
  for (const l of doc.layers) if (l.visible) walk(doc, resolveLayerAt(l, frame, { fps, ctx, parent: IDENTITY }), frame, IDENTITY, fps, ctx, new Set(), visit)
}

/**
 * Resolve all the NAMED scene objects to world channels at `frame`. `ctx` = base context
 * (mouse/keys/variables) used to evaluate the items' channel expressions during resolution; it must NOT
 * contain the named objects (cf. the "one-level" note).
 */
export function namedChannels(doc: Doc, frame: number, ctx: ExprContext | undefined, fps: number): NamedChannels {
  const out: NamedChannels = {}
  roots(doc, frame, ctx, fps, (it, t) => {
    // First name carrier wins (document order) → deterministic; duplicates are `each`'s job.
    if (it.name && !(it.name in out)) out[it.name] = channelsOf(t, it.opacity ?? 1)
  })
  return out
}

/** World channels of ONE object by its `id` (for `self` in handlers, where the object is known by id,
 *  not by name). `undefined` if the object is not in the rendered tree at this frame. */
export function objectChannelsById(doc: Doc, id: string, frame: number, ctx: ExprContext | undefined, fps: number): ObjectChannels | undefined {
  let found: ObjectChannels | undefined
  roots(doc, frame, ctx, fps, (it, t) => {
    if (it.id === id && !found) found = channelsOf(t, it.opacity ?? 1)
  })
  return found
}

/** WORLD transform of an object's PARENT — the space in which its x/y live (its `x = var` binding).
 *  For a root object = identity; nested = the composed transform of the ancestors. Used to convert a
 *  world point (the pointer) → the object's local space before writing the variable (dragging a nested object). */
export function objectParentTransform(doc: Doc, id: string, frame: number, ctx: ExprContext | undefined, fps: number): Transform | undefined {
  let found: Transform | undefined
  roots(doc, frame, ctx, fps, (it, _world, parent) => {
    if (it.id === id && !found) found = parent
  })
  return found
}

/**
 * Names of the referenceable objects of a scope (static, without resolution) — for the linter and
 * autocomplete. Descends into groups; NOT into symbols (a different edit scope).
 */
export function objectNames(layers: Layer[]): string[] {
  const out = new Set<string>()
  const walkNames = (ls: Layer[]) => {
    for (const l of ls) for (const it of l.items) {
      if (isPoseable(it) && it.name) out.add(it.name)
      if (isGroup(it)) walkNames(it.layers)
    }
  }
  walkNames(layers)
  return [...out]
}
