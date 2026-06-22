import { describe, it, expect } from 'vitest'
import { stepModifier, advanceModifier, restState, type ModState } from './channelModifiers'
import type { ChannelModifier } from '@flatkit/types'

const smooth = (k: number): ChannelModifier => ({ kind: 'smooth', target: '', k })
const spring = (stiffness: number, damping: number): ChannelModifier => ({ kind: 'spring', target: '', stiffness, damping })
const rest = (): ModState => ({ pos: 0, vel: 0 })

describe('channelModifiers — smooth (1st order lag)', () => {
  it('exponential approach: exact per-step values', () => {
    let s = rest()
    s = stepModifier(smooth(0.5), s, 10)
    expect(s.pos).toBe(5) //              0 + (10-0)*0.5
    s = stepModifier(smooth(0.5), s, 10)
    expect(s.pos).toBe(7.5) //            5 + (10-5)*0.5
  })

  it('converges to the target', () => {
    const s = advanceModifier(smooth(0.3), rest(), 10, 100)
    expect(s.pos).toBeCloseTo(10, 6)
  })

  it('k is clamped to [0,1]: k≥1 snaps in one step', () => {
    expect(stepModifier(smooth(2), rest(), 10).pos).toBe(10)
    expect(stepModifier(smooth(-1), rest(), 10).pos).toBe(0) // k≤0 → no movement
  })
})

describe('channelModifiers — spring (2nd order)', () => {
  it('underdamped spring OVERSHOOTS the target then settles', () => {
    const m = spring(0.1, 0.1)
    let s = rest()
    let maxPos = 0
    for (let i = 0; i < 400; i++) { s = stepModifier(m, s, 1); maxPos = Math.max(maxPos, s.pos) }
    expect(maxPos).toBeGreaterThan(1) // overshot the target (the "feel")
    expect(s.pos).toBeCloseTo(1, 3) //   settled on the target
    expect(s.vel).toBeCloseTo(0, 3)
  })

  it('is BOUNDED for extreme/invalid params (clamped, never diverges or NaNs)', () => {
    const s = advanceModifier(spring(10, -5), rest(), 1, 10000) // clamps to stiffness 1, damping 0 (undamped)
    expect(Number.isFinite(s.pos)).toBe(true)
    expect(Math.abs(s.pos)).toBeLessThan(100) // symplectic Euler keeps the undamped oscillator bounded
  })

  it('a non-finite target leaves the state unchanged (no NaN propagation)', () => {
    const s: ModState = { pos: 3, vel: 1 }
    expect(stepModifier(spring(0.2, 0.5), s, Number.NaN)).toBe(s)
  })
})

describe('channelModifiers — determinism & rest', () => {
  it('advancing N steps is deterministic (same inputs → same state)', () => {
    const a = advanceModifier(spring(0.08, 0.86), rest(), 1, 250)
    const b = advanceModifier(spring(0.08, 0.86), rest(), 1, 250)
    expect(a).toEqual(b)
  })

  it('restState sits exactly on the target (the random-access snap)', () => {
    expect(restState(42)).toEqual({ pos: 42, vel: 0 })
    expect(restState(Number.POSITIVE_INFINITY)).toEqual({ pos: 0, vel: 0 }) // non-finite → 0
  })
})
