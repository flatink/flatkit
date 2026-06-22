// ─────────────────────────────────────────────────────────────────────────────
//  scriptDoc.ts — PURE bridge between the language (ScriptUnit) and the Doc model.
//
//  The code editor presents behavior as "files" (cf. explorer):
//   • an OBJECT → its click/enter/leave events + its channel bindings;
//   • the SCENE  → onLoad / onEnterFrame + frame-actions + markers (of a timeline);
//   • the GLOBALS → the variables (`let`).
//  This module converts each model fragment ⇄ ScriptUnit[], without depending on the
//  store nor the full Doc (just fragments) → pure and round-trip testable.
//  Text serialization happens via printUnits/parseUnits (dsl.ts).
// ─────────────────────────────────────────────────────────────────────────────
import type { Action, FrameAction, FrameLabel, Interaction, ItemEvent, FuncDef } from './actions'
import type { Interactor, ChannelModifier } from '@flatkit/types'
import { EXPR_CHANNELS, type ExprChannel, type Timeline, type InstanceBind } from './timeline'
import type { ScriptUnit } from './dsl'

const byFrame = <T extends { frame: number }>(xs: readonly T[]) => [...xs].sort((a, b) => a.frame - b.frame)

// ── OBJECT: interactor + item events + drop + channel bindings ────────────────
// `as const` → narrow type (excludes 'drop', handled separately) compatible with ScriptEvent.
const ITEM_EVENTS = ['click', 'enter', 'leave', 'press', 'release', 'drag', 'longpress'] as const
const ITEM_EVENT_SET: ReadonlySet<string> = new Set<string>(ITEM_EVENTS)

/** Interactor parameters of an object (without the targetId), as carried by the DSL unit. */
export type ObjectInteractor = Omit<Interactor, 'targetId'>

/** Model (interactor + interactions + expressions of an object) → units, in display order. */
export function objectToUnits(
  targetId: string,
  interactions: Interaction[] | undefined,
  expressions: Partial<Record<ExprChannel, string>> | undefined,
  interactors?: Interactor[],
  modifiers?: Partial<Record<ExprChannel, ChannelModifier>>,
): ScriptUnit[] {
  const units: ScriptUnit[] = []
  const drag = interactors?.find((i) => i.targetId === targetId)
  if (drag) units.push({ kind: 'interactor', axis: drag.axis, varX: drag.varX, varY: drag.varY, confine: drag.confine, grid: drag.grid, ...(drag.varT ? { varT: drag.varT } : {}), ...(drag.enabled ? { enabled: drag.enabled } : {}), ...(drag.pivot ? { pivot: drag.pivot } : {}) })
  for (const ev of ITEM_EVENTS) {
    const it = interactions?.find((i) => i.targetId === targetId && i.event === ev)
    if (it) units.push({ kind: 'event', event: ev, body: it.actions })
  }
  for (const it of interactions ?? []) if (it.targetId === targetId && it.event === 'drop' && it.over) units.push({ kind: 'drop', over: it.over, ...(it.atPointer ? { atPointer: true } : {}), body: it.actions })
  if (expressions) for (const ch of EXPR_CHANNELS) if (expressions[ch]) units.push({ kind: 'binding', channel: ch, expr: expressions[ch]! })
  if (modifiers) for (const ch of EXPR_CHANNELS) if (modifiers[ch]) units.push({ kind: 'modifier', channel: ch, modifier: modifiers[ch]! })
  return units
}

export type ObjectScript = {
  events: { event: ItemEvent; actions: Action[] }[]
  drops: { over: string; atPointer?: boolean; actions: Action[] }[]
  interactor?: ObjectInteractor
  expressions: Partial<Record<ExprChannel, string>>
  modifiers: Partial<Record<ExprChannel, ChannelModifier>>
}

/** Units → object fragment (interactor + events + drops + channel expressions). */
export function unitsToObject(units: ScriptUnit[]): ObjectScript {
  const events: { event: ItemEvent; actions: Action[] }[] = []
  const drops: { over: string; actions: Action[] }[] = []
  const expressions: Partial<Record<ExprChannel, string>> = {}
  const modifiers: Partial<Record<ExprChannel, ChannelModifier>> = {}
  let interactor: ObjectInteractor | undefined
  for (const u of units) {
    if (u.kind === 'event' && u.event !== 'load' && u.event !== 'enterFrame' && ITEM_EVENT_SET.has(u.event)) events.push({ event: u.event as ItemEvent, actions: u.body })
    else if (u.kind === 'drop') drops.push({ over: u.over, ...(u.atPointer ? { atPointer: true } : {}), actions: u.body })
    else if (u.kind === 'interactor') interactor = { axis: u.axis, varX: u.varX, varY: u.varY, confine: u.confine, grid: u.grid, ...(u.varT ? { varT: u.varT } : {}), ...(u.enabled ? { enabled: u.enabled } : {}), ...(u.pivot ? { pivot: u.pivot } : {}) }
    else if (u.kind === 'binding') expressions[u.channel] = u.expr
    else if (u.kind === 'modifier') modifiers[u.channel] = u.modifier
  }
  return { events, drops, interactor, expressions, modifiers }
}

// ── SCENE: scripts of a timeline (onLoad/onEnterFrame/frameActions/labels) ────
/** "Script" fields of a timeline → units. */
export function timelineToUnits(tl: Timeline | undefined): ScriptUnit[] {
  const units: ScriptUnit[] = []
  for (const b of tl?.binds ?? []) // collective bindings up front: each "Symbol" as i { … }
    units.push({ kind: 'each', symbol: b.symbol, as: b.as, bindings: EXPR_CHANNELS.filter((ch) => b.expr[ch]).map((ch) => ({ channel: ch, expr: b.expr[ch]! })) })
  if (tl?.onLoad?.length) units.push({ kind: 'event', event: 'load', body: tl.onLoad })
  if (tl?.onEnterFrame?.length) units.push({ kind: 'event', event: 'enterFrame', body: tl.onEnterFrame })
  for (const l of byFrame(tl?.labels ?? [])) units.push({ kind: 'label', frame: l.frame, name: l.name })
  for (const fa of byFrame(tl?.frameActions ?? [])) units.push({ kind: 'frameActions', frame: fa.frame, body: fa.actions })
  return units
}

export type TimelineScripts = { onLoad?: Action[]; onEnterFrame?: Action[]; frameActions?: FrameAction[]; labels?: FrameLabel[]; binds?: InstanceBind[] }

/** Units → "script" fields of a timeline (empty = undefined, store-style). */
export function unitsToTimeline(units: ScriptUnit[]): TimelineScripts {
  const out: TimelineScripts = {}
  const labels: FrameLabel[] = []
  const frameActions: FrameAction[] = []
  const binds: InstanceBind[] = []
  for (const u of units) {
    if (u.kind === 'event' && u.event === 'load') out.onLoad = u.body.length ? u.body : undefined
    else if (u.kind === 'event' && u.event === 'enterFrame') out.onEnterFrame = u.body.length ? u.body : undefined
    else if (u.kind === 'label') labels.push({ frame: u.frame, name: u.name })
    else if (u.kind === 'frameActions' && u.body.length) frameActions.push({ frame: u.frame, actions: u.body })
    else if (u.kind === 'each') binds.push({ symbol: u.symbol, as: u.as, expr: Object.fromEntries(u.bindings.map((b) => [b.channel, b.expr])) })
  }
  if (labels.length) out.labels = byFrame(labels)
  if (frameActions.length) out.frameActions = byFrame(frameActions)
  if (binds.length) out.binds = binds
  return out
}

// ── GLOBALS: variables ───────────────────────────────────────────────────────
/** Document variables → `let` units (insertion order). Scalar or array. */
export function variablesToUnits(vars: Record<string, number | number[]> | undefined): ScriptUnit[] {
  if (!vars) return []
  return Object.keys(vars).map((name) => ({ kind: 'declare', name, value: vars[name] }))
}

/** Units → variable table (scalar or array). */
export function unitsToVariables(units: ScriptUnit[]): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = {}
  for (const u of units) if (u.kind === 'declare') out[u.name] = u.value
  return out
}

// ── FUNCTIONS (global): fn name(params) = … · fn name(params) { … } ──────────
/** Document functions → `fn` units. */
export function functionsToUnits(funcs: FuncDef[] | undefined): ScriptUnit[] {
  return (funcs ?? []).map((f) => ({ kind: 'func', func: f }))
}

/** Units → list of functions. */
export function unitsToFunctions(units: ScriptUnit[]): FuncDef[] {
  const out: FuncDef[] = []
  for (const u of units) if (u.kind === 'func') out.push(u.func)
  return out
}

// ── IMPORTS (packages): use "…" ──────────────────────────────────────────────
/** Document imports → `use` units. */
export function importsToUnits(imports: string[] | undefined): ScriptUnit[] {
  return (imports ?? []).map((name) => ({ kind: 'use', name }))
}

/** Units → list of imports (order, deduplicated). */
export function unitsToImports(units: ScriptUnit[]): string[] {
  const out: string[] = []
  for (const u of units) if (u.kind === 'use' && !out.includes(u.name)) out.push(u.name)
  return out
}
