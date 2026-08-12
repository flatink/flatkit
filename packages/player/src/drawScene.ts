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
import type { Doc, Group, Instance, Item, Layer, Region, SymbolDef, Text, ChannelModifier, ExprChannel } from '@flatkit/types'
import { regionBBox, type BBox } from '@flatkit/engine/bbox'
import { regionPaint, resolveStopColor, resolveTintColor, type Paint, type Tint } from '@flatkit/engine/paint'
import { cssFilterString, type Filter } from '@flatkit/engine/filters'
import { containerLayers, getSymbol, isContainer, isGroup, isInstance, isPoseable, isText, isImage, isRegion, layerStructure } from '@flatkit/engine/layers'
import { pathToBezier, transformPath, makePathSampler, pathBBox, trimPath, type Path } from '@flatkit/engine/path'
import { type BaseOf } from '@flatkit/engine/timeline'
import { resolveInstanceParams, instanceFrames } from '@flatkit/engine/params'
import { resolveLayerAt } from '@flatkit/engine/cel'
import type { ExprContext } from '@flatkit/engine/expr'
import { apply, compose, invert, IDENTITY, type Transform } from '@flatkit/engine/transform'

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
  // PLAYER: per-instance exposed param values (P3 states) → drive the instance's local frame + its subtree scope.
  paramsFor?: (instanceId: string) => Record<string, number> | undefined
  // The advancing playback CLOCK of this scope (frames). Equals the scope's frame in the ordinary case, but
  // DIVERGES once an ancestor symbol is state-pinned: the pin freezes the pose `frame`, while `clockFrame`
  // keeps flowing so NESTED timelines (sub-loops / idles) keep playing under a state (RFC). Absent at the
  // root → falls back to `frame`.
  clockFrame?: number
  // The runtime's MONOTONE heartbeat in SECONDS (`mono / fps`), set at the root and carried UNCHANGED down
  // every scope. It drives `independent`/`once` instances (Flash MovieClip clock): they rebase on this beat
  // (× their own fps) instead of the ancestor's wrapped frame, so a sub-loop is immune to a shorter parent.
  // Absent (editor freeze / static walk) → such instances fall back to synced (parent-driven) playback.
  monoTime?: number
  // Current instance's COLOR params (param name → hex) for `fill <param>` regions in its subtree.
  colorParams?: Record<string, string>
  // STATEFUL channel modifiers (smooth/spring): `statePath` is the composed ancestor-INSTANCE path of this
  // scope (empty at root; `gru1/` inside instance gru1) → the per-instance state key is `statePath+itemId`.
  // `channelValue` returns the PLAYER's integrated value for that key+channel (absent → snap to target).
  statePath?: string
  channelValue?: (key: string, ch: ExprChannel) => number | undefined
  // EDITOR: preview of a transform/move applied IN PLACE (z-index preserved) to the items
  // whose id is in `ids` -- `m` (translation or affine) wraps their drawing.
  preview?: { ids: Set<string>; m: Transform }
  // PLAYER (perf): cache of the FILTERED composites of "render-static" subtrees (still scenery).
  // Absent (editor/preview) = no cache. `imageEpoch` moves on every decoded image -> invalidates the cache.
  filterCache?: Map<string, FilterCacheEntry>
  imageEpoch?: number
  // PLAYER: `reveal … erase` — what the child has SCRATCHED AWAY, per target item id. The renderer rubs
  // those discs out of the item (see `compositeScratched`). Absent (the ordinary case, and every editor
  // path) = nothing to erase, and the whole branch is skipped.
  scratched?: Map<string, ScratchMask>
}

/** A `reveal` target's scratched-away area, in WORLD coordinates: the grid it ticks (`cells`, cleared cell
 *  indices — a LIVE set, mutated by the gesture) plus the geometry to place them. */
export type ScratchMask = { cells: ReadonlySet<number>; minX: number; minY: number; cell: number; cols: number }

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
/**
 * Warned ONCE per process when an effect had to be dropped for lack of an off-screen canvas.
 *
 * Without a `document`, isolation is impossible and the callers fall back to drawing the content
 * directly: the frame still renders, and every `filter` and `tint` on it is simply GONE. In a browser
 * that never happens; under Node it is the default, and it cost a consumer a debugging session that
 * ended in their source with the word INDISPENSABLE in capitals. `renderDocToPng` installs the shim —
 * anyone driving the player themselves needs to know they must too.
 */
let warnedNoScratch = false
function warnScratchless(what: string): void {
  if (warnedNoScratch || typeof console === 'undefined') return
  warnedNoScratch = true
  console.warn(
    `[flatkit] ${what} dropped: isolating one needs an off-screen canvas and there is no \`document\` here. ` +
    'The frame still draws, without the effect. Under Node, provide a shim before playing — ' +
    '`globalThis.document = { createElement: (t) => (t === "canvas" ? new Canvas(1, 1) : {}) }` — ' +
    'or use `renderDocToPng` / `createRenderer` from `@flatkit/compiler/render`, which do it for you.',
  )
}

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
        const { sym, expr } = instanceScope(doc, it, rctx)
        const childFps = subFps(sym?.timeline?.fps, rctx)
        const { pose, clock } = instanceFrames(sym, it, clockOf(frame, rctx), rctx.freezeNested, expr, monoFrameOf(childFps, rctx))
        const sub: RenderCtx = { fps: childFps, expr, clockFrame: clock, monoTime: rctx.monoTime }
        const next = new Set([...seen, it.symbolId])
        for (const l of containerLayers(doc, it)) if (l.visible) accumDevBBox(doc, resolveLayerAt(l, pose, { fps: sub.fps, ctx: sub.expr, parent: t }), pose, t, next, acc, sub)
      } else if (isGroup(it) && it.timeline) {
        const groupFrame = rctx.freezeNested ? 0 : clockOf(frame, rctx)
        const sub: RenderCtx = { fps: subFps(it.timeline.fps, rctx), expr: rctx.expr, clockFrame: groupFrame, monoTime: rctx.monoTime }
        for (const l of it.layers) if (l.visible) accumDevBBox(doc, resolveLayerAt(l, groupFrame, { fps: sub.fps, ctx: sub.expr, parent: t }), groupFrame, t, seen, acc, sub)
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
// no channel expression, no stateful modifier (smooth/spring), no text `bind`, no animated timeline/cel.
// -> its filtered composition changes only with the screen transform (zoom/pan) or with an asset load,
// so it is cacheable.
const staticMemo = new WeakMap<object, boolean>()
const hasExpr = (it: Item): boolean => 'expressions' in it && !!it.expressions && Object.keys(it.expressions).length > 0
// A stateful modifier (smooth/spring) integrates over time -> the item's pose changes frame-to-frame even
// with no expression. We have no per-frame signal for a CHILD's settled state in the cache signature, so any
// modifier in the subtree makes it non-static (the TOP item's own modifier is handled precisely: its pose
// is folded into the signature -- see `isContentStatic`/`filterCacheSlot`).
const hasMod = (it: Item): boolean => isPoseable(it) && !!it.modifiers && Object.keys(it.modifiers).length > 0
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
  if ((isText(it) && (it.bind || it.textPath?.startExpr || it.textPath?.spacingExpr)) || (isRegion(it) && (it.drawExpr || it.drawFromExpr)) || hasExpr(it) || hasMod(it)) { staticMemo.set(it, false); return false }
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

/** Like `isRenderStatic`, but IGNORES the item's OWN channel drivers (expressions AND stateful modifiers):
 *  they drive only its transform/opacity (both folded into the composite cache signature below, or applied
 *  at blit time), so they never make the baked CONTENT bitmap stale. The item's CONTENT subtree must still
 *  be static (a child's own expression/modifier DOES bust it, via `layersStatic`). This lets a tinted/
 *  filtered instance that merely moves/scales — e.g. `each`-bound bricks: same tint+content while alive —
 *  reuse its baked composite (whenever its pose holds still) instead of re-isolating off-screen every frame. */
const contentStaticMemo = new WeakMap<object, boolean>()
export function isContentStatic(doc: Doc, it: Item, seen: Set<string> = new Set()): boolean {
  const memo = contentStaticMemo.get(it)
  if (memo !== undefined) return memo
  let result: boolean
  if (isInstance(it)) {
    if (seen.has(it.symbolId)) return true // cycle: DO NOT memoize (depends on `seen`)
    result = getSymbol(doc, it.symbolId)?.timeline ? false : layersStatic(doc, containerLayers(doc, it), new Set([...seen, it.symbolId]))
  } else if (isGroup(it)) {
    result = it.timeline ? false : layersStatic(doc, it.layers, seen)
  } else {
    result = isRenderStatic(doc, it, seen) // leaf: no separate pose-vs-content -> fall back
  }
  contentStaticMemo.set(it, result)
  return result
}

/** Cache slot for a filtered/tinted container, iff the player provides `filterCache` AND the container's
 *  CONTENT is static. Signature = the content's full SCREEN placement (parent transform ∘ the item's own
 *  resolved pose) + tint + filter + image epoch. Folding the item's own pose in means an expression-driven
 *  move/scale busts the cache (correctness), while a momentarily-still posed item keeps HITting (the win).
 *  `opacity` is deliberately absent: `compositeFiltered` applies it at blit, so a pure fade reuses the bitmap. */
function filterCacheSlot(rctx: RenderCtx, doc: Doc, it: Item, ctx: CanvasRenderingContext2D, tint: Tint | null, filterStr: string): CacheSlot | undefined {
  if (!rctx.filterCache || typeof document === 'undefined' || !isContentStatic(doc, it)) return undefined
  const own = 'transform' in it && it.transform ? (it.transform as Transform) : IDENTITY
  const m = compose(matOf(ctx.getTransform()), own)
  const r = (n: number) => Math.round(n * 100) / 100
  const sig = `${r(m.a)},${r(m.b)},${r(m.c)},${r(m.d)},${r(m.e)},${r(m.f)}|${tint ? `${tint.color}:${tint.amount}` : ''}|${filterStr}|${rctx.imageEpoch ?? 0}`
  return { map: rctx.filterCache, id: it.id, sig }
}

/**
 * Composes isolated content (tint + filters) while limiting the off-screen area to the object's BOX
 * (+ filter margin) instead of the full screen. `devBBox` = screen box of the object; `null` or too
 * large -> full-screen fallback. `draw(octx)` paints the content (the brush sets its own transform).
 * `knownFilterStr`: the caller's already-computed `cssFilterString(filters, scale)` (every caller has it) ->
 * reused on the miss/bake path instead of recomputing it here.
 */
/** Off-screen buffer window for an object: its SCREEN box (+ `margin` for a filter's spread), clamped to the
 *  canvas. A box that ends up covering the whole canvas gains nothing → full screen. */
function bufferBox(devBBox: BBox | null, cw: number, ch: number, margin: number): { ox: number; oy: number; ow: number; oh: number } {
  if (!devBBox || devBBox.minX > devBBox.maxX) return { ox: 0, oy: 0, ow: cw, oh: ch }
  const ox = Math.max(0, Math.floor(devBBox.minX - margin))
  const oy = Math.max(0, Math.floor(devBBox.minY - margin))
  const ow = Math.max(1, Math.min(cw, Math.ceil(devBBox.maxX + margin)) - ox)
  const oh = Math.max(1, Math.min(ch, Math.ceil(devBBox.maxY + margin)) - oy)
  return ow >= cw && oh >= ch ? { ox: 0, oy: 0, ow: cw, oh: ch } : { ox, oy, ow, oh }
}

/** Reblit a baked composite at its screen position, with the item's current opacity applied at blit time
 *  (never baked in — a pure fade then reuses the bitmap). */
type Baked = FilterCacheEntry & { canvas: HTMLCanvasElement }
function blitBaked(ctx: CanvasRenderingContext2D, e: Baked, opacity: number): void {
  ctx.save()
  ctx.globalAlpha *= opacity
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(e.canvas, 0, 0, e.ow, e.oh, e.ox, e.oy, e.ow, e.oh)
  ctx.restore()
}

export function compositeFiltered(
  ctx: CanvasRenderingContext2D,
  opacity: number,
  tint: Tint | null,
  filters: Filter[] | undefined,
  scale: number,
  devBBox: BBox | null,
  draw: (octx: CanvasRenderingContext2D) => void,
  cache?: CacheSlot,
  knownFilterStr?: string,
): void {
  // Cache HIT: the subtree is static and its transform/tint/filter have not changed -> we
  // reblit the final bitmap (no redraw, no refiltering). This is THE "paper theatre" win.
  const prev = cache ? cache.map.get(cache.id) : undefined
  if (prev?.canvas && prev.sig === cache!.sig) { blitBaked(ctx, prev as Baked, opacity); return }
  // We only BAKE if the signature was ALREADY the one from the previous frame (stable object) -- otherwise an
  // object moved every frame would pay a useless bake on every miss.
  const stable = !!(prev && prev.sig === cache!.sig)
  const filterStr = knownFilterStr ?? cssFilterString(filters, scale)
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  const { ox, oy, ow, oh } = bufferBox(devBBox, cw, ch, filterSpreadPx(filters, scale))
  const scratch = acquireScratch(ow, oh, cw, ch)
  if (!scratch) { // no DOM -> direct fallback WITHOUT isolation: the filters/tint are lost, so say so
    warnScratchless(filters?.length ? 'filter' : 'tint')
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
      blitBaked(ctx, store, opacity)
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
  matterOp: GlobalCompositeOperation = 'destination-in', // KEEP under the matter; `destination-out` = RUB OUT under it (`reveal … erase`)
  what = 'mask', // named in the no-DOM warning
): void {
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  const { ox, oy, ow, oh } = bufferBox(devBBox, cw, ch, 0)
  const scratch = acquireScratch(ow, oh, cw, ch)
  if (!scratch) { warnScratchless(what); ctx.save(); ctx.globalAlpha *= opacity; drawContent(ctx); ctx.restore(); return }
  const octx = scratch.ctx
  try {
    const dev = ctx.getTransform()
    octx.setTransform(dev.a, dev.b, dev.c, dev.d, dev.e - ox, dev.f - oy) // off-screen origin = (ox,oy) screen
    drawContent(octx)
    octx.setTransform(dev.a, dev.b, dev.c, dev.d, dev.e - ox, dev.f - oy)
    octx.globalCompositeOperation = matterOp // 'destination-in' = keep only under the matter's alpha; 'destination-out' = rub it out
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

const TAU = Math.PI * 2

/**
 * `reveal … erase`: draw an item MINUS what the child has scratched away. The gesture already ticks a grid
 * of cells; here each cleared cell is rubbed out as a disc of radius `brush` around its centre — overlapping
 * discs simply union (`destination-out` accumulates alpha), which is the thing a `mask` layer cannot do
 * (its matter is an even-odd clip path, so two overlapping stamps CANCEL).
 *
 * The mask lives in WORLD coordinates while the context is in the item's PARENT space, so the punch runs
 * under `ctm ∘ parent⁻¹` — a veil nested in a transformed group is rubbed where the finger actually went,
 * and a scaled one gets scaled discs. Erasing is VISUAL only: the zone stays grabbable (that is what keeps
 * the scratching alive over the cleared area), exactly like `clip`.
 */
function compositeScratched(
  ctx: CanvasRenderingContext2D,
  opacity: number,
  devBBoxOf: () => BBox | null, // LAZY: a cache hit must not pay a bbox accumulation over the subtree
  mask: ScratchMask,
  parent: Transform,
  cache: CacheSlot | undefined,
  drawContent: (octx: CanvasRenderingContext2D) => void,
): void {
  // Nothing has changed since the last paint (same transform, same cells) → one blit. Without this, a veil
  // with a single cleared cell re-composited off-screen sixty times a second for the rest of the activity.
  const prev = cache ? cache.map.get(cache.id) : undefined
  if (prev?.canvas && prev.sig === cache!.sig) { blitBaked(ctx, prev as Baked, opacity); return }
  const stable = !!(prev && prev.sig === cache!.sig) // seen once already → worth baking now
  const cw = ctx.canvas.width
  const ch = ctx.canvas.height
  const { ox, oy, ow, oh } = bufferBox(devBBoxOf(), cw, ch, 0)
  const scratch = acquireScratch(ow, oh, cw, ch)
  if (!scratch) { warnScratchless('erase'); ctx.save(); ctx.globalAlpha *= opacity; drawContent(ctx); ctx.restore(); return }
  const octx = scratch.ctx
  try {
    const dev = ctx.getTransform()
    octx.setTransform(dev.a, dev.b, dev.c, dev.d, dev.e - ox, dev.f - oy) // off-screen origin = (ox,oy) screen
    drawContent(octx)
    const world = compose({ a: dev.a, b: dev.b, c: dev.c, d: dev.d, e: dev.e - ox, f: dev.f - oy }, invert(parent))
    octx.setTransform(world.a, world.b, world.c, world.d, world.e, world.f) // …the grid is measured in WORLD space
    octx.globalCompositeOperation = 'destination-out' // rub out — and, unlike an even-odd clip, overlaps UNION
    punchCells(octx, mask, Math.hypot(world.a, world.b) || 1)
    octx.globalCompositeOperation = 'source-over'
    octx.filter = 'none'
    const store = cache && stable && typeof document !== 'undefined' ? ensureCacheCanvas(cache, ox, oy, ow, oh) : null
    const cctx = store ? store.canvas.getContext('2d') : null
    if (store && cctx) { // bake the punched result, then blit it: the frames that follow are pure blits
      cctx.setTransform(1, 0, 0, 1, 0, 0)
      cctx.globalAlpha = 1; cctx.globalCompositeOperation = 'source-over'; cctx.filter = 'none'
      cctx.clearRect(0, 0, store.canvas.width, store.canvas.height)
      cctx.drawImage(scratch.canvas, 0, 0, ow, oh, 0, 0, ow, oh)
      store.sig = cache!.sig; store.ox = ox; store.oy = oy; store.ow = ow; store.oh = oh
      blitBaked(ctx, store, opacity)
    } else {
      if (cache) cache.map.set(cache.id, { sig: cache.sig, ox, oy, ow, oh }) // record the signature; bake next frame
      ctx.save()
      ctx.globalAlpha *= opacity
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(scratch.canvas, 0, 0, ow, oh, ox, oy, ow, oh)
      ctx.restore()
    }
  } finally {
    releaseScratch()
  }
}

/**
 * The holes themselves: one disc per CLEARED CELL, all in ONE path and ONE fill — a fully scratched
 * full-frame veil is ~1000 cells, and a fill apiece is what turns a scratch into a slideshow. The radius is
 * ¾ of a cell: over half a diagonal, so neighbours merge with no lattice gap, and no more, so what
 * disappears stays what the fraction counts.
 *
 * The edge is BLURRED rather than cut. Hard discs read as stamps — a lone touch left a perfect circle and
 * the border of a scratched area was a scallop at the mesh of the grid. The blur is a fraction of the CELL,
 * so `grain` sets how fine the erasing looks while `brush` keeps meaning how wide the finger is. (A canvas
 * that ignores `filter` — an old Safari — degrades to the crisp edge, like every other filter here.)
 */
function punchCells(octx: CanvasRenderingContext2D, mask: ScratchMask, scale: number): void {
  const r = mask.cell * 0.75
  const soft = Math.min(16, Math.max(0.5, mask.cell * 0.55 * scale)) // device px, and never a fog
  octx.filter = `blur(${round2(soft)}px)`
  octx.fillStyle = '#000' // any opaque colour: only its ALPHA is used by `destination-out`
  octx.beginPath()
  for (const idx of mask.cells) {
    const cx = mask.minX + ((idx % mask.cols) + 0.5) * mask.cell
    const cy = mask.minY + (Math.floor(idx / mask.cols) + 0.5) * mask.cell
    octx.moveTo(cx + r, cy) // start each subpath on its own circle (no connecting line between discs)
    octx.arc(cx, cy, r, 0, TAU)
  }
  octx.fill()
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Cache slot of a SCRATCHED composite — the filtered-composite map, under its own key so an item can hold
 *  both. The signature is the screen placement + how many cells have fallen: while the child scratches it
 *  changes every frame (and the composite is redone), and the moment they stop it freezes (and it is a
 *  blit). Only for a subtree whose CONTENT is static — an animated veil must keep being redrawn. */
function scratchCacheSlot(rctx: RenderCtx, doc: Doc, it: Item, ctx: CanvasRenderingContext2D, mask: ScratchMask): CacheSlot | undefined {
  if (!rctx.filterCache || typeof document === 'undefined' || !isContentStatic(doc, it)) return undefined
  const own = 'transform' in it && it.transform ? (it.transform as Transform) : IDENTITY
  const m = compose(matOf(ctx.getTransform()), own)
  const sig = `${round2(m.a)},${round2(m.b)},${round2(m.c)},${round2(m.d)},${round2(m.e)},${round2(m.f)}|${mask.cells.size}|${rctx.imageEpoch ?? 0}`
  return { map: rctx.filterCache, id: 'scratch:' + it.id, sig }
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

/** Advancing playback clock handed to a scope's children (its own `clockFrame`, else its pose `frame`). */
const clockOf = (frame: number, rctx: RenderCtx): number => rctx.clockFrame ?? frame

/** The monotone MovieClip clock (frames at `childFps`) for an `independent`/`once` instance, from the
 *  runtime beat (`monoTime` seconds). Undefined when there is no beat (editor/static walk) → synced. */
const monoFrameOf = (childFps: number, rctx: RenderCtx): number | undefined =>
  rctx.monoTime != null ? rctx.monoTime * childFps : undefined

/** Enter an instance's sub-scope: merge its exposed params (declared/call-site/state-initial + runtime
 *  override) into the expr scope, and surface its color params. Shared by render/bbox/shape paths so the
 *  driven local frame and the subtree expressions read the SAME param values. */
function instanceScope(doc: Doc, it: Instance, rctx: RenderCtx): { sym: SymbolDef | undefined; expr: ExprContext | undefined; color: Record<string, string> } {
  const sym = getSymbol(doc, it.symbolId)
  const resolved = resolveInstanceParams(sym, it)
  const runtime = rctx.paramsFor?.(it.id)
  const numeric = runtime ? { ...resolved.numeric, ...runtime } : resolved.numeric
  const expr = Object.keys(numeric).length ? { ...rctx.expr, ...numeric } : rctx.expr
  return { sym, expr, color: resolved.color }
}

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
  // `clip x y w h`: rectangular clip in the container's LOCAL space (ctx is already transformed to it).
  // SELF-bounded save/restore — a bare ctx.clip() can only be undone by restore(), and the filtered/tinted
  // path draws on a POOLED scratch canvas with no surrounding save, so the clip would leak to a later
  // unrelated subtree reusing that canvas. Wrapping here covers every caller path.
  if (it.clip) { ctx.save(); ctx.beginPath(); ctx.rect(it.clip.x, it.clip.y, it.clip.w, it.clip.h); ctx.clip() }
  if (isInstance(it)) {
    // EDITOR (freezeNested): the nested timeline does not play — frozen. BUT a STATE is a static config
    // (door "open"), not playback → a state-driven symbol freezes at its selected state's frame (so the
    // editor shows it open), else 0. PLAYER (no freeze): the full local frame (animation + driven states).
    // Exposed params scope this instance's subtree (declared/call-site/state-initial + runtime override);
    // color params feed `fill <param>` regions.
    const { sym, expr: subExpr, color } = instanceScope(doc, it, rctx)
    // (A) pose vs clock: a state machine pins `pose` (the symbol's cels) while `clock` keeps flowing into
    // the subtree → nested loops play under a pinned state. `clockFrame: clock` carries that forward.
    const childFps = subFps(sym?.timeline?.fps, rctx)
    const { pose, clock } = instanceFrames(sym, it, clockOf(frame, rctx), rctx.freezeNested, subExpr, monoFrameOf(childFps, rctx))
    renderLayers(ctx, doc, containerLayers(doc, it), pose, hidden, seen, { fps: childFps, expr: subExpr, freezeNested: rctx.freezeNested, image: rctx.image, filterCache: rctx.filterCache, imageEpoch: rctx.imageEpoch, itemState: rctx.itemState, paramsFor: rctx.paramsFor, clockFrame: clock, monoTime: rctx.monoTime, colorParams: color, scratched: rctx.scratched, statePath: rctx.channelValue ? (rctx.statePath ?? '') + it.id + '/' : undefined, channelValue: rctx.channelValue }, parent, depth + 1)
  } else if (isGroup(it) && it.timeline) {
    // Local symbol (group with its own timeline) = a nested timeline too → rides the advancing clock so it
    // keeps playing under a state-pinned ancestor (frozen only in the editor's freezeNested mode).
    const groupFrame = rctx.freezeNested ? 0 : clockOf(frame, rctx)
    renderLayers(ctx, doc, it.layers, groupFrame, hidden, seen, { fps: subFps(it.timeline.fps, rctx), expr: rctx.expr, freezeNested: rctx.freezeNested, image: rctx.image, filterCache: rctx.filterCache, imageEpoch: rctx.imageEpoch, itemState: rctx.itemState, clockFrame: groupFrame, monoTime: rctx.monoTime, scratched: rctx.scratched, statePath: rctx.statePath, channelValue: rctx.channelValue }, parent, depth + 1)
  } else {
    // Group without a timeline = same scope as the parent (not a sub-scope) -> follows the scope's frame.
    renderLayers(ctx, doc, containerLayers(doc, it), frame, hidden, seen, rctx, parent, depth + 1)
  }
  if (it.clip) ctx.restore()
}

// ── Stateful channel modifiers: collect their integration targets across the live scene ──────────
/** One modifier's integration target this frame: the per-(instance,channel) state key, the channel, the
 *  modifier spec, and the evaluated target value. The player integrates persistent state toward `target`. */
export type ModTarget = { key: string; ch: ExprChannel; mod: ChannelModifier; target: number }

/** Walk the scene (render-free) mirroring the render scope descent, resolving each layer so a stateful
 *  channel modifier's target is evaluated in its instance's context; `statePath` accumulates ancestor
 *  INSTANCE ids so two instances of the same symbol get independent state. Drives the player's advance. */
type VelocityFor = (key: string, ch: ExprChannel) => (arg: number) => number

function walkModifierScope(doc: Doc, layers: Layer[], frame: number, rctx: RenderCtx, sink: (t: ModTarget) => void, seen: Set<string>, velocityFor?: VelocityFor): void {
  const onModifierTarget = (key: string, ch: ExprChannel, mod: ChannelModifier, target: number) => sink({ key, ch, mod, target })
  for (const layer of layers) {
    if (!layer.visible) continue
    const items = resolveLayerAt(layer, frame, { fps: rctx.fps, ctx: rctx.expr, itemState: rctx.itemState, statePath: rctx.statePath, onModifierTarget, velocityFor })
    for (const it of items) {
      if (isInstance(it)) {
        if (seen.has(it.symbolId)) continue // anti-cycle guard (mirrors the render walk) — a recursive symbol must not loop
        const { sym, expr: subExpr } = instanceScope(doc, it, rctx)
        const childFps = subFps(sym?.timeline?.fps, rctx)
        const { pose, clock } = instanceFrames(sym, it, clockOf(frame, rctx), rctx.freezeNested, subExpr, monoFrameOf(childFps, rctx))
        walkModifierScope(doc, containerLayers(doc, it), pose, { fps: childFps, expr: subExpr, freezeNested: rctx.freezeNested, itemState: rctx.itemState, paramsFor: rctx.paramsFor, clockFrame: clock, monoTime: rctx.monoTime, statePath: (rctx.statePath ?? '') + it.id + '/' }, sink, new Set([...seen, it.symbolId]), velocityFor)
      } else if (isGroup(it) && it.timeline) {
        const groupFrame = rctx.freezeNested ? 0 : clockOf(frame, rctx)
        walkModifierScope(doc, it.layers, groupFrame, { ...rctx, fps: subFps(it.timeline.fps, rctx), clockFrame: groupFrame }, sink, seen, velocityFor)
      } else if (isGroup(it)) {
        walkModifierScope(doc, containerLayers(doc, it), frame, rctx, sink, seen, velocityFor)
      }
    }
  }
}

/** All modifier integration targets in the scene at `frame` (one per driven instance×channel). `velocityFor`
 *  (from the player's advance) lets `velocity()` in a target read its per-(instance,channel) previous value. */
export function collectModifierTargets(doc: Doc, frame: number, rctx: RenderCtx, velocityFor?: VelocityFor): ModTarget[] {
  const out: ModTarget[] = []
  walkModifierScope(doc, doc.layers, frame, rctx, (t) => out.push(t), new Set(), velocityFor)
  return out
}

/** Does the document declare ANY stateful channel modifier (scene layers OR symbol definitions)? Lets the
 *  player skip the whole advance pass for the common case (no modifiers → zero overhead). */
export function docHasModifiers(doc: Doc): boolean {
  const inItems = (items: Item[]): boolean => items.some((it) =>
    (isPoseable(it) && !!it.modifiers && Object.keys(it.modifiers).length > 0) ||
    (isGroup(it) && it.layers.some((l) => inItems(l.items))))
  return doc.layers.some((l) => inItems(l.items)) || (doc.symbols ?? []).some((s) => s.layers.some((l) => inItems(l.items)))
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
        const { sym, expr } = instanceScope(doc, it, rctx)
        const childFps = subFps(sym?.timeline?.fps, rctx)
        const { pose, clock } = instanceFrames(sym, it, clockOf(frame, rctx), rctx.freezeNested, expr, monoFrameOf(childFps, rctx))
        const sub: RenderCtx = { fps: childFps, expr, clockFrame: clock, monoTime: rctx.monoTime }
        const next = new Set([...seen, it.symbolId])
        for (const l of containerLayers(doc, it)) if (l.visible) collectShape(doc, resolveLayerAt(l, pose, { fps: sub.fps, ctx: sub.expr, parent: t }), pose, t, next, path, sub)
      } else if (isGroup(it) && it.timeline) {
        const groupFrame = rctx.freezeNested ? 0 : clockOf(frame, rctx)
        const sub: RenderCtx = { fps: subFps(it.timeline.fps, rctx), expr: rctx.expr, clockFrame: groupFrame, monoTime: rctx.monoTime }
        for (const l of it.layers) if (l.visible) collectShape(doc, resolveLayerAt(l, groupFrame, { fps: sub.fps, ctx: sub.expr, parent: t }), groupFrame, t, seen, path, sub)
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

/** Canvas style of a paint (solid or gradient), anchored to `bbox`. Reused for fill AND stroke.
 *  `colorParams` resolves a stop bound to a symbol color param (`0:teinte@0.8`) per instance. */
function paintStyle(ctx: CanvasRenderingContext2D, paint: Paint, bbox: ReturnType<typeof regionBBox>, fallback: string, colorParams?: Record<string, string>): string | CanvasGradient {
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
  // `addColorStop` THROWS on a non-finite offset (an untrusted `.flatpack` can carry `offset: "x"` -> NaN) or
  // a color string it can't parse -> clamp the offset to a finite [0,1] and let `resolveStopColor` always
  // yield a valid color, so a crafted gradient can't crash the render.
  for (const s of paint.stops) g.addColorStop(Number.isFinite(s.offset) ? clamp01(s.offset) : 0, resolveStopColor(s, colorParams))
  return g
}

function fillStyleFor(ctx: CanvasRenderingContext2D, region: Region, colorParams?: Record<string, string>): string | CanvasGradient {
  if (region.fillParam) { const c = colorParams?.[region.fillParam]; if (c) return c } // `fill <param>` → the instance's color (else fall back to region.color)
  return paintStyle(ctx, regionPaint(region), regionBBox(region), region.color, colorParams)
}

/** Active tint with its color RESOLVED against the param scope (null if absent / amount ~0). Returns the
 *  same object untouched when there's no param binding → no allocation on the hot path. Resolving here means
 *  the filter-cache signature and the composite both see the recolored value (cache busts on a param change). */
function resolveTint(tint: Tint | undefined, colorParams?: Record<string, string>): Tint | null {
  if (!tint || tint.amount <= 0.001) return null
  if (!tint.param) return tint
  return { color: resolveTintColor(tint, colorParams), amount: tint.amount }
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
    // Near-invisible subtree → skip its draw AND eval (for a group, this prunes its whole subtree, since
    // children are only resolved/drawn by the recursion inside renderOneItem). Mirrors the hit predicate
    // (`hittable`: opacity > 0.01) so draw and hit stay aligned — an alpha≈0 item is already click-through,
    // now it's free to render too. Makes the corpus gating idiom `opacity = phase==X ? 1 : 0` (even when
    // SMOOTHED toward ~0, not exactly 0) cost nothing for off-phase content.
    if (opacity <= 0.01) continue
    // Blend mode (add/screen = additive light, multiply = shadow). Saved/restored around the item.
    const blend = 'blend' in it ? it.blend : undefined
    const op = blend === 'add' ? 'lighter' : blend === 'screen' ? 'screen' : blend === 'multiply' ? 'multiply' : null
    if (op) { ctx.save(); ctx.globalCompositeOperation = op }
    // Edit preview (drag): we wrap the item's drawing WITHIN the layer order -> z-index preserved.
    const pm = rctx.preview?.ids.has(it.id) ? rctx.preview.m : null
    if (pm) ctx.save()
    if (pm) applyTransform(ctx, pm)
    // `reveal … erase`: the veil is drawn minus what the finger already rubbed out. Isolated off-screen so
    // the punch takes away the VEIL only, never what is drawn under it.
    const scratched = rctx.scratched?.get(it.id)
    if (scratched?.cells.size) {
      // The bbox is a LAMBDA on purpose: an unchanged veil never accumulates it (see `compositeScratched`).
      const devBBox = () => {
        const acc: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        accumDevBBox(doc, [it], frame, matOf(ctx.getTransform()), seen, acc, rctx)
        return acc.minX <= acc.maxX ? acc : null
      }
      compositeScratched(ctx, opacity, devBBox, scratched, parent, scratchCacheSlot(rctx, doc, it, ctx, scratched), (octx: CanvasRenderingContext2D) =>
        renderOneItem(octx, doc, it, frame, hidden, seen, rctx, 1, parent, depth)) // opacity is applied at BLIT
    } else {
      renderOneItem(ctx, doc, it, frame, hidden, seen, rctx, opacity, parent, depth)
    }
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
      const tint = resolveTint(it.tint, rctx.colorParams)
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
        }, cache, filterStr)
      } else {
        ctx.save()
        ctx.globalAlpha *= opacity
        applyTransform(ctx, ctm)
        renderContainerChildren(ctx, doc, it, frame, hidden, next, rctx, childParent, depth)
        ctx.restore()
      }
    } else if (isText(it)) {
      const acc: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
      // Text-on-path glyphs live at the baked path's coords (not within `box`); size the tint/filter
      // isolation buffer to the path extent, inflated by the font size for glyph ascent/descent.
      const pb = it.textPath ? pathBBox(it.textPath.path) : null
      if (pb) expandRect(acc, matOf(ctx.getTransform()), pb.minX - it.size, pb.minY - it.size, pb.maxX + it.size, pb.maxY + it.size)
      else expandRect(acc, compose(matOf(ctx.getTransform()), it.transform), 0, 0, it.box.w, it.box.h)
      paintLeaf(ctx, resolveTint(it.tint, rctx.colorParams) ?? undefined, it.filters, opacity, acc, scaleOf(ctx), (c) => paintText(c, it))
    } else if (isImage(it)) {
      const src = rctx.image?.(it.assetId) ?? null
      const acc: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
      expandRect(acc, compose(matOf(ctx.getTransform()), it.transform), 0, 0, it.w, it.h)
      paintLeaf(ctx, resolveTint(it.tint, rctx.colorParams) ?? undefined, it.filters, opacity, acc, scaleOf(ctx), (c) => paintImage(c, it, src))
    } else {
      // Region: fill (unless noFill) + optional outline (stroke), same Bezier path.
      const reg = it as Region
      if (reg.filters?.length) {
        // RARE case: filters on a path -> we isolate off-screen then recompose (closure tolerated here).
        const lb = regionBBox(reg)
        const acc: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        if (lb) expandRect(acc, matOf(ctx.getTransform()), lb.minX, lb.minY, lb.maxX, lb.maxY)
        paintLeaf(ctx, undefined, reg.filters, opacity, acc, scaleOf(ctx), (c) => paintRegion(c, reg, rctx.colorParams))
      } else if (opacity < 1) {
        // Semi-transparent: scope globalAlpha with save/restore (paintRegion sets its own fill/stroke style).
        ctx.save(); ctx.globalAlpha *= opacity; paintRegion(ctx, reg, rctx.colorParams); ctx.restore()
      } else {
        // HOT path (opaque regions, the majority): no save/restore — paintRegion overwrites fill/stroke
        // style and draws with an explicit Path2D, leaving no state to restore.
        paintRegion(ctx, reg, rctx.colorParams)
      }
    }
  }
}

/** Does this region stroke only a WINDOW of its outline (`draw`/`from`)? `null` = the whole thing, the
 *  case that must stay free. A non-finite bound is left to `trimPath`, which falls back to the default. */
function strokeWindow(reg: Region): { from: number; to: number } | null {
  const to = reg.draw ?? 1
  const from = reg.drawFrom ?? 0
  return from <= 0 && to >= 1 ? null : { from, to }
}

/**
 * The path actually STROKED under a `draw` window: the piece of the outline between two ARC-LENGTH
 * fractions (ink appearing behind a finger). `null` = nothing to stroke (empty window). The fill, the
 * gradient box and the hit shape keep using the WHOLE path: `draw` trims the line, not the shape.
 */
function trimmedPath(reg: Region, w: { from: number; to: number }): Path2D | null {
  const pieces = trimPath(reg.path, w.from, w.to)
  if (!pieces.length) return null
  const p = new Path2D()
  for (const { pts, closed } of pieces) {
    p.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y)
    if (closed) p.closePath() // a subpath drawn WHOLE keeps its join; a cut piece stays open (two caps)
  }
  return p
}

/** Paints a region (fill + outline) into `c`. Module function (zero allocation per call). */
function paintRegion(c: CanvasRenderingContext2D, reg: Region, colorParams?: Record<string, string>) {
  const trim = strokeWindow(reg)
  // The whole outline is needed to FILL, and to stroke when there is no window — so an ink trail
  // (`nofill` + `draw`, the tracing case, rebuilt every frame) never pays for it.
  const path = !reg.noFill || !trim ? regionPath(reg) : null
  if (!reg.noFill && path) {
    c.fillStyle = fillStyleFor(c, reg, colorParams)
    c.fill(path, 'evenodd')
  }
  if (reg.stroke) {
    const line = trim ? trimmedPath(reg, trim) : path
    if (!line) return
    const s = reg.stroke
    c.lineWidth = s.width
    c.lineCap = s.cap ?? 'round'
    c.lineJoin = s.join ?? 'round'
    if (s.miterLimit != null) c.miterLimit = s.miterLimit
    c.setLineDash(s.dash ?? [])
    const paramColor = reg.strokeParam ? colorParams?.[reg.strokeParam] : undefined // `stroke <param>` → instance color
    c.strokeStyle = paramColor || paintStyle(c, s.paint, regionBBox(reg), reg.color, colorParams) // empty/undefined → literal paint (gradient stops resolved per param)
    c.stroke(line)
  }
}

/** CSS font of a text (reused by the editor to measure). */
export const textFont = (t: Text): string => `${t.italic ? 'italic ' : ''}${t.weight ?? 400} ${t.size}px ${t.font}`

/** Paints a "live" text at full opacity (local origin = top-left corner, lines aligned within `box`). */
function paintText(ctx: CanvasRenderingContext2D, t: Text) {
  if (t.textPath) { paintTextOnPath(ctx, t); return } // RFC text-on-path: glyphs follow a baked curve
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

/** Lays the glyphs of `t` along `t.textPath.path` (RFC text-on-path). Per glyph: translate to the arc
 *  sample point, rotate to the tangent, draw centered. `align`+`start` set the run's anchor; `spacing`
 *  tracks the glyphs (effective advance floored at 1px); `side` puts the run outside (`over`, baseline on
 *  the curve) or inside (`under`, top on the curve), upright. Glyphs past an OPEN path's ends are dropped,
 *  a CLOSED path wraps. A degenerate (zero-length) path falls back to straight text at the origin. */
function paintTextOnPath(ctx: CanvasRenderingContext2D, t: Text) {
  const tp = t.textPath!
  const sampler = makePathSampler(tp.path)
  const L = sampler.length
  ctx.save()
  ctx.fillStyle = t.color
  ctx.font = textFont(t)
  ctx.textAlign = 'center'
  ctx.textBaseline = tp.side === 'under' ? 'top' : 'alphabetic' // under = inside the curve, over = outside
  const stroke = t.stroke
  if (stroke) {
    ctx.lineWidth = stroke.width
    ctx.lineCap = stroke.cap ?? 'round'
    ctx.lineJoin = stroke.join ?? 'round'
    if (stroke.miterLimit != null) ctx.miterLimit = stroke.miterLimit
    ctx.setLineDash(stroke.dash ?? [])
    ctx.strokeStyle = paintStyle(ctx, stroke.paint, pathBBox(tp.path), t.color)
  }
  if (L <= 0) {
    // Degenerate path (zero length) → keep the content visible as straight text at the origin.
    if (stroke) ctx.strokeText(t.content, 0, 0)
    ctx.fillText(t.content, 0, 0)
    ctx.restore()
    return
  }
  const glyphs = [...t.content] // code-point aware (no mid-surrogate split)
  const adv = glyphs.map((g) => ctx.measureText(g).width)
  const sp = tp.spacing ?? 0
  const eff = adv.map((a) => Math.max(a + sp, 1)) // tracking; effective advance floored at 1px (no reversal/overlap)
  const n = glyphs.length
  // Visual run width: advance of every glyph but the last (eff) + the last glyph's own width (no trailing track).
  const runW = n ? eff.reduce((a, b) => a + b, 0) - (eff[n - 1] - adv[n - 1]) : 0
  const anchor = (tp.start ?? 0) * L
  // align: left = run starts at the anchor; center = centered on it; right = run ends on it.
  let cursor = t.align === 'center' ? anchor - runW / 2 : t.align === 'right' ? anchor - runW : anchor
  const closed = sampler.closed
  for (let i = 0; i < n; i++) {
    const mid = cursor + adv[i] / 2
    cursor += eff[i]
    const s = closed ? ((mid % L) + L) % L : mid
    if (!closed && (mid < 0 || mid > L)) continue // overflow past an open path → drop (--check warns, §6)
    const { point, tangent } = sampler.at(s)
    ctx.save()
    ctx.translate(point.x, point.y)
    ctx.rotate(Math.atan2(tangent.y, tangent.x))
    if (stroke) ctx.strokeText(glyphs[i], 0, 0)
    ctx.fillText(glyphs[i], 0, 0)
    ctx.restore()
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
  compositeFiltered(ctx, opacity, t, filters, scale, devBBox.minX <= devBBox.maxX ? devBBox : null, draw, undefined, filterStr)
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
  const { hidden: hid, masks, guides } = layerStructure(layers) // hidden ids + mask/guide parents in ONE pass
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
    const items = resolveLayerAt(layer, frame, { fps: rctx.fps, ctx: rctx.expr, guide: guidePath ?? undefined, orient: layer.orientToGuide, parent, itemState: rctx.itemState, statePath: rctx.statePath, channelValue: rctx.channelValue })
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
