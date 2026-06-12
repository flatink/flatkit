// -----------------------------------------------------------------------------
//  runtime/drawScene.ts -- PURE DRAWING CORE, shared by editor + player.
//
//  Draws a FlatInk document (layers -> items -> matter) at a given frame.
//  CEL MODEL: each layer resolves its content via `resolveLayerAt` (held matter
//  + present containers with their tweened pose) -- no more scope-wide override map nor
//  content map. Recursive (nested groups + symbols, local frame per instance),
//  with an anti-cycle guard. NO mutation of the document.
//
//  GOLDEN RULE: this module depends ONLY on pure modules (paint/smooth/layers/bbox/
//  cel/transform). It NEVER imports `polygon-clipping`, React, or the store
//  -> embeddable as-is in a lightweight standalone player.
// -----------------------------------------------------------------------------
import type { Doc, Group, Instance, Item, Layer, Region, Text } from '@flatkit/types'
import { regionBBox, type BBox } from '@flatkit/engine/bbox'
import { regionPaint, type Paint, type Tint } from '@flatkit/engine/paint'
import { cssFilterString, type Filter } from '@flatkit/engine/filters'
import { containerLayers, getSymbol, hiddenLayerIds, isContainer, isGroup, isInstance, isText, isImage, isRegion, maskMap, guideMap } from '@flatkit/engine/layers'
import { pathToBezier, transformPath, type Path } from '@flatkit/engine/path'
import { resolveInstanceFrame, type BaseOf } from '@flatkit/engine/timeline'
import { resolveLayerAt } from '@flatkit/engine/cel'
import type { ExprContext } from '@flatkit/engine/expr'
import { apply, compose, IDENTITY, type Transform } from '@flatkit/engine/transform'

/**
 * Render context for a scope: fps (for `time` expressions) + expression context.
 * `freezeNested` (EDITOR): we only animate the current scope; nested symbols are frozen
 * at their frame 0 (their position follows the scope's tween, but their internal timeline does not play).
 * The player leaves `freezeNested` absent -> full, composed animation.
 */
export type RenderCtx = {
  fps: number
  expr?: ExprContext
  freezeNested?: boolean
  image?: (assetId: string) => CanvasImageSource | null
  // PLAYER: per-object interaction state for `self.hovered`/`self.grabbed`/`self.pressed` in channel exprs.
  itemState?: (id: string) => { hovered: number; grabbed: number; pressed: number } | undefined
  // EDITOR: preview of a transform/move applied IN PLACE (z-index preserved) to the items
  // whose id is in `ids` -- `m` (translation or affine) wraps their drawing.
  preview?: { ids: Set<string>; m: Transform }
  // PLAYER (perf): cache of the FILTERED composites of "render-static" subtrees (still scenery).
  // Absent (editor/preview) = no cache. `imageEpoch` moves on every decoded image -> invalidates the cache.
  filterCache?: Map<string, FilterCacheEntry>
  imageEpoch?: number
}

/** Entry of the filtered composite cache: FINAL bitmap (content+tint+filter) in screen px at (ox,oy).
 *  `canvas` absent = we have only RECORDED the signature (1 observation frame before baking) -- used
 *  to NOT bake an object that moves every frame (unstable signature => we would always stay in miss). */
export type FilterCacheEntry = { canvas?: HTMLCanvasElement; sig: string; ox: number; oy: number; ow: number; oh: number }
type CacheSlot = { map: Map<string, FilterCacheEntry>; id: string; sig: string }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Current scale of the context (doc px -> screen px) -- to scale filters with the zoom. */
const scaleOf = (ctx: CanvasRenderingContext2D): number => { const m = ctx.getTransform(); return Math.hypot(m.a, m.b) || 1 }

export function applyTransform(ctx: CanvasRenderingContext2D, t: Transform) {
  ctx.transform(t.a, t.b, t.c, t.d, t.e, t.f)
}

/**
 * BASE pose resolver for expressions (and the editor display): finds an
 * item (recursive into groups, not instances = distinct scope) -> transform/opacity.
 * Kept for the editor (overlay/InfoPanel) as long as the old model coexists.
 */
export function baseResolver(layers: Layer[]): BaseOf {
  return (id) => {
    let found: { transform?: Transform; opacity?: number } | undefined
    const walk = (items: Item[]) => {
      for (const it of items) {
        if (found) return
        if (it.id === id) {
          found = { transform: isContainer(it) ? it.transform : undefined, opacity: it.opacity }
          return
        }
        if (isGroup(it)) for (const l of it.layers) walk(l.items)
      }
    }
    for (const l of layers) walk(l.items)
    return found
  }
}

// -- Off-screen canvas pool (tint/filters) -----------------------------------
// Isolating a tint or filters requires an off-screen canvas. We size it to the object's BOX
// (+ filter margin), NOT to the full screen: a 200x200 object should not blur a
// 2400x1600 canvas (cost ~100x; causes framerate drops on scenes with glows).
// The pool REUSES canvases (stacked by recursion depth); sizes are
// rounded up to a multiple (BUCKET) to stabilize reuse and avoid re-allocations.
// `acquire`/`release` stay balanced (try/finally) so that `scratchTop` returns to 0.
const scratchPool: HTMLCanvasElement[] = []
let scratchTop = 0
const SCRATCH_BUCKET = 256
type Scratch = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }
function acquireScratch(w: number, h: number, maxW: number, maxH: number): Scratch | null {
  if (typeof document === 'undefined') return null
  const bw = Math.min(maxW, Math.max(SCRATCH_BUCKET, Math.ceil(w / SCRATCH_BUCKET) * SCRATCH_BUCKET))
  const bh = Math.min(maxH, Math.max(SCRATCH_BUCKET, Math.ceil(h / SCRATCH_BUCKET) * SCRATCH_BUCKET))
  let canvas = scratchPool[scratchTop]
  if (!canvas) { canvas = document.createElement('canvas'); scratchPool[scratchTop] = canvas }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw // resizing resets all the context state + clears
    canvas.height = bh
  } else {
    // Reused as-is -> we reset the state (comp/alpha/filter from a previous use) + clear.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.filter = 'none'
    ctx.clearRect(0, 0, bw, bh)
  }
  scratchTop++
  return { canvas, ctx }
}
function releaseScratch() { if (scratchTop > 0) scratchTop-- }

// Margin (SCREEN px) by which the filters spill outside the object's box -> we enlarge the
// off-screen area by that much so we do not truncate blur/shadow/glow. `scale` = doc px -> screen px.
function filterSpreadPx(filters: Filter[] | undefined, scale: number): number {
  if (!filters || filters.length === 0) return 0
  let m = 0
  for (const f of filters) {
    if (f.type === 'blur') m += Math.max(0, f.radius) * 3
    else if (f.type === 'glow') m += Math.max(0, f.blur) * 2
    else if (f.type === 'shadow') m += Math.abs(f.dx) + Math.abs(f.dy) + Math.max(0, f.blur) * 2
  }
  return m * scale
}

// Expands `acc` (screen box) by the 4 corners of a LOCAL rectangle transformed by `m`.
function expandRect(acc: BBox, m: Transform, x0: number, y0: number, x1: number, y1: number): void {
  const pts = [apply(m, { x: x0, y: y0 }), apply(m, { x: x1, y: y0 }), apply(m, { x: x1, y: y1 }), apply(m, { x: x0, y: y1 })]
  for (const p of pts) {
    if (p.x < acc.minX) acc.minX = p.x
    if (p.y < acc.minY) acc.minY = p.y
    if (p.x > acc.maxX) acc.maxX = p.x
    if (p.y > acc.maxY) acc.maxY = p.y
  }
}

// SCREEN bounding box of the rendered content of `items` under the screen matrix `matrix` (recursive:
// containers/instances/symbols, like collectShape but numeric). Used to size the off-screen
// area of a filtered/tinted object.
function accumDevBBox(doc: Doc, items: Item[], frame: number, matrix: Transform, seen: Set<string>, acc: BBox, rctx: RenderCtx): void {
  for (const it of items) {
    if (it.hidden) continue
    if (isContainer(it)) {
      if (isInstance(it) && seen.has(it.symbolId)) continue
      const t = compose(matrix, it.transform)
      if (isInstance(it)) {
        const sym = getSymbol(doc, it.symbolId)
        const local = sym?.timeline ? resolveInstanceFrame(it.playback, frame, sym.timeline.durationFrames) : frame
        const sub: RenderCtx = { fps: subFps(sym?.timeline?.fps, rctx), expr: rctx.expr }
        const next = new Set([...seen, it.symbolId])
        for (const l of containerLayers(doc, it)) if (l.visible) accumDevBBox(doc, resolveLayerAt(l, local, { fps: sub.fps, ctx: sub.expr, parent: t }), local, t, next, acc, sub)
      } else if (isGroup(it) && it.timeline) {
        const sub: RenderCtx = { fps: subFps(it.timeline.fps, rctx), expr: rctx.expr }
        for (const l of it.layers) if (l.visible) accumDevBBox(doc, resolveLayerAt(l, frame, { fps: sub.fps, ctx: sub.expr, parent: t }), frame, t, seen, acc, sub)
      } else {
        for (const l of containerLayers(doc, it)) if (l.visible) accumDevBBox(doc, resolveLayerAt(l, frame, { fps: rctx.fps, ctx: rctx.expr, parent: t }), frame, t, seen, acc, rctx)
      }
    } else if (isText(it)) {
      expandRect(acc, compose(matrix, it.transform), 0, 0, it.box.w, it.box.h)
    } else if (isImage(it)) {
      expandRect(acc, compose(matrix, it.transform), 0, 0, it.w, it.h)
    } else {
      const b = regionBBox(it as Region)
      if (b) expandRect(acc, matrix, b.minX, b.minY, b.maxX, b.maxY)
    }
  }
}

const matOf = (m: DOMMatrix): Transform => ({ a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f })

// -- Render-staticness (for the filtered composite cache) --------------------
// A subtree is "render-static" if its APPEARANCE depends neither on the frame nor on expressions:
// no channel expression, no text `bind`, no animated timeline/cel. -> its filtered
// composition changes only with the screen transform (zoom/pan) or with an asset load, so it is cacheable.
const staticMemo = new WeakMap<object, boolean>()
const hasExpr = (it: Item): boolean => 'expressions' in it && !!it.expressions && Object.keys(it.expressions).length > 0
function layersStatic(doc: Doc, layers: Layer[], seen: Set<string>): boolean {
  for (const l of layers) {
    if (l.cels && l.cels.length) return false // animated layer (keyframes)
    for (const it of l.items) if (!isRenderStatic(doc, it, seen)) return false
  }
  return true
}
export function isRenderStatic(doc: Doc, it: Item, seen: Set<string> = new Set()): boolean {
  const memo = staticMemo.get(it)
  if (memo !== undefined) return memo // structural result (stable as long as the doc does not change)
  if ((isText(it) && it.bind) || hasExpr(it)) { staticMemo.set(it, false); return false }
  let result = true
  if (isInstance(it)) {
    if (seen.has(it.symbolId)) return true // cycle: DO NOT memoize (depends on `seen`)
    result = getSymbol(doc, it.symbolId)?.timeline ? false : layersStatic(doc, containerLayers(doc, it), new Set([...seen, it.symbolId]))
  } else if (isGroup(it)) {
    result = it.timeline ? false : layersStatic(doc, it.layers, seen)
  }
  // leaf regions/images without an expression -> static (result stays true)
  staticMemo.set(it, result)
  return result
}

/** Cache slot for a filtered container, iff the player provides `filterCache` AND the subtree is
 *  static. Signature = screen transform + tint + filter + image epoch (busted on asset load). */
function filterCacheSlot(rctx: RenderCtx, doc: Doc, it: Item, ctx: CanvasRenderingContext2D, tint: Tint | null, filterStr: string): CacheSlot | undefined {
  if (!rctx.filterCache || typeof document === 'undefined' || !isRenderStatic(doc, it)) return undefined
  const m = ctx.getTransform()
  const r = (n: number) => Math.round(n * 100) / 100
  const sig = `${r(m.a)},${r(m.b)},${r(m.c)},${r(m.d)},${r(m.e)},${r(m.f)}|${tint ? `${tint.color}:${tint.amount}` : ''}|${filterStr}|${rctx.imageEpoch ?? 0}`
  return { map: rctx.filterCache, id: it.id, sig }
}

/**
 * Composes isolated content (tint + filters) while limiting the off-screen area to the object's BOX
 * (+ filter margin) instead of the full screen. `devBBox` = screen box of the object; `null` or too
 * large -> full-screen fallback. `draw(octx)` paints the content (the brush sets its own transform).
 */
export function compositeFiltered(
  ctx: CanvasRenderingContext2D,
  opacity: number,
  tint: Tint | null,
  filters: Filter[] | undefined,
  scale: number,
  devBBox: BBox | null,
  draw: (octx: CanvasRenderingContext2D) => void,
  cache?: CacheSlot,
): void {
  // Cache HIT: the subtree is static and its transform/tint/filter have not changed -> we
  // reblit the final bitmap (no redraw, no refiltering). This is THE "paper theatre" win.
  const prev = cache ? cache.map.get(cache.id) : undefined
  if (prev && prev.canvas && prev.sig === cache!.sig) {
    // HIT: baked bitmap and unchanged signature -> reblit (no redraw/refiltering). THE "paper theatre" win.
    ctx.save()
    ctx.globalAlpha *= opacity
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(prev.canvas, 0, 0, prev.ow, prev.oh, prev.ox, prev.oy, prev.ow, prev.oh)
    ctx.restore()
    return
  }
  // We only BAKE if the signature was ALREADY the one from the previous frame (stable object) -- otherwise an
  // object moved every frame would pay a useless bake on every miss.
  const stable = !!(prev && prev.sig === cache!.sig)
  const filterStr = cssFilterString(filters, scale)
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  let ox = 0, oy = 0, ow = cw, oh = ch
  if (devBBox && devBBox.minX <= devBBox.maxX) {
    const m = filterSpreadPx(filters, scale)
    ox = Math.max(0, Math.floor(devBBox.minX - m))
    oy = Math.max(0, Math.floor(devBBox.minY - m))
    ow = Math.max(1, Math.min(cw, Math.ceil(devBBox.maxX + m)) - ox)
    oh = Math.max(1, Math.min(ch, Math.ceil(devBBox.maxY + m)) - oy)
    if (ow >= cw && oh >= ch) { ox = 0; oy = 0; ow = cw; oh = ch } // full-screen object -> no gain
  }
  const scratch = acquireScratch(ow, oh, cw, ch)
  if (!scratch) { // no DOM (tests) -> direct fallback without isolation
    ctx.save(); ctx.globalAlpha *= opacity; draw(ctx); ctx.restore(); return
  }
  const octx = scratch.ctx
  try {
    const dev = ctx.getTransform()
    octx.setTransform(dev.a, dev.b, dev.c, dev.d, dev.e - ox, dev.f - oy) // off-screen origin = (ox,oy) screen
    draw(octx)
    if (tint) {
      octx.setTransform(1, 0, 0, 1, 0, 0)
      octx.globalCompositeOperation = 'source-atop'
      octx.globalAlpha = clamp01(tint.amount)
      octx.fillStyle = tint.color
      octx.fillRect(0, 0, ow, oh)
    }
    // MISS. STABLE object (same signature as the previous frame) -> we bake the filtered result into
    // a persistent canvas and blit it flat; the following frames will HIT.
    const store = cache && stable && typeof document !== 'undefined' ? ensureCacheCanvas(cache, ox, oy, ow, oh) : null
    const cctx = store ? store.canvas!.getContext('2d') : null
    if (store && cctx) {
      cctx.setTransform(1, 0, 0, 1, 0, 0)
      cctx.globalAlpha = 1; cctx.globalCompositeOperation = 'source-over'
      cctx.filter = filterStr || 'none'
      cctx.clearRect(0, 0, store.canvas!.width, store.canvas!.height)
      cctx.drawImage(scratch.canvas, 0, 0, ow, oh, 0, 0, ow, oh)
      store.sig = cache!.sig; store.ox = ox; store.oy = oy; store.ow = ow; store.oh = oh
      ctx.save()
      ctx.globalAlpha *= opacity
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(store.canvas!, 0, 0, ow, oh, ox, oy, ow, oh)
      ctx.restore()
    } else {
      // 1st observation OR volatile object: we RECORD the signature (without baking) and blit filtered directly.
      if (cache) cache.map.set(cache.id, { sig: cache.sig, ox, oy, ow, oh })
      ctx.save()
      ctx.globalAlpha *= opacity
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      if (filterStr) ctx.filter = filterStr
      ctx.drawImage(scratch.canvas, 0, 0, ow, oh, ox, oy, ow, oh)
      ctx.restore()
    }
  } finally {
    releaseScratch()
  }
}

/** Entry WITH a persistent canvas (>= ow x oh) to store a filtered composite; (re)allocates if needed. */
function ensureCacheCanvas(cache: CacheSlot, ox: number, oy: number, ow: number, oh: number): FilterCacheEntry & { canvas: HTMLCanvasElement } {
  const e = cache.map.get(cache.id)
  if (e?.canvas && e.canvas.width >= ow && e.canvas.height >= oh) return e as FilterCacheEntry & { canvas: HTMLCanvasElement }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, ow); canvas.height = Math.max(1, oh)
  const fresh = { canvas, sig: '', ox, oy, ow, oh }
  cache.map.set(cache.id, fresh)
  return fresh
}

/**
 * Clipping by ALPHA (and not by vector path): for masks whose matter contains
 * TEXT or IMAGES (`ctx.clip` cannot clip them). We paint the content off-screen, then we
 * apply the matter in `destination-in` (= we keep the content ONLY where the matter is opaque),
 * and recompose. The area is bounded to the SCREEN box of the matter (the rest is masked anyway).
 * `draw*` set their own transform; no DOM (tests) -> fallback without mask.
 */
function compositeMasked(
  ctx: CanvasRenderingContext2D,
  opacity: number,
  devBBox: BBox | null,
  blit: GlobalCompositeOperation,
  drawContent: (octx: CanvasRenderingContext2D) => void,
  drawMatter: (octx: CanvasRenderingContext2D) => void,
): void {
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  let ox = 0, oy = 0, ow = cw, oh = ch
  if (devBBox && devBBox.minX <= devBBox.maxX) {
    ox = Math.max(0, Math.floor(devBBox.minX))
    oy = Math.max(0, Math.floor(devBBox.minY))
    ow = Math.max(1, Math.min(cw, Math.ceil(devBBox.maxX)) - ox)
    oh = Math.max(1, Math.min(ch, Math.ceil(devBBox.maxY)) - oy)
    if (ow >= cw && oh >= ch) { ox = 0; oy = 0; ow = cw; oh = ch }
  }
  const scratch = acquireScratch(ow, oh, cw, ch)
  if (!scratch) { ctx.save(); ctx.globalAlpha *= opacity; drawContent(ctx); ctx.restore(); return }
  const octx = scratch.ctx
  try {
    const dev = ctx.getTransform()
    octx.setTransform(dev.a, dev.b, dev.c, dev.d, dev.e - ox, dev.f - oy) // off-screen origin = (ox,oy) screen
    drawContent(octx)
    octx.setTransform(dev.a, dev.b, dev.c, dev.d, dev.e - ox, dev.f - oy)
    octx.globalCompositeOperation = 'destination-in' // keep the content only under the matter's alpha
    drawMatter(octx)
    octx.globalCompositeOperation = 'source-over'
    ctx.save()
    ctx.globalAlpha *= opacity
    ctx.globalCompositeOperation = blit // additive content (glow) -> we ADD the clipped result
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(scratch.canvas, 0, 0, ow, oh, ox, oy, ow, oh)
    ctx.restore()
  } finally {
    releaseScratch()
  }
}

/** Does a mask's matter contain text/an image? (-> alpha clipping rather than vector). */
export function itemsHaveGlyph(doc: Doc, items: Item[], seen: Set<string> = new Set()): boolean {
  for (const it of items) {
    if (it.hidden) continue
    if (isText(it) || isImage(it)) return true
    if (isContainer(it)) {
      if (isInstance(it) && seen.has(it.symbolId)) continue
      const next = isInstance(it) ? new Set([...seen, it.symbolId]) : seen
      for (const l of containerLayers(doc, it)) if (l.visible && itemsHaveGlyph(doc, resolveLayerAt(l, 0, {}), next)) return true
    }
  }
  return false
}

/** fps of a container's sub-scope (its own timeline, or inherited). */
const subFps = (tlFps: number | undefined, parent: RenderCtx): number => tlFps ?? parent.fps

// Stack-overflow guard: an untrusted .flatpack may nest groups infinitely (instances
// are already protected by `seen`, groups are not). Well beyond any real rig.
const MAX_NEST = 256

/**
 * Draws the content of a container (already posed by the parent layer):
 *  - library instance = new scope (local frame via resolveInstanceFrame);
 *  - local symbol (group WITH a timeline) = new scope synced on the parent frame;
 *  - group without a timeline (legacy) = same scope as the parent.
 */
function renderContainerChildren(
  ctx: CanvasRenderingContext2D,
  doc: Doc,
  it: Group | Instance,
  frame: number,
  hidden: Set<string> | null,
  seen: Set<string>,
  rctx: RenderCtx,
  parent: Transform = IDENTITY, // = WORLD space of this container (the children live inside it)
  depth = 0,
) {
  if (isInstance(it)) {
    const sym = getSymbol(doc, it.symbolId)
    // EDITOR (freezeNested): sub-scope frozen at 0; otherwise local frame (full animation, player).
    const local = rctx.freezeNested ? 0 : sym?.timeline ? resolveInstanceFrame(it.playback, frame, sym.timeline.durationFrames) : frame
    renderLayers(ctx, doc, containerLayers(doc, it), local, hidden, seen, { fps: subFps(sym?.timeline?.fps, rctx), expr: rctx.expr, freezeNested: rctx.freezeNested, image: rctx.image, filterCache: rctx.filterCache, imageEpoch: rctx.imageEpoch, itemState: rctx.itemState }, parent, depth + 1)
  } else if (isGroup(it) && it.timeline) {
    renderLayers(ctx, doc, it.layers, rctx.freezeNested ? 0 : frame, hidden, seen, { fps: subFps(it.timeline.fps, rctx), expr: rctx.expr, freezeNested: rctx.freezeNested, image: rctx.image, filterCache: rctx.filterCache, imageEpoch: rctx.imageEpoch, itemState: rctx.itemState }, parent, depth + 1)
  } else {
    // Group without a timeline = same scope as the parent (not a sub-scope) -> follows the scope's frame.
    renderLayers(ctx, doc, containerLayers(doc, it), frame, hidden, seen, rctx, parent, depth + 1)
  }
}

/**
 * Bezier path of a region (outline + holes), shiftable. Hybrid model: the
 * subpaths without handles are smoothed (Catmull-Rom, matter look), those with handles
 * render their literal cubic (see engine/path.ts).
 */
export function regionPath(region: Region, dx = 0, dy = 0): Path2D {
  const path = new Path2D()
  for (const sub of region.path.subpaths) {
    const bz = pathToBezier(sub)
    if (!bz) continue
    path.moveTo(bz.start.x + dx, bz.start.y + dy)
    for (const s of bz.segs) path.bezierCurveTo(s.c1.x + dx, s.c1.y + dy, s.c2.x + dx, s.c2.y + dy, s.p.x + dx, s.p.y + dy)
    if (sub.closed) path.closePath()
  }
  return path
}

/** Recursive collection of the shapes (regions) of ALREADY RESOLVED items into `path`, with transforms. */
function collectShape(
  doc: Doc,
  items: Item[],
  frame: number,
  matrix: Transform,
  seen: Set<string>,
  path: Path2D,
  rctx: RenderCtx,
) {
  for (const it of items) {
    if (it.hidden) continue
    if (isContainer(it)) {
      if (isInstance(it) && seen.has(it.symbolId)) continue
      const t = compose(matrix, it.transform)
      if (isInstance(it)) {
        const sym = getSymbol(doc, it.symbolId)
        const local = sym?.timeline ? resolveInstanceFrame(it.playback, frame, sym.timeline.durationFrames) : frame
        const sub: RenderCtx = { fps: subFps(sym?.timeline?.fps, rctx), expr: rctx.expr }
        const next = new Set([...seen, it.symbolId])
        for (const l of containerLayers(doc, it)) if (l.visible) collectShape(doc, resolveLayerAt(l, local, { fps: sub.fps, ctx: sub.expr, parent: t }), local, t, next, path, sub)
      } else if (isGroup(it) && it.timeline) {
        const sub: RenderCtx = { fps: subFps(it.timeline.fps, rctx), expr: rctx.expr }
        for (const l of it.layers) if (l.visible) collectShape(doc, resolveLayerAt(l, frame, { fps: sub.fps, ctx: sub.expr, parent: t }), frame, t, seen, path, sub)
      } else {
        for (const l of containerLayers(doc, it)) if (l.visible) collectShape(doc, resolveLayerAt(l, frame, { fps: rctx.fps, ctx: rctx.expr, parent: t }), frame, t, seen, path, rctx)
      }
    } else {
      path.addPath(regionPath(it as Region), new DOMMatrix([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]))
    }
  }
}

/** Path of a guide layer = subpaths of its resolved matter (baked xform), or null if empty. */
export function guidePathOf(guide: Layer, frame: number, rctx: RenderCtx): Path | null {
  const items = resolveLayerAt(guide, frame, { fps: rctx.fps, ctx: rctx.expr })
  const subpaths = []
  for (const it of items) {
    if (!isRegion(it)) continue
    const path = it.xform ? transformPath(it.path, it.xform) : it.path
    subpaths.push(...path.subpaths)
  }
  return subpaths.length ? { subpaths } : null
}

/** Clip path of a mask layer = union of its resolved matter (regions, containers). */
export function maskClipPath(doc: Doc, mask: Layer, frame: number, rctx: RenderCtx): Path2D {
  const path = new Path2D()
  collectShape(doc, resolveLayerAt(mask, frame, { fps: rctx.fps, ctx: rctx.expr }), frame, IDENTITY, new Set(), path, rctx)
  return path
}

/** Canvas style of a paint (solid or gradient), anchored to `bbox`. Reused for fill AND stroke. */
function paintStyle(ctx: CanvasRenderingContext2D, paint: Paint, bbox: ReturnType<typeof regionBBox>, fallback: string): string | CanvasGradient {
  if (paint.type === 'solid') return paint.color
  const b = paint.box ?? bbox
  if (!b) return fallback
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  let g: CanvasGradient
  if (paint.type === 'linear') {
    const cx = (b.minX + b.maxX) / 2
    const cy = (b.minY + b.maxY) / 2
    const a = (paint.angle * Math.PI) / 180
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const half = (Math.abs(w * ux) + Math.abs(h * uy)) / 2
    g = ctx.createLinearGradient(cx - ux * half, cy - uy * half, cx + ux * half, cy + uy * half)
  } else {
    const cx = b.minX + paint.cx * w
    const cy = b.minY + paint.cy * h
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(0.0001, paint.r * Math.max(w, h)))
  }
  for (const s of paint.stops) g.addColorStop(clamp01(s.offset), s.color)
  return g
}

function fillStyleFor(ctx: CanvasRenderingContext2D, region: Region): string | CanvasGradient {
  return paintStyle(ctx, regionPaint(region), regionBBox(region), region.color)
}

/** Draws a list of ALREADY RESOLVED items (poses applied) at a frame. */
export function renderItems(
  ctx: CanvasRenderingContext2D,
  doc: Doc,
  items: Item[],
  frame: number,
  hidden: Set<string> | null,
  seen: Set<string>,
  rctx: RenderCtx,
  parent: Transform = IDENTITY,
  depth = 0,
) {
  for (const it of items) {
    if (hidden?.has(it.id)) continue
    if (it.hidden) continue // hidden in the outliner
    const opacity = it.opacity ?? 1
    if (opacity <= 0) continue
    // Blend mode (add/screen = additive light, multiply = shadow). Saved/restored around the item.
    const blend = 'blend' in it ? it.blend : undefined
    const op = blend === 'add' ? 'lighter' : blend === 'screen' ? 'screen' : blend === 'multiply' ? 'multiply' : null
    if (op) { ctx.save(); ctx.globalCompositeOperation = op }
    // Edit preview (drag): we wrap the item's drawing WITHIN the layer order -> z-index preserved.
    const pm = rctx.preview?.ids.has(it.id) ? rctx.preview.m : null
    if (pm) ctx.save()
    if (pm) applyTransform(ctx, pm)
    renderOneItem(ctx, doc, it, frame, hidden, seen, rctx, opacity, parent, depth)
    if (pm) ctx.restore()
    if (op) ctx.restore()
  }
}

/** Draws ONE resolved item (without the masking/preview logic, handled by the caller). */
function renderOneItem(
  ctx: CanvasRenderingContext2D,
  doc: Doc,
  it: Item,
  frame: number,
  hidden: Set<string> | null,
  seen: Set<string>,
  rctx: RenderCtx,
  opacity: number,
  parent: Transform = IDENTITY,
  depth = 0,
) {
  {
    if (isContainer(it)) {
      if (isInstance(it) && seen.has(it.symbolId)) return // anti-cycle guard
      const next = isInstance(it) ? new Set([...seen, it.symbolId]) : seen
      const ctm = it.transform
      const childParent = compose(parent, ctm) // WORLD space of the container's children
      const tint = it.tint && it.tint.amount > 0.001 ? it.tint : null
      const scale = scaleOf(ctx)
      const filterStr = cssFilterString(it.filters, scale)
      // Tint AND/OR filters -> isolate the content off-screen (area = object's box) then recompose.
      if (tint || filterStr) {
        const acc: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        accumDevBBox(doc, [it], frame, matOf(ctx.getTransform()), seen, acc, rctx)
        const devBBox = acc.minX <= acc.maxX ? acc : null
        // Cache (player): static subtree -> we record the filtered composite and reblit it.
        const cache = filterCacheSlot(rctx, doc, it, ctx, tint, filterStr)
        compositeFiltered(ctx, opacity, tint, it.filters, scale, devBBox, (octx) => {
          applyTransform(octx, ctm)
          renderContainerChildren(octx, doc, it, frame, hidden, next, rctx, childParent, depth)
        }, cache)
      } else {
        ctx.save()
        ctx.globalAlpha *= opacity
        applyTransform(ctx, ctm)
        renderContainerChildren(ctx, doc, it, frame, hidden, next, rctx, childParent, depth)
        ctx.restore()
      }
    } else if (isText(it)) {
      const acc: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
      expandRect(acc, compose(matOf(ctx.getTransform()), it.transform), 0, 0, it.box.w, it.box.h)
      paintLeaf(ctx, it.tint, it.filters, opacity, acc, scaleOf(ctx), (c) => paintText(c, it))
    } else if (isImage(it)) {
      const src = rctx.image?.(it.assetId) ?? null
      const acc: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
      expandRect(acc, compose(matOf(ctx.getTransform()), it.transform), 0, 0, it.w, it.h)
      paintLeaf(ctx, it.tint, it.filters, opacity, acc, scaleOf(ctx), (c) => paintImage(c, it, src))
    } else {
      // Region: fill (unless noFill) + optional outline (stroke), same Bezier path.
      const reg = it as Region
      if (reg.filters?.length) {
        // RARE case: filters on a path -> we isolate off-screen then recompose (closure tolerated here).
        const lb = regionBBox(reg)
        const acc: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        if (lb) expandRect(acc, matOf(ctx.getTransform()), lb.minX, lb.minY, lb.maxX, lb.maxY)
        paintLeaf(ctx, undefined, reg.filters, opacity, acc, scaleOf(ctx), (c) => paintRegion(c, reg))
      } else {
        // HOT path (the majority of regions): no allocation (no closure).
        ctx.save()
        if (opacity < 1) ctx.globalAlpha *= opacity
        paintRegion(ctx, reg)
        ctx.restore()
      }
    }
  }
}

/** Paints a region (fill + outline) into `c`. Module function (zero allocation per call). */
function paintRegion(c: CanvasRenderingContext2D, reg: Region) {
  const path = regionPath(reg)
  if (!reg.noFill) {
    c.fillStyle = fillStyleFor(c, reg)
    c.fill(path, 'evenodd')
  }
  if (reg.stroke) {
    const s = reg.stroke
    c.lineWidth = s.width
    c.lineCap = s.cap ?? 'round'
    c.lineJoin = s.join ?? 'round'
    if (s.miterLimit != null) c.miterLimit = s.miterLimit
    c.setLineDash(s.dash ?? [])
    c.strokeStyle = paintStyle(c, s.paint, regionBBox(reg), reg.color)
    c.stroke(path)
  }
}

/** CSS font of a text (reused by the editor to measure). */
export const textFont = (t: Text): string => `${t.italic ? 'italic ' : ''}${t.weight ?? 400} ${t.size}px ${t.font}`

/** Paints a "live" text at full opacity (local origin = top-left corner, lines aligned within `box`). */
function paintText(ctx: CanvasRenderingContext2D, t: Text) {
  ctx.save()
  applyTransform(ctx, t.transform)
  ctx.fillStyle = t.color
  ctx.textBaseline = 'top'
  ctx.font = textFont(t)
  ctx.textAlign = t.align
  const x = t.align === 'left' ? 0 : t.align === 'right' ? t.box.w : t.box.w / 2
  const lh = t.size * t.lineHeight
  const lines = t.wrap && t.box.w > 0 ? wrapLines(ctx, t.content, t.box.w) : t.content.split('\n')
  const s = t.stroke
  if (s) {
    // strokeText centers the stroke on the glyph outline; drawing it BEFORE the fill keeps the
    // visible fill at full weight (only the outer half of the stroke shows). bbox = local text box.
    ctx.lineWidth = s.width
    ctx.lineCap = s.cap ?? 'round'
    ctx.lineJoin = s.join ?? 'round'
    if (s.miterLimit != null) ctx.miterLimit = s.miterLimit
    ctx.setLineDash(s.dash ?? [])
    ctx.strokeStyle = paintStyle(ctx, s.paint, { minX: 0, minY: 0, maxX: t.box.w, maxY: t.box.h }, t.color)
  }
  for (let i = 0; i < lines.length; i++) {
    const y = i * lh
    if (s) ctx.strokeText(lines[i], x, y)
    ctx.fillText(lines[i], x, y)
  }
  ctx.restore()
}

/** Greedy word-wrap within `maxW` (local px). Respects explicit `\n`; breaks at spaces. */
export function wrapLines(ctx: Pick<CanvasRenderingContext2D, 'measureText'>, content: string, maxW: number): string[] {
  const out: string[] = []
  for (const para of content.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (words.length === 0) { out.push(''); continue }
    let line = words[0]
    for (let i = 1; i < words.length; i++) {
      const test = line + ' ' + words[i]
      if (ctx.measureText(test).width <= maxW) line = test
      else { out.push(line); line = words[i] }
    }
    out.push(line)
  }
  return out
}

/** Paints a bitmap image (gray placeholder while not yet decoded). */
function paintImage(ctx: CanvasRenderingContext2D, im: import('@flatkit/types').Image, src: CanvasImageSource | null) {
  ctx.save()
  applyTransform(ctx, im.transform)
  if (src) ctx.drawImage(src, 0, 0, im.w, im.h)
  else { ctx.fillStyle = 'rgba(127,131,140,0.18)'; ctx.fillRect(0, 0, im.w, im.h) }
  ctx.restore()
}

/** Paints a leaf (text/image) with opacity + tint (Flash) + filters (P4.2), off-screen if needed.
 *  `devBBox` = screen box of the leaf (to size the off-screen area to the object, not the full screen). */
function paintLeaf(ctx: CanvasRenderingContext2D, tint: Tint | undefined, filters: Filter[] | undefined, opacity: number, devBBox: BBox, scale: number, draw: (c: CanvasRenderingContext2D) => void) {
  const t = tint && tint.amount > 0.001 ? tint : null
  const filterStr = cssFilterString(filters, scale)
  if (!t && !filterStr) {
    ctx.save()
    if (opacity < 1) ctx.globalAlpha *= opacity
    draw(ctx)
    ctx.restore()
    return
  }
  compositeFiltered(ctx, opacity, t, filters, scale, devBBox.minX <= devBBox.maxX ? devBBox : null, draw)
}

/** Draws a stack of layers at a frame (each layer resolves its content via the cels). */
export function renderLayers(
  ctx: CanvasRenderingContext2D,
  doc: Doc,
  layers: Layer[],
  frame: number,
  hidden: Set<string> | null,
  seen: Set<string>,
  rctx: RenderCtx,
  parent: Transform = IDENTITY, // WORLD transform of the scope (for toLocal/toGlobal conversions in binding)
  depth = 0,
) {
  if (depth > MAX_NEST) return // untrusted doc: pathological nesting -> we stop
  const hid = hiddenLayerIds(layers) // layer hidden, or under a hidden folder/mask
  const masks = maskMap(layers) // child layer of a mask -> its mask
  const guides = guideMap(layers) // child layer of a guide layer -> its guide
  const clipCache = new Map<string, Path2D>() // one mask clips several children -> reuse
  const maskCache = new Map<string, { items: Item[]; glyph: boolean }>() // resolved matter + clip type
  const guideCache = new Map<string, Path | null>() // one guide drives several children -> reuse
  for (const layer of layers) {
    if (hid.has(layer.id)) continue
    if (layer.isMask) continue // the mask's shape is not painted (it only serves to clip)
    if (layer.isGuide) continue // the guide path is not painted (the editor shows it as an overlay)
    const a = ctx.globalAlpha
    ctx.globalAlpha = a * layer.opacity
    const guideLayer = guides.get(layer.id)
    let guidePath: Path | null | undefined
    if (guideLayer) {
      guidePath = guideCache.get(guideLayer.id)
      if (guidePath === undefined) { guidePath = guidePathOf(guideLayer, frame, rctx); guideCache.set(guideLayer.id, guidePath) }
    }
    const items = resolveLayerAt(layer, frame, { fps: rctx.fps, ctx: rctx.expr, guide: guidePath ?? undefined, orient: layer.orientToGuide, parent, itemState: rctx.itemState })
    const mask = masks.get(layer.id)
    if (mask) {
      let mi = maskCache.get(mask.id)
      if (!mi) {
        const mItems = resolveLayerAt(mask, frame, { fps: rctx.fps, ctx: rctx.expr })
        mi = { items: mItems, glyph: itemsHaveGlyph(doc, mItems, new Set()) }
        maskCache.set(mask.id, mi)
      }
      if (mi.glyph) {
        // TEXT/IMAGE matter -> alpha clipping (the content only appears within the silhouette).
        const acc: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        accumDevBBox(doc, mi.items, frame, matOf(ctx.getTransform()), seen, acc, rctx)
        const matter = mi.items
        // Additive content (blend add) -> we add the clipped result (a glow that passes through the silhouette).
        const blit: GlobalCompositeOperation = items.some((it) => 'blend' in it && it.blend === 'add') ? 'lighter' : 'source-over'
        compositeMasked(ctx, 1, acc.minX <= acc.maxX ? acc : null, blit,
          (octx) => renderItems(octx, doc, items, frame, hidden, seen, rctx, parent, depth),
          (octx) => renderItems(octx, doc, matter, frame, hidden, seen, rctx, parent, depth),
        )
      } else {
        // Vector matter (common case) -> fast clip, unchanged.
        let clip = clipCache.get(mask.id)
        if (!clip) { const p = new Path2D(); collectShape(doc, mi.items, frame, IDENTITY, new Set(), p, rctx); clip = p; clipCache.set(mask.id, clip) }
        ctx.save()
        ctx.clip(clip, 'evenodd')
        renderItems(ctx, doc, items, frame, hidden, seen, rctx, parent, depth)
        ctx.restore()
      }
    } else {
      renderItems(ctx, doc, items, frame, hidden, seen, rctx, parent, depth)
    }
    ctx.globalAlpha = a
  }
}
