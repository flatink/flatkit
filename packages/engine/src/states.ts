// ─────────────────────────────────────────────────────────────────────────────
//  states.ts — a symbol's exposed STATE MACHINE (P3). PURE.
//
//  A symbol declares named states (anchors on its own timeline). The exposed param holds a numeric
//  "state position": integer i = state i exactly; a fractional value plays the in-between animation by
//  driving the symbol's local playhead between the two bracketing anchors. So a producer sets
//  `door = open` (discrete) or animates `door` 0→1 (the authored open animation plays). This keeps a
//  state inside the ordinary variable/expression system — no bespoke per-instance runtime needed.
//
//  GOLDEN RULE: pure (functions of the value, no mutation) — reusable by the player and the compiler.
// ─────────────────────────────────────────────────────────────────────────────
import type { StateMachine } from '@flatkit/types'
export type { StateAnchor, StateMachine } from '@flatkit/types'

/** Numeric value (state position) of a state machine's initial state — the first state if unset. */
export function initialStateValue(sm: StateMachine): number {
  if (sm.states.length === 0) return 0
  if (sm.initial) {
    const i = sm.states.findIndex((s) => s.name === sm.initial)
    if (i >= 0) return i
  }
  return 0
}

/**
 * Resolve a value supplied for the param to a numeric state position. A state NAME → its index; a number
 * → itself (allows fractional/animated values); anything unknown → the initial state. Lets `door = open`,
 * `door = 1`, and `door = 0.5` all work.
 */
export function stateValueOf(sm: StateMachine, value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const i = sm.states.findIndex((s) => s.name === value)
    if (i >= 0) return i
    const n = Number(value)
    if (Number.isFinite(n) && value.trim() !== '') return n
  }
  return initialStateValue(sm)
}

/**
 * Local timeline frame for a state position. Integer i → anchor i's frame; a fractional position lerps
 * between the bracketing anchors' frames (so the symbol's authored in-between animation plays). The
 * position is clamped to [0, states-1].
 */
export function stateFrame(sm: StateMachine, value: number): number {
  const n = sm.states.length
  if (n === 0) return 0
  if (n === 1) return sm.states[0].frame
  const pos = Math.max(0, Math.min(n - 1, Number.isFinite(value) ? value : 0))
  const i = Math.floor(pos)
  if (i >= n - 1) return sm.states[n - 1].frame
  const t = pos - i
  return sm.states[i].frame + (sm.states[i + 1].frame - sm.states[i].frame) * t
}

/** Find the state machine on a symbol whose param matches `name` (or the first, if `name` is undefined). */
export function stateMachineByParam(machines: StateMachine[] | undefined, name?: string): StateMachine | undefined {
  if (!machines || machines.length === 0) return undefined
  if (!name) return machines[0]
  return machines.find((m) => m.param === name)
}
