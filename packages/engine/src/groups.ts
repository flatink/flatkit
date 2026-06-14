// ─────────────────────────────────────────────────────────────────────────────
//  groups.ts — containers (one-off groups & symbol instances): create, ungroup, measure, hit-test,
//  navigate. Everything resolves symbols via `doc`.
// ─────────────────────────────────────────────────────────────────────────────
import type { Doc, Group, Instance, Item, Layer, Point, Region, Text, Path, Subpath } from '@flatkit/types'
import { apply, compose, IDENTITY, invert, rotationOf, type Transform } from './transform'
import { containerLayers, getSymbol, isContainer, isGroup, isInstance, isText, isImage, isRegion } from './layers'
import { pointInRegion } from './regionHit'
import { transformPath } from './path'
import { combineBBox, regionBBox, type BBox } from './bbox'
import { resolveLayerAt } from './cel'
import { frozenInstanceFrame } from './params'

/** Apply a transform to a region's path (+ the gradient box & angle). */
export function transformRegion(t: Transform, r: Region): Region {
  const path = transformPath(r.path, t)
  let paint = r.paint
  if (paint && paint.type !== 'solid' && paint.box) {
    const b = paint.box
    const corners = [
      apply(t, { x: b.minX, y: b.minY }),
      apply(t, { x: b.maxX, y: b.minY }),
      apply(t, { x: b.maxX, y: b.maxY }),
      apply(t, { x: b.minX, y: b.maxY }),
    ]
    const xs = corners.map((c) => c.x)
    const ys = corners.map((c) => c.y)
    const box = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
    paint =
      paint.type === 'linear'
        ? { ...paint, box, angle: paint.angle + (rotationOf(t) * 180) / Math.PI }
        : { ...paint, box }
  }
  return { ...r, path, paint }
}

/**
 * Bounding box of a container (recursive, resolves symbols).
 *
 * CEL MODEL: a layer's content (material AND poses) lives in its `cels`, not in `layer.items` (= a plain
 * roster). So we resolve each layer via `resolveLayerAt` instead of reading `items` raw — otherwise the
 * material drawn in the cels is ignored and the selection frame is off. Sub-scopes are FROZEN at frame 0
 * (consistent with the editor's `freezeNested` render); `frame` only applies to direct layers.
 */
export function containerBBox(doc: Doc, container: Group | Instance, frame = 0, base: Transform = container.transform, deep = false): BBox | null {
  const boxes: BBox[] = []
  const walk = (layers: Layer[], t: Transform, f: number, seen: Set<string>) => {
    for (const layer of layers) {
      for (const it of resolveLayerAt(layer, f, {})) {
        if (it.hidden) continue
        if (isContainer(it)) {
          if (isInstance(it) && seen.has(it.symbolId)) continue
          const next = isInstance(it) ? new Set([...seen, it.symbolId]) : seen
          // `deep` threads the frame INTO nested timelines (union-over-frames). Default freezes sub-scopes,
          // BUT a state-driven instance freezes at its selected state's frame (static config) so the
          // selection box / position match the rendered state (door "open"); else 0.
          const frozen = isInstance(it) ? frozenInstanceFrame(getSymbol(doc, it.symbolId), it) : 0
          walk(containerLayers(doc, it), compose(t, it.transform), deep ? f : frozen, next)
        } else if (isText(it)) {
          boxes.push(boxBBox(it.transform, it.box.w, it.box.h, t))
        } else if (isImage(it)) {
          boxes.push(boxBBox(it.transform, it.w, it.h, t))
        } else {
          const b = regionBBox(transformRegion(t, it as Region))
          if (b) boxes.push(b)
        }
      }
    }
  }
  const start = isInstance(container) ? new Set([container.symbolId]) : new Set<string>()
  // The TOP-LEVEL container is frozen too: a state-driven instance measured directly (the editor's
  // selection box) freezes at its selected state's frame — consistent with render/hit — instead of `frame`.
  const topSym = isInstance(container) ? getSymbol(doc, container.symbolId) : undefined
  const topFrame = !deep && isInstance(container) && topSym?.states?.length ? frozenInstanceFrame(topSym, container) : frame
  walk(containerLayers(doc, container), base, topFrame, start)
  return combineBBox(boxes)
}

/**
 * UNION of a container's bbox across `frames` (sub-timelines NOT frozen) → the box that holds the whole
 * animation, so motion that drifts/rotates/grows past frame 0 is never clipped. Used by `--preview`.
 */
export function containerBBoxUnion(doc: Doc, container: Group | Instance, frames: number[], base: Transform = container.transform): BBox | null {
  const boxes: BBox[] = []
  for (const f of frames) {
    const b = containerBBox(doc, container, f, base, true)
    if (b) boxes.push(b)
  }
  return boxes.length ? combineBBox(boxes) : null
}

/** Bounding box of a transformed local box [0,0]–[w,h] (text, image). `outer` = the context. */
export function boxBBox(transform: Transform, w: number, h: number, outer: Transform = IDENTITY): BBox {
  const m = compose(outer, transform)
  const corners = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }].map((p) => apply(m, p))
  const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}
export const textBBox = (t: Text, outer: Transform = IDENTITY): BBox => boxBBox(t.transform, t.box.w, t.box.h, outer)

export function itemBBox(doc: Doc, item: Item): BBox | null {
  if (isContainer(item)) return containerBBox(doc, item)
  if (isText(item)) return boxBBox(item.transform, item.box.w, item.box.h)
  if (isImage(item)) return boxBBox(item.transform, item.w, item.h)
  return regionBBox(item)
}

/** Transform a bbox by a matrix (4 corners → min/max). */
function transformBBox(b: BBox, m: Transform): BBox {
  const c = [apply(m, { x: b.minX, y: b.minY }), apply(m, { x: b.maxX, y: b.minY }), apply(m, { x: b.minX, y: b.maxY }), apply(m, { x: b.maxX, y: b.maxY })]
  return { minX: Math.min(...c.map((p) => p.x)), minY: Math.min(...c.map((p) => p.y)), maxX: Math.max(...c.map((p) => p.x)), maxY: Math.max(...c.map((p) => p.y)) }
}

/** WORLD bbox of the first item named `name` — for interactors' `confine`/`dropped on`. Composes the
 *  ancestors' transforms → correct even for a NESTED zone (inside a transformed group). */
export function itemBoundsByName(doc: Doc, name: string): BBox | null {
  let result: BBox | null = null
  let done = false
  const walk = (layers: Layer[], matrix: Transform) => {
    for (const l of layers) for (const it of l.items) {
      if (done) return
      if ('name' in it && it.name === name) { // itemBBox = bbox in PARENT space (includes it.transform) → × the parent's world matrix
        const b = itemBBox(doc, it)
        result = b ? transformBBox(b, matrix) : null
        done = true
        return
      }
      if (isGroup(it)) walk(it.layers, compose(matrix, it.transform))
    }
  }
  walk(doc.layers, IDENTITY)
  return result
}

/** World bbox of a named DROP ZONE: if the group has a `hitbox W H`, use that local rectangle (centered
 *  on the origin, ±w/2 × ±h/2) instead of the content bbox — otherwise `itemBoundsByName`. */
export function dropZoneBounds(doc: Doc, name: string): BBox | null {
  let result: BBox | null = null
  let done = false
  const walk = (layers: Layer[], matrix: Transform) => {
    for (const l of layers) for (const it of l.items) {
      if (done) return
      if ('name' in it && it.name === name) {
        if (isGroup(it) && it.hitbox) {
          const { w, h } = it.hitbox
          result = transformBBox({ minX: -w / 2, minY: -h / 2, maxX: w / 2, maxY: h / 2 }, compose(matrix, it.transform))
        } else {
          const b = itemBBox(doc, it)
          result = b ? transformBBox(b, matrix) : null
        }
        done = true
        return
      }
      if (isGroup(it)) walk(it.layers, compose(matrix, it.transform))
    }
  }
  walk(doc.layers, IDENTITY)
  return result
}

/** WORLD bbox of the first item with the given `id` — for a `reveal`'s zone (the object IS the zone). */
export function itemBoundsById(doc: Doc, id: string): BBox | null {
  let result: BBox | null = null
  let done = false
  const walk = (layers: Layer[], matrix: Transform) => {
    for (const l of layers) for (const it of l.items) {
      if (done) return
      if (it.id === id) {
        const b = itemBBox(doc, it)
        result = b ? transformBBox(b, matrix) : null
        done = true
        return
      }
      if (isGroup(it)) walk(it.layers, compose(matrix, it.transform))
    }
  }
  walk(doc.layers, IDENTITY)
  return result
}

/** Targets of a `link`: the DIRECT named children of the group `name`, in order, with their world bbox
 *  (like `dropZoneBounds`: a sub-group's `hitbox` is honored). The 1-based index is the `target` output. */
export function groupTargets(doc: Doc, name: string): { name: string; bbox: BBox }[] {
  const find = (layers: Layer[], matrix: Transform): { layers: Layer[]; matrix: Transform } | null => {
    for (const l of layers) for (const it of l.items) {
      if (isGroup(it) && it.name === name) return { layers: it.layers, matrix: compose(matrix, it.transform) }
      if (isGroup(it)) { const hit = find(it.layers, compose(matrix, it.transform)); if (hit) return hit }
    }
    return null
  }
  const group = find(doc.layers, IDENTITY)
  if (!group) return []
  const { layers, matrix } = group
  const out: { name: string; bbox: BBox }[] = []
  for (const l of layers) for (const it of l.items) {
    if (!('name' in it) || !it.name) continue
    let bbox: BBox | null
    if (isGroup(it) && it.hitbox) {
      const { w, h } = it.hitbox
      bbox = transformBBox({ minX: -w / 2, minY: -h / 2, maxX: w / 2, maxY: h / 2 }, compose(matrix, it.transform))
    } else {
      const b = itemBBox(doc, it)
      bbox = b ? transformBBox(b, matrix) : null
    }
    if (bbox) out.push({ name: it.name, bbox })
  }
  return out
}

/** WORLD path of a named group (all its regions, transformed + concatenated) — a `trace` target. */
export function tracePathByName(doc: Doc, name: string): Path | null {
  const collect = (layers: Layer[], matrix: Transform, acc: Subpath[]) => {
    for (const l of layers) for (const it of l.items) {
      if (isGroup(it)) collect(it.layers, compose(matrix, it.transform), acc)
      else if (isRegion(it)) acc.push(...transformPath(it.path, matrix).subpaths)
    }
  }
  let result: Path | null = null
  const walk = (layers: Layer[], matrix: Transform) => {
    for (const l of layers) for (const it of l.items) {
      if (result) return
      if (isGroup(it) && it.name === name) { const acc: Subpath[] = []; collect(it.layers, compose(matrix, it.transform), acc); result = { subpaths: acc }; return }
      if (isGroup(it)) walk(it.layers, compose(matrix, it.transform))
    }
  }
  walk(doc.layers, IDENTITY)
  return result
}

/** Does the world point fall inside the container (recursive)? */
export function pointInContainer(
  doc: Doc,
  container: Group | Instance,
  worldPt: Point,
  seen: Set<string> = new Set(),
): boolean {
  const next = isInstance(container) ? new Set([...seen, container.symbolId]) : seen
  const local = apply(invert(container.transform), worldPt)
  for (const layer of containerLayers(doc, container)) {
    if (!layer.visible) continue
    for (const it of layer.items) {
      if (isContainer(it)) {
        if (isInstance(it) && next.has(it.symbolId)) continue // cycle guard
        if (pointInContainer(doc, it, local, next)) return true
      } else if (isText(it)) {
        if (pointInBoxLocal(it.transform, it.box.w, it.box.h, local)) return true
      } else if (isImage(it)) {
        if (pointInBoxLocal(it.transform, it.w, it.h, local)) return true
      } else if (pointInRegion(it, local)) {
        return true
      }
    }
  }
  return false
}

/** Topmost item under the point, in a list of items. */
export function hitItem(doc: Doc, items: Item[], pt: Point): Item | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (isContainer(it)) {
      if (pointInContainer(doc, it, pt)) return it
    } else if (isText(it)) {
      if (pointInBoxLocal(it.transform, it.box.w, it.box.h, pt)) return it
    } else if (isImage(it)) {
      if (pointInBoxLocal(it.transform, it.w, it.h, pt)) return it
    } else if (pointInRegion(it, pt)) {
      return it
    }
  }
  return null
}

/** Point (parent space) in a local box [0,0]–[w,h] (text / image). */
function pointInBoxLocal(transform: Transform, w: number, h: number, pt: Point): boolean {
  const p = apply(invert(transform), pt)
  return p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h
}

/** Topmost item across the visible & unlocked layers. */
export function hitContext(doc: Doc, layers: Layer[], pt: Point): { item: Item; layerId: string } | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]
    if (!l.visible || l.locked) continue
    const it = hitItem(doc, l.items, pt)
    if (it) return { item: it, layerId: l.id }
  }
  return null
}

