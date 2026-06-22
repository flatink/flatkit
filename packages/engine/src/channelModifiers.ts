// ─────────────────────────────────────────────────────────────────────────────
//  channelModifiers.ts — PURE integration kernel for stateful channel modifiers
//  (`smooth` / `spring`). ONE fixed step at a time; framerate-independence and
//  determinism come from the CALLER quantizing dt into whole steps (the player's
//  SIM_STEP). Coefficients are PER STEP — the `k` / `stiffness` / `damping` an
//  author writes are tuned at the fixed 60 Hz step. BOUNDED: params are clamped to
//  a stable range and a NaN/Infinity guard collapses to rest → it can never diverge
//  or hang. No I/O, no state outside the value passed in (testable in isolation).
// ─────────────────────────────────────────────────────────────────────────────
import type { ChannelModifier } from '@flatkit/types'

/** Integrator state for one (instance, channel). `vel` is unused by `smooth`. */
export type ModState = { pos: number; vel: number }

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** State at rest on `target` — the value at instance creation and on random access (the seek/render snap). */
export function restState(target: number): ModState {
  return { pos: Number.isFinite(target) ? target : 0, vel: 0 }
}

/** Advance ONE fixed step of `m` from `s` toward `target`. Pure; returns a fresh state.
 *  smooth: exponential approach `pos += (target - pos) * k`.
 *  spring: semi-implicit (symplectic) Euler — stable & bounded for the clamped param range. */
export function stepModifier(m: ChannelModifier, s: ModState, target: number): ModState {
  if (!Number.isFinite(target)) return s
  if (m.kind === 'smooth') {
    const k = clamp01(m.k)
    return { pos: s.pos + (target - s.pos) * k, vel: 0 }
  }
  const stiffness = clamp01(m.stiffness) // per-step; ≤ 1 keeps the symplectic scheme bounded even undamped
  const damping = clamp01(m.damping)
  const vel = s.vel * (1 - damping) + (target - s.pos) * stiffness
  const pos = s.pos + vel
  return Number.isFinite(pos) && Number.isFinite(vel) ? { pos, vel } : restState(target)
}

/** Advance `steps` fixed steps toward a constant `target` (sampled once per tick by the caller). */
export function advanceModifier(m: ChannelModifier, s: ModState, target: number, steps: number): ModState {
  let cur = s
  for (let i = 0; i < steps; i++) cur = stepModifier(m, cur, target)
  return cur
}
