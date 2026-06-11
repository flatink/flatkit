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
import type { Transform } from './transform'
import { uid } from './id'

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

/** Ids of a folder's subtree: itself + all its descendants (transitive). */
export function subtreeFolderIds(folders: Folder[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId])
  let added = true
  while (added) {
    added = false
    for (const f of folders) if (f.parent && ids.has(f.parent) && !ids.has(f.id)) { ids.add(f.id); added = true }
  }
  return ids
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

export const regionsOf = (layer: Layer): Region[] =>
  layer.items.filter(isRegion)
export const groupsOf = (layer: Layer): Group[] => layer.items.filter(isGroup)
export const containersOf = (layer: Layer): (Group | Instance)[] => layer.items.filter(isContainer)

/**
 * Split a layer's items into "rows" for the outliner / reordering: each container is one row, and
 * contiguous material (regions) is grouped together. The array order = z-order (last = on top).
 */
export type LayerRow = { kind: 'item'; item: Group | Instance | Text | Image } | { kind: 'matter'; items: Region[] }

export function segmentRows(items: Item[]): LayerRow[] {
  const rows: LayerRow[] = []
  let matter: Region[] = []
  for (const it of items) {
    if (isPoseable(it)) {
      if (matter.length) {
        rows.push({ kind: 'matter', items: matter })
        matter = []
      }
      rows.push({ kind: 'item', item: it })
    } else {
      matter.push(it)
    }
  }
  if (matter.length) rows.push({ kind: 'matter', items: matter })
  return rows
}

export function flattenRows(rows: LayerRow[]): Item[] {
  return rows.flatMap((r): Item[] => (r.kind === 'item' ? [r.item] : r.items))
}

// ── Symbols / instances ──────────────────────────────────────────────────────
export function getSymbol(doc: Doc, id: string): SymbolDef | undefined {
  return doc.symbols.find((s) => s.id === id)
}
export function makeSymbol(name: string, layers: Layer[]): SymbolDef {
  return { id: uid(), name, layers }
}
export function makeInstance(symbolId: string, name: string, transform: Transform): Instance {
  return { id: uid(), kind: 'instance', name, transform, symbolId }
}
/** Layers of a container: the group's, or the symbol's for an instance. */
export function containerLayers(doc: Doc, item: Group | Instance): Layer[] {
  return isInstance(item) ? (getSymbol(doc, item.symbolId)?.layers ?? []) : item.layers
}

/** Symbols directly instantiated in a layer stack (groups included). */
function directSymbolRefs(layers: Layer[]): string[] {
  const out: string[] = []
  const walk = (items: Item[]) => {
    for (const it of items) {
      if (isInstance(it)) out.push(it.symbolId)
      else if (isGroup(it)) it.layers.forEach((l) => walk(l.items))
    }
  }
  layers.forEach((l) => walk(l.items))
  return out
}

/** Does symbol `fromId` (transitively) reference `targetId`? (= placing an instance of `fromId` inside
 *  `targetId` would create a cycle). Includes the case `fromId === targetId`. */
export function symbolDependsOn(doc: Doc, fromId: string, targetId: string): boolean {
  const visited = new Set<string>()
  const stack = [fromId]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === targetId) return true
    if (visited.has(cur)) continue
    visited.add(cur)
    const sym = getSymbol(doc, cur)
    if (sym) for (const ref of directSymbolRefs(sym.layers)) stack.push(ref)
  }
  return false
}

export function makeLayer(name: string, items: Item[] = []): Layer {
  return { id: uid(), name, visible: true, locked: false, opacity: 1, items }
}
export function makeFolder(name: string): Layer {
  return { id: uid(), name, visible: true, locked: false, opacity: 1, items: [], isFolder: true }
}
export function getLayer(layers: Layer[], id: string): Layer | undefined {
  return layers.find((l) => l.id === id)
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

/**
 * Outliner rows in DISPLAY order (top→bottom), with depth.
 * A folder precedes its indented children; a collapsed folder hides its children.
 * Within a level, top→bottom order = the reverse of the array order (z: last = on top).
 */
export function layerRowsTopDown(layers: Layer[]): LayerNode[] {
  const byParent = new Map<string | undefined, Layer[]>()
  for (const l of layers) {
    const k = l.parent
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(l)
  }
  const rows: LayerNode[] = []
  const walk = (parentId: string | undefined, depth: number) => {
    const kids = byParent.get(parentId) ?? []
    for (let i = kids.length - 1; i >= 0; i--) {
      const l = kids[i]
      rows.push({ layer: l, depth })
      if ((isFolder(l) || isMask(l) || isGuide(l)) && !l.collapsed) walk(l.id, depth + 1) // folder / mask / guide = collapsible parent
    }
  }
  walk(undefined, 0)
  return rows
}

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

function updateGroupLayers(layer: Layer, path: string[], newLayers: Layer[]): Layer {
  const [head, ...rest] = path
  let changed = false
  const items = layer.items.map((it) => {
    if (!isGroup(it) || it.id !== head) return it
    changed = true
    return rest.length === 0
      ? { ...it, layers: newLayers }
      : { ...it, layers: it.layers.map((l) => updateGroupLayers(l, rest, newLayers)) }
  })
  return changed ? { ...layer, items } : layer
}

function setNested(baseLayers: Layer[], groupPath: string[], newLayers: Layer[]): Layer[] {
  if (groupPath.length === 0) return newLayers
  return baseLayers.map((l) => updateGroupLayers(l, groupPath, newLayers))
}

/** Replace the current context's layers (root layers or a symbol's content). */
export function setContextLayers(doc: Doc, editPath: EditFrame[], layers: Layer[]): Doc {
  let lastSym = -1
  for (let i = editPath.length - 1; i >= 0; i--) {
    if (editPath[i].kind === 'symbol') {
      lastSym = i
      break
    }
  }
  const groupPath = editPath.slice(lastSym + 1).map((f) => (f as { id: string }).id)
  if (lastSym === -1) {
    return { ...doc, layers: setNested(doc.layers, groupPath, layers) }
  }
  const symbolId = (editPath[lastSym] as { symbolId: string }).symbolId
  return {
    ...doc,
    symbols: doc.symbols.map((s) => (s.id === symbolId ? { ...s, layers: setNested(s.layers, groupPath, layers) } : s)),
  }
}

/** Layers to render as the "scene": those of the last entered symbol (isolation), otherwise the root. */
export function sceneRootLayers(doc: Doc, editPath: EditFrame[]): Layer[] {
  let layers = doc.layers
  for (const f of editPath) if (f.kind === 'symbol') layers = getSymbol(doc, f.symbolId)?.layers ?? layers
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

// ── Active layer in the current context ───────────────────────────────────────
export function activeLayer(doc: Doc, editPath: EditFrame[], activeLayerId: string): Layer | undefined {
  return getLayer(contextLayers(doc, editPath), activeLayerId)
}
export function activeRegions(doc: Doc, editPath: EditFrame[], activeLayerId: string): Region[] {
  const layer = activeLayer(doc, editPath, activeLayerId)
  return layer ? regionsOf(layer) : []
}

/** Ids of ALL selectable elements of the context (every type, every visible unlocked layer) — for
 *  "Select all" (Ctrl/Cmd+A). Ignores folders, hidden/locked layers. */
export function contextSelectableIds(doc: Doc, editPath: EditFrame[]): string[] {
  return contextLayers(doc, editPath)
    .filter((l) => l.visible && !l.locked && !l.isFolder)
    .flatMap((l) => l.items)
    .map((it) => it.id)
}

/** Replace the active layer's regions (poseables — containers, text, image — kept). */
export function setActiveRegions(doc: Doc, editPath: EditFrame[], activeLayerId: string, regions: Region[]): Doc {
  const layers = contextLayers(doc, editPath).map((l) =>
    l.id === activeLayerId ? { ...l, items: [...regions, ...l.items.filter(isPoseable)] } : l,
  )
  return setContextLayers(doc, editPath, layers)
}
/** Replace all the active layer's items. */
export function setActiveItems(doc: Doc, editPath: EditFrame[], activeLayerId: string, items: Item[]): Doc {
  const layers = contextLayers(doc, editPath).map((l) => (l.id === activeLayerId ? { ...l, items } : l))
  return setContextLayers(doc, editPath, layers)
}

// ── Misc ───────────────────────────────────────────────────────────────────
export function totalRegions(doc: Doc): number {
  const count = (layers: Layer[]): number =>
    layers.reduce(
      (n, l) => n + l.items.reduce((m, it) => m + (isGroup(it) ? count(it.layers) : isInstance(it) ? 0 : 1), 0),
      0,
    )
  return count(doc.layers)
}

export function patchLayerIn(layers: Layer[], id: string, patch: Partial<Layer>): Layer[] {
  return layers.map((l) => (l.id === id ? { ...l, ...patch } : l))
}
export function moveLayerIn(layers: Layer[], id: string, dir: 1 | -1): Layer[] {
  const i = layers.findIndex((l) => l.id === id)
  if (i < 0) return layers
  const j = i + dir
  if (j < 0 || j >= layers.length) return layers
  const out = layers.slice()
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}
/** Reorder by a list of ids (bottom→top order, like `layers`). Returns unchanged if the order does not match exactly. */
export function reorderLayersIn(layers: Layer[], orderedIds: string[]): Layer[] {
  if (orderedIds.length !== layers.length) return layers
  const byId = new Map(layers.map((l) => [l.id, l]))
  const out = orderedIds.map((id) => byId.get(id))
  if (out.some((l) => !l)) return layers
  return out as Layer[]
}
