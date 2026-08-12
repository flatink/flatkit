// ─────────────────────────────────────────────────────────────────────────────
//  docWalk.ts — walking the behavior of a Doc: every action, every expression.
//
//  A Doc scatters its logic across five places (item interactions, direct-manipulation interactors,
//  procedure bodies, the scene timeline's hooks, each symbol's timeline hooks) and its expressions
//  across two more (channel bindings and stateful modifier targets, at any depth in the group tree).
//  Anything that reasons about "what does this program read / write / emit" has to visit all of them,
//  and missing one is a silent hole. Collected here once so the linter and the manifest agree.
// ─────────────────────────────────────────────────────────────────────────────
import type { Action, Doc, Item, Layer } from '@flatkit/types'
import { isGroup, isPoseable, isRegion, isText } from '@flatkit/engine/layers'
import { EXPR_CHANNELS } from '@flatkit/engine/timeline'

/** Every action of a body, nested `if` / `repeat` bodies included. */
export function forEachActionIn(actions: Action[] | undefined, fn: (a: Action) => void): void {
  for (const a of actions ?? []) {
    fn(a)
    if (a.do === 'if') { forEachActionIn(a.then, fn); forEachActionIn(a.else, fn) }
    else if (a.do === 'repeat' || a.do === 'repeatRange') forEachActionIn(a.body, fn)
  }
}

/** Every ACTION of the Doc: item events, procedure bodies, and the load / enter-frame / at-frame hooks
 *  of the scene timeline and of every symbol's. */
export function forEachAction(doc: Doc, fn: (a: Action) => void): void {
  for (const i of doc.interactions ?? []) forEachActionIn(i.actions, fn)
  for (const f of doc.functions ?? []) if (f.kind === 'proc') forEachActionIn(f.body, fn)
  for (const t of [doc.timeline, ...(doc.symbols ?? []).map((s) => s.timeline)]) {
    if (!t) continue
    forEachActionIn(t.onLoad, fn)
    forEachActionIn(t.onEnterFrame, fn)
    for (const fa of t.frameActions ?? []) forEachActionIn(fa.actions, fn)
  }
}

/** Every expression an action carries: assigned values, conditions, loop bounds, call arguments, payloads. */
export function forEachActionExpression(actions: Action[] | undefined, fn: (expr: string) => void): void {
  forEachActionIn(actions, (a) => {
    if (a.do === 'setVar' || a.do === 'setParam') fn(a.value)
    else if (a.do === 'setIndex') { fn(a.value); fn(a.index) }
    else if (a.do === 'fillVar') { fn(a.count); fn(a.value) }
    else if (a.do === 'if') fn(a.cond)
    else if (a.do === 'repeat') fn(a.count)
    else if (a.do === 'repeatRange') { fn(a.from); fn(a.to) }
    else if (a.do === 'call') for (const arg of a.args) fn(arg)
    else if (a.do === 'send' && a.payload?.kind === 'expr') fn(a.payload.expr)
    else if (a.do === 'send' && a.payload?.kind === 'record') for (const f of a.payload.fields) fn(f.expr)
  })
}

/** The channel bindings and modifier targets carried by one item. */
export function forEachItemExpression(it: Item, fn: (expr: string, channel: string) => void): void {
  if (!isPoseable(it)) return
  if (it.expressions) for (const k of Object.keys(it.expressions)) { const e = it.expressions[k as keyof typeof it.expressions]; if (e) fn(e, k) }
  if (it.modifiers) for (const ch of EXPR_CHANNELS) { const m = it.modifiers[ch]; if (m) fn(m.target, ch) }
}

/**
 * The per-frame expressions a LEAF carries in its CONTENT rather than in a channel: a dynamic text's
 * `bind`, a text-on-path's animated `start`/`spacing`, a shape's `draw`/`from` stroke extent. They pose
 * nothing — so they are not channels, and `forEachItemExpression` (whose channel list is part of the
 * manifest contract) leaves them alone — but they READ variables every frame. Anything asking "what does
 * this program read" has to see them, or a variable used only by a `bind` reads as dead.
 */
export function forEachLeafExpression(it: Item, fn: (expr: string) => void): void {
  if (isText(it)) {
    if (it.bind) fn(it.bind)
    if (it.textPath?.startExpr) fn(it.textPath.startExpr)
    if (it.textPath?.spacingExpr) fn(it.textPath.spacingExpr)
    return
  }
  if (isRegion(it)) {
    if (it.drawExpr) fn(it.drawExpr)
    if (it.drawFromExpr) fn(it.drawFromExpr)
  }
}

/** Every EXPRESSION text of the Doc: channel bindings, modifier targets and leaf content expressions
 *  (scene + symbols, nested groups AND the material of animated layers included), plus everything the
 *  actions carry. */
export function forEachExpression(doc: Doc, fn: (expr: string) => void): void {
  const visit = (items: Item[]): void => {
    for (const it of items) {
      forEachItemExpression(it, (e) => fn(e))
      forEachLeafExpression(it, fn)
      if (isGroup(it)) for (const l of it.layers) { visit(l.items); visitCels(l) }
    }
  }
  // A cel (animated) layer keeps its material in the keyframes, not in `items` — a `draw "<expr>"` on a
  // shape that lives on such a layer is only reachable there.
  const visitCels = (l: Layer): void => { for (const c of l.cels ?? []) for (const r of c.matter ?? []) forEachLeafExpression(r, fn) }
  for (const l of doc.layers) { visit(l.items); visitCels(l) }
  for (const s of doc.symbols ?? []) for (const l of s.layers) { visit(l.items); visitCels(l) }
  for (const i of doc.interactions ?? []) forEachActionExpression(i.actions, fn)
  for (const f of doc.functions ?? []) if (f.kind === 'proc') forEachActionExpression(f.body, fn)
  for (const t of [doc.timeline, ...(doc.symbols ?? []).map((s) => s.timeline)]) {
    if (!t) continue
    forEachActionExpression(t.onLoad, fn)
    forEachActionExpression(t.onEnterFrame, fn)
    for (const fa of t.frameActions ?? []) forEachActionExpression(fa.actions, fn)
  }
}

/** Every named item of the scene tree, with the layers it owns. Positions are deliberately NOT part of
 *  this: what a host needs to honour is the set of NAMES, never where the file happens to place them. */
export function forEachNamedItem(layers: Layer[], fn: (it: Item) => void): void {
  for (const l of layers) for (const it of l.items) {
    fn(it)
    if (isGroup(it)) forEachNamedItem(it.layers, fn)
  }
}
