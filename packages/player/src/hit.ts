// -----------------------------------------------------------------------------
//  runtime/hit.ts -- click/hover test, PURE and LIGHTWEIGHT (zero `polygon-clipping`).
//
//  Returns the CHAIN of items under a point (from the root container down to the
//  deepest item), accounting for ANIMATED poses at EVERY level (nested groups AND
//  symbols, with a per-instance local frame). Home-grown point-in-polygon (even-odd
//  ray-casting -> handles holes). Knows nothing about the fill engine -> lightweight
//  and embeddable.
// -----------------------------------------------------------------------------
import type { Doc, Group, Instance, Item, Layer, Path, Point, Region, SymbolDef } from '@flatkit/types'
import { containerLayers, getSymbol, isContainer, isGroup, isInstance, isRegion, isText, isImage, layerStructure } from '@flatkit/engine/layers'
import { apply, invert, compose, IDENTITY, type Transform } from '@flatkit/engine/transform'
import { type Timeline } from '@flatkit/engine/timeline'
import { instanceFrames } from '@flatkit/engine/params'
import { resolveLayerAt } from '@flatkit/engine/cel'
import { pathToPolygons } from '@flatkit/engine/path'
import { guidePathOf } from './drawScene'
import type { ExprContext } from '@flatkit/engine/expr'

/** Does the point fall inside the shape of a mask layer? (resolved fill; containers = non-blocking) */
function pointInMask(mask: Layer, frame: number, fps: number, ctx: ExprContext | undefined, pt: Point): boolean {
  let hasContainer = false
  for (const it of resolveLayerAt(mask, frame, { fps, ctx })) {
    if (it.hidden) continue
    if (isContainer(it)) { hasContainer = true; continue }
    if (pointInPolygons(pathToPolygons((it as Region).path), pt)) return true // fill = concrete polygons (no transform)
  }
  return hasContainer // complex mask shape (symbol/group) -> we do not block the selection
}

/** Does the point (parent space) fall inside a local box [0,0]-[w,h] of a transformed item? */
function pointInBox(transform: import('@flatkit/engine/transform').Transform, w: number, h: number, pt: Point): boolean {
  const p = apply(invert(transform), pt)
  return p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h
}

/** Point inside a set of rings (outline + holes), even-odd rule. */
export function pointInPolygons(rings: Point[][], pt: Point): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]
      const b = ring[j]
      if (a.y > pt.y !== b.y > pt.y) {
        const x = a.x + ((pt.y - a.y) / (b.y - a.y)) * (b.x - a.x)
        if (pt.x < x) inside = !inside
      }
    }
  }
  return inside
}

/** Distance from a point to the segment [a,b]. */
function distToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Is the point within `dist` of the PATH (outline entities: only the stroke is clickable, not the interior)? */
export function pointNearPath(path: Path, pt: Point, dist: number): boolean {
  for (const sp of path.subpaths) {
    const ring = pathToPolygons({ subpaths: [sp] })[0]
    if (!ring || ring.length < 2) continue
    const segCount = sp.closed ? ring.length : ring.length - 1
    for (let i = 0; i < segCount; i++) if (distToSeg(pt, ring[i], ring[(i + 1) % ring.length]) <= dist) return true
  }
  return false
}

/**
 * Does the `inner` path run along the EDGE of the `outer` polygon? (>= `frac` of its points within `dist`)
 * Used for "double-click = fill + its outlines": keeps only the outlines that actually follow the
 * boundary of the fill (not those that merely overlap it).
 */
export function pathFollowsPolygons(inner: Path, outer: Point[][], dist: number, frac = 0.7): boolean {
  const pts = pathToPolygons(inner).flat()
  if (pts.length === 0) return false
  let near = 0
  for (const p of pts) {
    for (const ring of outer) {
      let onRing = false
      for (let i = 0; i < ring.length && !onRing; i++) if (distToSeg(p, ring[i], ring[(i + 1) % ring.length]) <= dist) onRing = true
      if (onRing) { near++; break }
    }
  }
  return near / pts.length >= frac
}

/**
 * Does an item take part in the runtime (player) HIT? No if hidden, near-invisible (opacity ~0 ->
 * lets the click through), or explicitly `noHit` (non-interactive but ALWAYS drawn). For a
 * container, `noHit` short-circuits its whole subtree (we do not descend).
 */
const hittable = (it: Item): boolean => !it.hidden && (it.opacity ?? 1) > 0.01 && !it.noHit

/** Is a region an OUTLINE ENTITY (noFill + stroke)? Hit by proximity to the stroke. */
function hitRegion(r: Region, pt: Point): boolean {
  if (r.noFill && r.stroke) return pointNearPath(r.path, pt, r.stroke.width / 2 + 4)
  return pointInPolygons(pathToPolygons(r.path), pt)
}

/**
 * Sub-scope POSE frame + playback CLOCK of a container, consistent with rendering (drawScene). `clock` =
 * the advancing clock of the current scope; a state pin freezes the child's pose while its clock flows
 * (so a moving sub-loop under a pinned state is clickable where it's DRAWN, not where it'd be frozen).
 *  - `freeze` (EDITOR): sub-scopes FROZEN (a state-driven instance at its selected state's frame, else 0);
 *  - PLAYER: instances via `instanceFrames`; a local symbol (group+timeline) rides the clock; a plain
 *    group is the same scope (pose = parent frame, clock unchanged).
 */
function subScopeFrames(it: Group | Instance, sym: SymbolDef | undefined, frame: number, clock: number, ctx: ExprContext, freeze: boolean, fps: number): { pose: number; clock: number } {
  if (isInstance(it)) {
    // `independent`/`once` ride the runtime beat, not the parent clock — so the hit shape matches what's
    // DRAWN (drawScene uses the same beat). `ctx.clock` carries `mono / fps` (seconds) → × the clip's fps.
    const childFps = sym?.timeline?.fps ?? fps
    const monoFrame = typeof ctx.clock === 'number' ? ctx.clock * childFps : undefined
    return instanceFrames(sym, it, clock, freeze, ctx, monoFrame)
  }
  if (isGroup(it) && it.timeline) { const f = freeze ? 0 : clock; return { pose: f, clock: f } }
  return { pose: frame, clock } // plain group = same scope (frame passes through)
}

// Same cap as the renderer (drawScene.ts): an untrusted doc with pathological container nesting must not
// blow the stack on a click/hover. `seen` only breaks instance-symbol cycles; plain groups need a depth cap.
const MAX_NEST = 256

/** Chain of items hit within a scope (container first, deeper next), or null. */
function hitInScope(
  doc: Doc,
  layers: Layer[],
  timeline: Timeline | undefined,
  frame: number,
  clock: number, // advancing playback clock of this scope (= frame, unless an ancestor is state-pinned)
  ctx: ExprContext,
  pt: Point,
  seen: Set<string>,
  freeze: boolean,
  parent: Transform = IDENTITY,
  depth = 0,
): string[] | null {
  if (depth > MAX_NEST) return null // pathological nesting -> stop
  const fps = timeline?.fps ?? 24
  const { hidden: hid, masks, guides } = layerStructure(layers) // one pass for all three
  for (let li = layers.length - 1; li >= 0; li--) {
    const layer = layers[li]
    if (hid.has(layer.id) || layer.isMask) continue
    const mask = masks.get(layer.id)
    if (mask && !pointInMask(mask, frame, fps, ctx, pt)) continue // outside the mask
    const gl = guides.get(layer.id)
    const guide = gl ? guidePathOf(gl, frame, { fps, expr: ctx }) ?? undefined : undefined
    const items = resolveLayerAt(layer, frame, { fps, ctx, guide, orient: layer.orientToGuide, parent }) // resolved content (guided poses included)
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (!hittable(it)) continue // hidden / near-invisible / non-interactive -> lets the click through
      if (isContainer(it)) {
        if (isInstance(it) && seen.has(it.symbolId)) continue
        const local = apply(invert(it.transform), pt) // transform = resolved pose
        const inst = isInstance(it)
        const sym = inst ? getSymbol(doc, it.symbolId) : undefined
        const subTl = inst ? sym?.timeline : isGroup(it) && it.timeline ? it.timeline : timeline // local symbol = its timeline; legacy group = parent scope
        const { pose: subFrame, clock: subClock } = subScopeFrames(it, sym, frame, clock, ctx, freeze, fps)
        const next = inst ? new Set([...seen, it.symbolId]) : seen
        const deeper = hitInScope(doc, containerLayers(doc, it), subTl, subFrame, subClock, ctx, local, next, freeze, compose(parent, it.transform), depth + 1)
        if (deeper) return [it.id, ...deeper]
      } else if (isText(it)) {
        if (pointInBox(it.transform, it.box.w, it.box.h, pt)) return [it.id]
      } else if (isImage(it)) {
        if (pointInBox(it.transform, it.w, it.h, pt)) return [it.id]
      } else {
        if (hitRegion(it as Region, pt)) return [it.id] // fill = interior; outline entity = proximity to the stroke
      }
    }
  }
  return null
}

/** Chain of items under `worldPt` at the given frame (animated poses at all levels, PLAYER: composed). */
export function hitChain(doc: Doc, frame: number, ctx: ExprContext, worldPt: Point): string[] {
  return hitInScope(doc, doc.layers, doc.timeline, frame, frame, ctx, worldPt, new Set(), false) ?? []
}

/**
 * ALL item chains under `worldPt`, in Z order (from TOPMOST to bottom). Where `hitChain` returns
 * only the topmost chain, this one returns them all -- which lets the player make a click/hover
 * "fall" through a NON-interactive item placed on top, down to the clickable one beneath (otherwise
 * a plain decorative text would intercept the click without passing it along).
 */
function collectInScope(
  doc: Doc,
  layers: Layer[],
  timeline: Timeline | undefined,
  frame: number,
  clock: number, // advancing playback clock of this scope (= frame, unless an ancestor is state-pinned)
  ctx: ExprContext,
  pt: Point,
  seen: Set<string>,
  freeze: boolean,
  out: string[][],
  parent: Transform = IDENTITY,
  depth = 0,
): void {
  if (depth > MAX_NEST) return // pathological nesting -> stop
  const fps = timeline?.fps ?? 24
  const { hidden: hid, masks, guides } = layerStructure(layers) // one pass for all three
  for (let li = layers.length - 1; li >= 0; li--) {
    const layer = layers[li]
    if (hid.has(layer.id) || layer.isMask) continue
    const mask = masks.get(layer.id)
    if (mask && !pointInMask(mask, frame, fps, ctx, pt)) continue
    const gl = guides.get(layer.id)
    const guide = gl ? guidePathOf(gl, frame, { fps, expr: ctx }) ?? undefined : undefined
    const items = resolveLayerAt(layer, frame, { fps, ctx, guide, orient: layer.orientToGuide, parent })
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (!hittable(it)) continue // hidden / near-invisible / non-interactive -> lets the click through
      if (isContainer(it)) {
        if (isInstance(it) && seen.has(it.symbolId)) continue
        const local = apply(invert(it.transform), pt)
        const inst = isInstance(it)
        const sym = inst ? getSymbol(doc, it.symbolId) : undefined
        const subTl = inst ? sym?.timeline : isGroup(it) && it.timeline ? it.timeline : timeline
        const { pose: subFrame, clock: subClock } = subScopeFrames(it, sym, frame, clock, ctx, freeze, fps)
        const next = inst ? new Set([...seen, it.symbolId]) : seen
        const deeper: string[][] = []
        collectInScope(doc, containerLayers(doc, it), subTl, subFrame, subClock, ctx, local, next, freeze, deeper, compose(parent, it.transform), depth + 1)
        for (const d of deeper) out.push([it.id, ...d]) // container hit only via a descendant
      } else if (isText(it)) {
        if (pointInBox(it.transform, it.box.w, it.box.h, pt)) out.push([it.id])
      } else if (isImage(it)) {
        if (pointInBox(it.transform, it.w, it.h, pt)) out.push([it.id])
      } else {
        if (hitRegion(it as Region, pt)) out.push([it.id])
      }
    }
  }
}

/** All hit chains under `worldPt`, from topmost to bottom (see `collectInScope`). */
export function hitChains(doc: Doc, frame: number, ctx: ExprContext, worldPt: Point): string[][] {
  const out: string[][] = []
  collectInScope(doc, doc.layers, doc.timeline, frame, frame, ctx, worldPt, new Set(), false, out)
  return out
}

/**
 * Pre-flatten every hittable path (region fills + cel material) into the shared `pathToPolygons` cache, so
 * the FIRST hit-test doesn't pay the whole scene's Bezier flattening at once — the cold-start jolt felt on
 * the first `pointermove`/`pointerdown`, when the cache is still empty. Structural, frame-independent walk:
 * the path objects come from the doc and are reused by the hit test BY REFERENCE, so warming them now means
 * cache hits later. Recurses into groups and (once each) symbols; cycle-safe via `seenSym`. Returns the
 * number of paths warmed. Call it OFF the critical path — the player schedules it on `requestIdleCallback`
 * after the first paint, and a host can also call `FlatPlayer.warmHitCache()` explicitly.
 */
export function warmHitCache(doc: Doc): number {
  let n = 0
  const seenSym = new Set<string>()
  const warm = (p: Path): void => { pathToPolygons(p); n++ }
  const visitLayers = (layers: Layer[]): void => { for (const layer of layers) visitLayer(layer) }
  const visitLayer = (layer: Layer): void => {
    for (const it of layer.items) visitItem(it) // roster: containers (+ regions on a static layer)
    if (layer.cels) for (const c of layer.cels) if (c.matter) for (const r of c.matter) warm(r.path) // cel material
  }
  const visitItem = (it: Item): void => {
    if (isGroup(it)) { visitLayers(it.layers); return }
    if (isInstance(it)) {
      if (seenSym.has(it.symbolId)) return // a symbol's paths are shared across its instances → warm once
      seenSym.add(it.symbolId)
      const sym = getSymbol(doc, it.symbolId)
      if (sym) visitLayers(sym.layers)
      return
    }
    if (isRegion(it)) warm(it.path)
  }
  visitLayers(doc.layers)
  return n
}

/**
 * TOP-LEVEL item under the point in a given scope, at the current frame (animated poses taken into
 * account) -- the "time-aware" equivalent of `hitContext` for selection in the editor. Ignores
 * locked layers.
 */
export function hitContextAt(
  doc: Doc,
  layers: Layer[],
  timeline: Timeline | undefined,
  frame: number,
  worldPt: Point,
  ctx?: ExprContext,
  freeze = true, // EDITOR: sub-scopes frozen (consistent with freezeNested rendering)
): { item: Item; layerId: string } | null {
  const fps = timeline?.fps ?? 24
  const { hidden: hid, masks, guides } = layerStructure(layers) // one pass for all three
  for (let li = layers.length - 1; li >= 0; li--) {
    const layer = layers[li]
    if (hid.has(layer.id) || layer.locked || layer.isMask) continue
    const mask = masks.get(layer.id)
    if (mask && !pointInMask(mask, frame, fps, ctx, worldPt)) continue // outside the mask
    const gl = guides.get(layer.id)
    const guide = gl ? guidePathOf(gl, frame, { fps, expr: ctx }) ?? undefined : undefined
    const items = resolveLayerAt(layer, frame, { fps, ctx, guide, orient: layer.orientToGuide })
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.hidden) continue
      if ((it.opacity ?? 1) <= 0.01) continue // invisible (opacity ~0) -> lets the click through
      if (isContainer(it)) {
        const local = apply(invert(it.transform), worldPt) // transform = resolved pose
        const inst = isInstance(it)
        const sym = inst ? getSymbol(doc, it.symbolId) : undefined
        const subTl = inst ? sym?.timeline : isGroup(it) && it.timeline ? it.timeline : timeline // local symbol = its timeline; legacy group = parent scope
        const { pose: subFrame, clock: subClock } = subScopeFrames(it, sym, frame, frame, ctx ?? {}, freeze, fps)
        const seen = inst ? new Set([it.symbolId]) : new Set<string>()
        if (hitInScope(doc, containerLayers(doc, it), subTl, subFrame, subClock, ctx ?? {}, local, seen, freeze, it.transform)) return { item: it, layerId: layer.id }
      } else if (isText(it)) {
        if (pointInBox(it.transform, it.box.w, it.box.h, worldPt)) return { item: it, layerId: layer.id }
      } else if (isImage(it)) {
        if (pointInBox(it.transform, it.w, it.h, worldPt)) return { item: it, layerId: layer.id }
      } else {
        if (hitRegion(it as Region, worldPt)) return { item: it, layerId: layer.id }
      }
    }
  }
  return null
}
