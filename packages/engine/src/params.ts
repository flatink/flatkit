// ─────────────────────────────────────────────────────────────────────────────
//  params.ts — a symbol's exposed typed PARAMS (its public interface). PURE.
//
//  `color` params feed `fill <name>` (resolved per instance at render); `number`/`bool` params become
//  variables in the symbol's expression scope. Values come from (lowest→highest precedence): the param's
//  declared default, the instance call-site (`instance "Boat" { hull = #fff }`), then — for number/bool —
//  a runtime override (`Boat.wave = 1.5`, layered on by the player). State params (the `states` block)
//  also surface here as numeric scope values so internal expressions agree with the driven playhead.
// ─────────────────────────────────────────────────────────────────────────────
import type { SymbolDef, Instance, ParamDef, ExprContext } from '@flatkit/types'
import { stateValueOf, initialStateValue, stateFrame } from './states'
import { resolveInstanceFrame } from './timeline'
export type { ParamDef, ParamType } from '@flatkit/types'

export type ResolvedParams = { numeric: Record<string, number>; color: Record<string, string> }

/** Parse a number/bool param literal (call-site raw, else the declared default), clamped to range. */
function parseNumeric(def: ParamDef, raw: string | undefined): number {
  const v = (raw ?? def.default).trim()
  if (def.type === 'bool') return v === 'true' ? 1 : v === 'false' ? 0 : Number(v) ? 1 : 0
  const n = Number(v)
  let r = Number.isFinite(n) ? n : 0
  // Clamp only when the range is coherent (both bounds, min ≤ max) → an inverted/partial range is ignored.
  if (def.min != null && def.max != null && def.min <= def.max) r = Math.max(def.min, Math.min(def.max, r))
  return r
}

/**
 * Resolve an instance's exposed params (pure, from the doc): numeric (number/bool params + state initials,
 * overridden by call-site values) and color (color params, default or call-site). Runtime number/bool
 * overrides (player `paramRt`) are layered on TOP of `numeric` by the caller.
 */
export function resolveInstanceParams(sym: SymbolDef | undefined, inst: Pick<Instance, 'params'>): ResolvedParams {
  const numeric: Record<string, number> = {}
  const color: Record<string, string> = {}
  if (!sym) return { numeric, color }
  // State machines: seed the initial state value so internal expressions match the driven playhead.
  for (const sm of sym.states ?? []) {
    const raw = inst.params?.[sm.param]
    numeric[sm.param] = raw != null ? stateValueOf(sm, raw) : initialStateValue(sm)
  }
  // Declared params: color → the color map; number/bool → the numeric scope.
  for (const def of sym.params ?? []) {
    const raw = inst.params?.[def.name]
    if (def.type === 'color') color[def.name] = (raw ?? def.default).trim()
    else numeric[def.name] = parseNumeric(def, raw)
  }
  return { numeric, color }
}

/**
 * Static local frame of a FROZEN instance — the editor renders/sizes/hit-tests nested symbols frozen (their
 * internal timeline does not play while a parent scope is edited). But a STATE is a static CONFIGURATION
 * (a door posed "open"), not playback: a state-driven symbol freezes at its selected state's frame
 * (call-site value / initial), so the editor shows the door open. No states → 0 (the previous behavior).
 */
export function frozenInstanceFrame(sym: SymbolDef | undefined, inst: Pick<Instance, 'params'>): number {
  const sm = sym?.states?.[0]
  if (!sm) return 0
  return stateFrame(sm, resolveInstanceParams(sym, inst).numeric[sm.param] ?? initialStateValue(sm))
}

/** A sub-scope's POSE frame (where its cels resolve) and playback CLOCK (where its NESTED timelines tick).
 *  Equal in the ordinary case; a state machine DECOUPLES them. */
export type InstanceFrames = { pose: number; clock: number }

/**
 * Resolve an instance sub-scope's pose frame vs its playback clock (design (A), RFC states-vs-nested-loops).
 *
 * `parentClock` = the ADVANCING clock handed down by the scope above. In the ordinary case it equals the
 * parent's frame; once an ancestor symbol is state-PINNED, the parent's pose frame is frozen but its clock
 * keeps flowing — that flowing value is `parentClock`. The instance loops it within its own timeline →
 * `clock` (so its nested loops keep playing). `pose` is normally the same, EXCEPT a state machine pins it
 * to the selected state's frame: the symbol's own cels freeze on the state's pose while its sub-loops run.
 * That is what lets a state HOST a running loop / an idle without forcing every pose to move.
 *
 * `freeze` (the editor's `freezeNested`) keeps the historical behavior — nested timelines do not play, so
 * pose = clock = the frozen frame (a state-driven instance still freezes at its selected state's frame).
 */
export function instanceFrames(
  sym: SymbolDef | undefined,
  inst: Pick<Instance, 'playback' | 'params'>,
  parentClock: number,
  freeze = false,
  expr?: ExprContext,
): InstanceFrames {
  if (freeze) { const f = frozenInstanceFrame(sym, inst); return { pose: f, clock: f } }
  const clock = sym?.timeline ? resolveInstanceFrame(inst.playback, parentClock, sym.timeline.durationFrames) : parentClock
  const sm = sym?.states?.[0]
  if (!sm) return { pose: clock, clock } // no state → pose tracks the clock (ordinary nested playback)
  const raw = expr?.[sm.param]
  return { pose: stateFrame(sm, typeof raw === 'number' ? raw : initialStateValue(sm)), clock }
}

/** Default value of a single color param by name (for a render fallback when no instance override). */
export function colorParamDefault(sym: SymbolDef | undefined, name: string): string | undefined {
  const def = sym?.params?.find((p) => p.type === 'color' && p.name === name)
  return def?.default
}
