// ─────────────────────────────────────────────────────────────────────────────
//  migrateCel.ts — conversion of the "old model" (Timeline.tracks + contentTracks) → the "cel model"
//  (Layer.cels).
//
//  Serves TWO purposes:
//   1. permanent migration of saved docs (V7 → V8);
//   2. transient derivation (the store still writes tracks/contentTracks, the renderer reads the cels) —
//      removed once the store authors the cels directly.
//
//  Idempotent and non-destructive: if a scope has NEITHER tracks NOR contentTracks, its layers are not
//  touched (already-authored cels left as-is). The tracks/contentTracks fields are KEPT for now.
//
//  Pure (zero mutation, zero polygon-clipping). Reusable by the player.
// ─────────────────────────────────────────────────────────────────────────────
import type { Doc, Item, Layer, SymbolDef } from '@flatkit/types'
import { evaluateTimeline, resolveContent, type Timeline } from './timeline'
import { isContainer, isGroup } from './layers'
import type { Cel, Pose } from './cel'

/** Doc with cels derived from the old model, at every scope (recursive). */
export function withCels(doc: Doc): Doc {
  return {
    ...doc,
    layers: scopeCels(doc.layers, doc.timeline),
    symbols: doc.symbols.map(withCelsSymbol),
  }
}

function withCelsSymbol(s: SymbolDef): SymbolDef {
  return { ...s, layers: scopeCels(s.layers, s.timeline) }
}

/** Recurse into groups to handle nested scopes (a local symbol = group+timeline). */
function deepItem(it: Item): Item {
  if (isGroup(it)) return { ...it, layers: scopeCels(it.layers, it.timeline) }
  return it
}

/** Build the cels of ONE scope's layers from its timeline (tracks + contentTracks). */
function scopeCels(layers: Layer[], tl: Timeline | undefined): Layer[] {
  const hasOld = !!tl && ((tl.tracks?.length ?? 0) > 0 || (tl.contentTracks?.length ?? 0) > 0)
  // Without the old model: do not touch the cels (post-store-rewrite); but recurse for nested scopes.
  if (!hasOld) return layers.map((l) => ({ ...l, items: l.items.map(deepItem) }))

  return layers.map((layer) => {
    const items = layer.items.map(deepItem)
    const contentTrack = tl!.contentTracks?.find((ct) => ct.layerId === layer.id)
    const containerIds = new Set(items.filter(isContainer).map((i) => i.id))
    const tracksHere = tl!.tracks.filter((t) => containerIds.has(t.targetId))
    if (!contentTrack && tracksHere.length === 0) return { ...layer, items } // static layer

    // Track expressions → moved onto the container (its new home).
    const items2 = items.map((it) => {
      if (!isContainer(it)) return it
      const et = tracksHere.find((t) => t.targetId === it.id && t.expressions && Object.keys(t.expressions).length)
      return et ? { ...it, expressions: et.expressions } : it
    })

    // Keyframes = union { layer content-keys } ∪ { keyframes of the layer's containers }.
    const frameSet = new Set<number>()
    for (const ck of contentTrack?.keyframes ?? []) frameSet.add(ck.frame)
    for (const t of tracksHere) for (const k of t.keyframes) frameSet.add(k.frame)
    if (frameSet.size === 0) frameSet.add(0) // expr-only → at least one cel at 0
    const frames = [...frameSet].sort((a, b) => a - b)

    const cels: Cel[] = frames.map((f) => {
      const ov = evaluateTimeline(tl, f)
      const poses: Pose[] = []
      for (const c of items2) {
        if (!isContainer(c)) continue
        const o = ov.get(c.id)
        if (o?.visible === false) continue // hidden (empty) keyframe → container absent
        const pose: Pose = { id: c.id, transform: o?.transform ?? c.transform, opacity: o?.opacity ?? c.opacity ?? 1 }
        const tint = o?.tint ?? c.tint
        if (tint) pose.tint = tint
        const kf = tracksHere.find((t) => t.targetId === c.id)?.keyframes.find((k) => k.frame === f)
        if (kf?.rotate) pose.spin = kf.rotate
        if (kf?.turns) pose.turns = kf.turns
        poses.push(pose)
      }
      const cel: Cel = { frame: f, poses }
      const ck = contentTrack?.keyframes.find((k) => k.frame === f)
      if (ck) cel.matter = resolveContent(tl, f).get(layer.id) ?? ck.items // material defined at this key
      return cel
    })

    // Per-span tween + easing: interpolate where animated containers are shared with the next cel.
    for (let i = 0; i < cels.length - 1; i++) {
      const next = cels[i + 1]
      const shared = cels[i].poses.find((p) => next.poses.some((q) => q.id === p.id) && tracksHere.some((t) => t.targetId === p.id))
      if (shared) {
        cels[i].tween = true
        const kf = tracksHere.find((t) => t.targetId === shared.id)?.keyframes.find((k) => k.frame === cels[i].frame)
        if (kf?.easing) cels[i].ease = kf.easing
      }
    }
    return { ...layer, items: items2, cels }
  })
}
