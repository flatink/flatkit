// ─────────────────────────────────────────────────────────────────────────────
//  compile.ts — the "modern SWF" compiler (RFC, step P2).
//
//  Takes the PROGRAM (`.flatink`) + the ASSETS (`.flat`) and produces a resolved `Doc` —
//  the ".flatpack" v1 (= the baked doc the player already plays). Steps:
//    1. parse the assets → symbols;
//    2. parse the program → composition + behavior (`@Name` refs);
//    3. RESOLVE refs by name (instances → symbol id), across ALL libs;
//    4. assemble the Doc.
//
//  v1: no binary optimization nor media embedding (P2b). Pure, no DOM.
// ─────────────────────────────────────────────────────────────────────────────
import type { Doc, Item, Layer } from '@flatkit/types'
import { parseFlatLib, parseProgramFull } from '@flatkit/engine/flatFormat'
import { isGroup, isInstance } from '@flatkit/engine/layers'

/** Resolves `symbolId: '@Name'` instances into real ids (recursive, across groups). */
function resolveRefs(layers: Layer[], byName: Map<string, string>): void {
  const walk = (items: Item[]) => {
    for (const it of items) {
      if (isInstance(it) && it.symbolId.startsWith('@')) it.symbolId = byName.get(it.symbolId.slice(1)) ?? it.symbolId
      if (isGroup(it)) it.layers.forEach((l) => walk(l.items))
    }
  }
  layers.forEach((l) => walk(l.items))
}

/** Source of a media (base64 data-URI) by declared path (`asset … "path" …`). */
export type MediaMap = Record<string, { mime: string; data: string }>

/**
 * Compile a `.flatink` program + its `.flat` assets → playable `Doc` (the ".flatpack").
 * `assetSrcs` = the text of each `.flat` lib. `media` = the content of the referenced media files
 * (by path). Symbol refs (by name) are resolved across the whole set of libs; declared media
 * are EMBEDDED (path → data-URI).
 */
export function compileFlatpack(programSrc: string, assetSrcs: string[] = [], media: MediaMap = {}): Doc {
  const libs = assetSrcs.map((src) => parseFlatLib(src))
  const symbols = libs.flatMap((l) => l.symbols)
  const folders = libs.flatMap((l) => l.folders) // library folders (organization)
  const prog = parseProgramFull(programSrc)
  const byName = new Map(symbols.map((s) => [s.name, s.id]))
  symbols.forEach((s) => resolveRefs(s.layers, byName)) // cross-lib refs
  resolveRefs(prog.layers, byName) // program refs

  // Embed declared media (data = path → provided data-URI). Missing = left as is.
  const assets = (prog.assets ?? []).map((a) => { const m = media[a.data]; return m ? { ...a, mime: m.mime, data: m.data } : a })

  return {
    width: prog.width,
    height: prog.height,
    ...(prog.background ? { background: prog.background } : {}),
    symbols,
    ...(folders.length ? { folders } : {}),
    layers: prog.layers,
    ...(prog.variables && Object.keys(prog.variables).length ? { variables: prog.variables } : {}),
    ...(prog.imports?.length ? { imports: prog.imports } : {}),
    ...(prog.functions?.length ? { functions: prog.functions } : {}),
    timeline: prog.timeline ?? { fps: 24, durationFrames: 60, tracks: [] },
    ...(prog.interactions?.length ? { interactions: prog.interactions } : {}),
    ...(prog.interactors?.length ? { interactors: prog.interactors } : {}),
    ...(assets.length ? { assets } : {}),
  }
}

/** Serialize the `.flatpack` v1 (JSON of the compiled Doc). */
export const packToJSON = (doc: Doc): string => JSON.stringify(doc)
