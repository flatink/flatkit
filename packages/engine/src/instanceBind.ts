// ─────────────────────────────────────────────────────────────────────────────
//  instanceBind.ts — expansion of collective bindings `each "Symbol" as i { … }`.
//
//  An `each` rule (Timeline.binds) binds ALL the instances of a symbol in a scope to expressions
//  parameterized by a per-instance INDEX (document order). Rather than writing the binding on each
//  instance (verbose), it is declared once; here we EXPAND it: for the instance at index k, we substitute
//  the index variable with `k` in each channel expression and store the result in `instance.expressions`.
//  The player calls this on load (rendering then evaluates these expressions per frame, like any instance
//  expression).
//
//  PURE transform: does not mutate the input doc (withCels shares the instance objects) — it rebuilds the
//  layers cloning only the bound instances. No DOM.
// ─────────────────────────────────────────────────────────────────────────────
import type { Doc, Item, Layer } from '@flatkit/types'
import { isGroup, isInstance, getSymbol } from './layers'
import { BIND_CHANNELS, type InstanceBind } from './timeline'

const subst = (expr: string, asVar: string, idx: number): string => expr.replace(new RegExp(`\\b${asVar}\\b`, 'g'), String(idx))

function bindLayers(doc: Doc, layers: Layer[], binds: InstanceBind[] | undefined): Layer[] {
  if (!binds?.length) return layers
  const ruleByName = new Map(binds.map((b) => [b.symbol, b]))
  const counter = new Map<string, number>() // index per symbol (document order)
  const mapItems = (items: Item[]): Item[] =>
    items.map((it) => {
      if (isInstance(it)) {
        const name = getSymbol(doc, it.symbolId)?.name
        const rule = name ? ruleByName.get(name) : undefined
        if (rule && name) {
          const idx = counter.get(name) ?? 0
          counter.set(name, idx + 1)
          const expressions = { ...it.expressions }
          for (const ch of BIND_CHANNELS) if (rule.expr[ch]) expressions[ch] = subst(rule.expr[ch]!, rule.as, idx)
          return { ...it, expressions }
        }
        return it
      }
      if (isGroup(it)) return { ...it, layers: it.layers.map((l) => ({ ...l, items: mapItems(l.items) })) }
      return it
    })
  return layers.map((l) => ({ ...l, items: mapItems(l.items) }))
}

/** Expand the document's `each` rules (scene + each symbol) → per-instance expressions. Pure. */
export function applyInstanceBinds(doc: Doc): Doc {
  const sceneBinds = doc.timeline?.binds
  const hasSym = doc.symbols.some((s) => s.timeline?.binds?.length)
  if (!sceneBinds?.length && !hasSym) return doc // nothing to expand
  return {
    ...doc,
    layers: bindLayers(doc, doc.layers, sceneBinds),
    symbols: doc.symbols.map((s) => (s.timeline?.binds?.length ? { ...s, layers: bindLayers(doc, s.layers, s.timeline.binds) } : s)),
  }
}
