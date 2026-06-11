// ─────────────────────────────────────────────────────────────────────────────
//  manifest.ts — "map of the scene" for an LLM (and tooling introspection).
//
//  The language fits in < 2k tokens (see languageCard); the real context cost for an LLM
//  is knowing WHAT IT CAN NAME in THIS scene (objects, assets, variables, functions).
//  `docToManifest` derives this compact block from a Doc — the exact counterpart of references
//  by name (sceneRefs): the model then references only REAL names, and the linter catches the rest.
//
//  Pure, derived (never stored). ~a few hundred tokens for a real scene.
// ─────────────────────────────────────────────────────────────────────────────
import type { Doc, Group, Image, Instance, Layer, Text } from '@flatkit/types'
import { EXPR_CHANNELS } from '@flatkit/engine/timeline'
import { getSymbol, isGroup, isImage, isInstance, isPoseable, isText } from '@flatkit/engine/layers'
import { languageCard } from './languageCard'

/** Type label of a poseable (hence named) item. */
function kindLabel(doc: Doc, it: Group | Instance | Text | Image): string {
  if (isInstance(it)) { const s = getSymbol(doc, it.symbolId); return s ? `Instance:${s.name}` : 'Instance' }
  if (isText(it)) return 'Text'
  if (isImage(it)) return 'Image'
  return 'Symbol' // Group ("symbol" in the UI)
}

export type ManifestObject = { name: string; kind: string }

/** Named scene objects (groups included, library symbols excluded), first name wins. */
export function manifestObjects(doc: Doc): ManifestObject[] {
  const out: ManifestObject[] = []
  const seen = new Set<string>()
  const walk = (layers: Layer[]) => {
    for (const l of layers) for (const it of l.items) {
      if (isPoseable(it) && it.name && !seen.has(it.name)) { seen.add(it.name); out.push({ name: it.name, kind: kindLabel(doc, it) }) }
      if (isGroup(it)) walk(it.layers)
    }
  }
  walk(doc.layers)
  return out
}

/** Variables → `name=value` (scalar) or `name[len]` (array). */
function manifestVars(doc: Doc): string[] {
  return Object.entries(doc.variables ?? {}).map(([k, v]) => (Array.isArray(v) ? `${k}[${v.length}]` : `${k}=${v}`))
}

/**
 * Compact map of the scene (objects/assets/variables/functions/packages) — injectable in a prompt.
 * Only non-empty sections appear. The names are the ones the code can reference.
 */
export function docToManifest(doc: Doc): string {
  const objs = manifestObjects(doc)
  const assets = (doc.assets ?? []).map((a) => `${a.kind}:${a.id}`)
  const vars = manifestVars(doc)
  const funcs = (doc.functions ?? []).map((f) => `${f.name}(${f.params.join(', ')})`)
  const lines = ['# SCENE', `size: ${doc.width}x${doc.height}`]
  if (objs.length) lines.push(`objects: ${objs.map((o) => `${o.name}(${o.kind})`).join(', ')}`)
  if (assets.length) lines.push(`assets: ${assets.join(', ')}`)
  if (vars.length) lines.push(`vars: ${vars.join(', ')}`)
  if (funcs.length) lines.push(`funcs: ${funcs.join(', ')}`)
  if (doc.imports?.length) lines.push(`packages: ${doc.imports.join(', ')}`)
  lines.push(`channels: ${EXPR_CHANNELS.join(' ')}`)
  return lines.join('\n')
}

/** Full LLM context: language reference (static) + scene map (derived from the Doc). */
export function llmContext(doc: Doc): string {
  return `${languageCard()}\n\n${docToManifest(doc)}`
}
