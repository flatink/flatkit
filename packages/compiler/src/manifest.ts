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
import type { Doc, Group, Image, Instance, ItemEvent, Layer, Text } from '@flatkit/types'
import { EXPR_CHANNELS, OFFSET_CHANNELS } from '@flatkit/engine/timeline'
import { getSymbol, isGroup, isImage, isInstance, isPoseable, isText } from '@flatkit/engine/layers'
import { analyzeExpr } from '@flatkit/engine/expr'
import { forEachAction, forEachActionExpression, forEachItemExpression } from './docWalk'
import { languageCard } from './languageCard'
import { drawingCard } from './drawingCard'

/** Type label of a poseable (hence named) item. */
function kindLabel(doc: Doc, it: Group | Instance | Text | Image): string {
  if (isInstance(it)) { const s = getSymbol(doc, it.symbolId); return s ? `Instance:${s.name}` : 'Instance' }
  if (isText(it)) return 'Text'
  if (isImage(it)) return 'Image'
  return 'Symbol' // Group ("symbol" in the UI)
}

/**
 * A named scene object and the CONTRACT the logic places on it — what a host must honour to reskin the
 * scene without touching its behavior. Deliberately free of coordinates: the names and the roles are the
 * contract, the composition stays entirely the skin's business. (A contract that carried positions would
 * hand every reskin the same layout, which is exactly the failure it exists to prevent.)
 */
export type ManifestObject = {
  name: string
  kind: string
  /** Item events the logic handles on it (`click`, `drop`…) — the skin must keep them reachable. */
  events: ItemEvent[]
  /** A `drag`/`turn` interactor targets it: the pointer writes its position, so the skin must not pin it. */
  dragged: boolean
  /** A placement target: something drops on it, or it carries a `hitbox`. Keep the name and a generous box. */
  zone: boolean
  /** Channels the logic drives (bindings and modifier targets) — a skin that sets these fights the logic. */
  channels: string[]
  /** Document variables it reads: the game state a skin can hang its own visuals on. */
  reads: string[]
}

/** The program's STATE: every variable a skin could meaningfully bind to. Wider than `doc.variables`,
 *  which only holds the `var`-declared ones — a variable first assigned in a handler, or written by a
 *  `drag` interactor, is just as real at runtime and is often the most interesting one to bind. */
function stateVariables(doc: Doc): Set<string> {
  const out = new Set(Object.keys(doc.variables ?? {}))
  forEachAction(doc, (a) => {
    if (a.do === 'setVar' || a.do === 'setIndex') out.add(a.name)
    else if (a.do === 'repeatRange') out.add(a.var)
  })
  for (const i of doc.interactors ?? []) for (const v of [i.varX, i.varY, i.varT]) if (v) out.add(v)
  return out
}

/** State variables referenced by an expression — parsed, not grepped, so `open` never matches `reopen`
 *  and a name nested inside a call still counts. An unparseable expression yields nothing (the linter
 *  reports it; the manifest stays quiet). Runtime scalars (`time`, `mouse.x`) are not state and never
 *  appear: they are not something a host can set. */
function readsOf(expr: string, state: Set<string>, into: Set<string>): void {
  const a = analyzeExpr(expr)
  if (!a.ok) return
  for (const id of a.refs.ids) if (state.has(id)) into.add(id)
}

/** Named scene objects (groups included, library symbols excluded) with their binding contract; first
 *  name wins, and nested groups are walked. */
export function manifestObjects(doc: Doc): ManifestObject[] {
  const out: ManifestObject[] = []
  const seen = new Set<string>()
  const state = stateVariables(doc)
  const dropZones = new Set((doc.interactions ?? []).filter((i) => i.event === 'drop' && i.over).map((i) => i.over as string))
  const walk = (layers: Layer[]) => {
    for (const l of layers) for (const it of l.items) {
      if (isPoseable(it) && it.name && !seen.has(it.name)) {
        seen.add(it.name)
        const mine = (doc.interactions ?? []).filter((i) => i.targetId === it.id)
        const channels: string[] = []
        const reads = new Set<string>()
        forEachItemExpression(it, (expr, channel) => { channels.push(channel); readsOf(expr, state, reads) })
        for (const i of mine) forEachActionExpression(i.actions, (expr) => readsOf(expr, state, reads))
        out.push({
          name: it.name,
          kind: kindLabel(doc, it),
          events: [...new Set(mine.map((i) => i.event))],
          dragged: !!doc.interactors?.some((i) => i.targetId === it.id),
          zone: dropZones.has(it.name) || (isGroup(it) && !!it.hitbox),
          channels,
          reads: [...reads],
        })
      }
      if (isGroup(it)) walk(it.layers)
    }
  }
  walk(doc.layers)
  return out
}

/** The events the program EMITS to its host (`send "…"`), in order of first appearance, deduped. The
 *  other half of the contract: the moments a host — or a skin's motion pass — can react to. */
export function manifestEvents(doc: Doc): string[] {
  const events = new Set<string>()
  forEachAction(doc, (a) => { if (a.do === 'send') events.add(a.event) })
  return [...events]
}

/** One object's contract, as readable clauses. Empty = pure decor the skin owns outright. */
function contractParts(o: ManifestObject): string[] {
  const parts: string[] = []
  if (o.dragged) parts.push('drag')
  if (o.zone) parts.push('zone')
  if (o.events.length) parts.push(`on ${o.events.join('/')}`)
  if (o.channels.length) parts.push(`driven: ${o.channels.join(' ')}`)
  if (o.reads.length) parts.push(`reads: ${o.reads.join(' ')}`)
  return parts
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
  // The binding contract, for the objects that carry one — what a skin must honour. No positions: the
  // composition is the skin's to invent, which is precisely what keeps two scenes from looking alike.
  const contract = objs.map((o) => ({ o, parts: contractParts(o) })).filter(({ parts }) => parts.length)
  if (contract.length) {
    lines.push('contract (honour these; the layout is yours):')
    for (const { o, parts } of contract) lines.push(`  ${o.name} - ${parts.join(', ')}`)
  }
  const events = manifestEvents(doc)
  if (events.length) lines.push(`events: ${events.join(', ')}`)
  lines.push(`channels: ${EXPR_CHANNELS.join(' ')}  (additive offsets: ${OFFSET_CHANNELS.join(' ')} -> pos = at + d)`)
  return lines.join('\n')
}

/**
 * EVERYTHING a model needs to write a whole program: both language references (static) + the scene map
 * derived from the Doc. It is the bundle, not the map — if you only want the names this scene can
 * reference (because you already inject the references yourself), that is **`docToManifest(doc)`**, and
 * calling this instead ships the cards a second time.
 *
 * The DRAWING card is included by default. Handed the behavior card alone, a model asked for decor
 * invents a shapes grammar — and what it invents does not compile. Pass `{ drawing: false }` when the
 * model only edits behavior and the prompt budget is tight.
 */
export function llmContext(doc: Doc, opts: { drawing?: boolean } = {}): string {
  const cards = opts.drawing === false ? languageCard() : `${languageCard()}\n\n${drawingCard()}`
  return `${cards}\n\n${docToManifest(doc)}`
}
