// ─────────────────────────────────────────────────────────────────────────────
//  layers.ts — the layer stack + edit "context" navigation.
//
//  A layer holds items: material (Region), a one-off group (Group), or an instance of a reusable
//  symbol (Instance → doc.symbols).
//
//  editPath = a list of frames from the root toward the current context:
//    []                              -> root layers
//    [group g1]                      -> layers of group g1
//    [symbol S]                      -> layers of symbol S (shared)
//    [symbol S, group g1]            -> group g1 inside symbol S
// ─────────────────────────────────────────────────────────────────────────────
import type { Doc, EditFrame, Folder, Group, Instance, Item, Layer, Region, SymbolDef, Text, Image, Timeline } from '@flatkit/types'

// ── Library folders (symbol organization) ─────────────────────────────────────
/** Readable path of a folder ("A/B/C"), climbing the `parent` chain. Cycle-safe. Empty if not found. */
export function folderPath(folders: Folder[], id: string | undefined): string {
  const names: string[] = []
  const seen = new Set<string>()
  let cur = id
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const f = folders.find((x) => x.id === cur)
    if (!f) break
    names.unshift(f.name)
    cur = f.parent
  }
  return names.join('/')
}

export function isGroup(item: Item): item is Group {
  return (item as Group).kind === 'group'
}
export function isInstance(item: Item): item is Instance {
  return (item as Instance).kind === 'instance'
}
export function isText(item: Item): item is Text {
  return (item as Text).kind === 'text'
}
export function isImage(item: Item): item is Image {
  return (item as Image).kind === 'image'
}
/** Container = has internal layers (group/instance). NB: text/image are NOT containers. */
export function isContainer(item: Item): item is Group | Instance {
  return isGroup(item) || isInstance(item)
}
/** Material = a polygonal region (HOLD, never interpolated) — no `kind`. */
export function isRegion(item: Item): item is Region {
  return (item as { kind?: string }).kind === undefined
}
/** "Poseable" = animatable by a cel pose (transform/opacity/tint): a container, text, or image. */
export function isPoseable(item: Item): item is Group | Instance | Text | Image {
  return isContainer(item) || isText(item) || isImage(item)
}

export const groupsOf = (layer: Layer): Group[] => layer.items.filter(isGroup)
export const containersOf = (layer: Layer): (Group | Instance)[] => layer.items.filter(isContainer)

/**
 * Split a layer's items into "rows" for the outliner / reordering: each container is one row, and
 * contiguous material (regions) is grouped together. The array order = z-order (last = on top).
 */
export type LayerRow = { kind: 'item'; item: Group | Instance | Text | Image } | { kind: 'matter'; items: Region[] }

// ── Symbols / instances ──────────────────────────────────────────────────────
export function getSymbol(doc: Doc, id: string): SymbolDef | undefined {
  return doc.symbols.find((s) => s.id === id)
}
/** Layers of a container: the group's, or the symbol's for an instance. */
export function containerLayers(doc: Doc, item: Group | Instance): Layer[] {
  return isInstance(item) ? (getSymbol(doc, item.symbolId)?.layers ?? []) : item.layers
}

// ── Folders (tree organization over a flat array) ─────────────────────────────
export const isFolder = (l: Layer): boolean => !!l.isFolder

export const isMask = (l: Layer): boolean => !!l.isMask

export const isGuide = (l: Layer): boolean => !!l.isGuide

/**
 * For each layer that is a CHILD of a guide layer: its guide layer. The guide's material (a path)
 * drives its children's position along the path; it is not rendered.
 */
export function guideMap(layers: Layer[]): Map<string, Layer> {
  const byId = new Map(layers.map((l) => [l.id, l]))
  const m = new Map<string, Layer>()
  for (const l of layers) {
    const p = l.parent ? byId.get(l.parent) : undefined
    if (p && p.isGuide) m.set(l.id, p)
  }
  return m
}

/**
 * For each layer that is a CHILD of a mask layer: its mask (Flash style, but the mask is a CONTAINER —
 * the layers to mask are filed inside it). The mask's material clips its children. A disabled mask
 * (`maskOff`) has no effect.
 */
export function maskMap(layers: Layer[]): Map<string, Layer> {
  const byId = new Map(layers.map((l) => [l.id, l]))
  const m = new Map<string, Layer>()
  for (const l of layers) {
    const p = l.parent ? byId.get(l.parent) : undefined
    if (p && p.isMask && !p.maskOff) m.set(l.id, p)
  }
  return m
}

/** Ids of layers hidden by themselves OR by a collapsed/hidden ancestor folder (visibility). */
export function hiddenLayerIds(layers: Layer[]): Set<string> {
  const byId = new Map(layers.map((l) => [l.id, l]))
  const hidden = new Set<string>()
  for (const l of layers) {
    let cur: Layer | undefined = l
    while (cur) {
      if (!cur.visible) {
        hidden.add(l.id)
        break
      }
      cur = cur.parent ? byId.get(cur.parent) : undefined
    }
  }
  return hidden
}

/** True if `layer` (and all its ancestor folders) are visible. */
export function layerEffectiveVisible(layers: Layer[], layer: Layer): boolean {
  return !hiddenLayerIds(layers).has(layer.id)
}

export type LayerNode = { layer: Layer; depth: number }

// ── Context navigation (frames) ──────────────────────────────────────────────
export function contextLayers(doc: Doc, editPath: EditFrame[]): Layer[] {
  let layers = doc.layers
  for (const f of editPath) {
    if (f.kind === 'symbol') {
      layers = getSymbol(doc, f.symbolId)?.layers ?? layers
    } else {
      const grp = layers.flatMap(groupsOf).find((g) => g.id === f.id)
      if (!grp) break
      layers = grp.layers
    }
  }
  return layers
}

/** Timeline of the edited scope: root (`doc.timeline`), a library symbol, or a local symbol (group). */
export function getScopeTimeline(doc: Doc, editPath: EditFrame[]): Timeline | undefined {
  if (editPath.length === 0) return doc.timeline
  const f = editPath[editPath.length - 1]
  if (f.kind === 'symbol') return getSymbol(doc, f.symbolId)?.timeline
  // local symbol: find the group (a direct item of the parent context)
  return contextLayers(doc, editPath.slice(0, -1)).flatMap(groupsOf).find((g) => g.id === f.id)?.timeline
}
