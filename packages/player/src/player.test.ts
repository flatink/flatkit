import { describe, it, expect } from 'vitest'
import { simSteps, cloneVars } from './player'

// Simulates a playback of `seconds` at a refresh rate of `hz` and counts the total simulation steps
// run (fixed step = 1/60 s). The total must be ~independent of the refresh rate.
function totalSteps(hz: number, seconds: number, step = 1 / 60, max = 30) {
  const dt = 1 / hz
  let acc = 0, total = 0
  for (let t = 0; t < seconds * hz; t++) {
    const r = simSteps(acc, dt, step, max)
    acc = r.acc
    total += r.steps
  }
  return total
}

describe('simSteps -- fixed-step simulation (framerate-independent onEnterFrame)', () => {
  it('runs ~60 steps/second regardless of the refresh rate', () => {
    const target = 60 * 2 // 2 seconds
    for (const hz of [30, 60, 90, 120, 144, 165]) {
      const steps = totalSteps(hz, 2)
      expect(Math.abs(steps - target)).toBeLessThanOrEqual(2) // accumulator-remainder tolerance
    }
  })

  it('at 60 Hz: exactly one step per tick (reference behavior unchanged)', () => {
    let acc = 0
    for (let i = 0; i < 100; i++) {
      const r = simSteps(acc, 1 / 60, 1 / 60, 30)
      acc = r.acc
      expect(r.steps).toBe(1)
    }
  })

  it('at 30 Hz: two steps per tick (catch-up -> correct game speed)', () => {
    const r = simSteps(0, 1 / 30, 1 / 60, 30)
    expect(r.steps).toBe(2)
  })

  it('bounds the catch-up after a long pause (anti-spiral) and drops the backlog', () => {
    const r = simSteps(0, 5 /* seconds */, 1 / 60, 30)
    expect(r.steps).toBe(30) // capped
    expect(r.acc).toBe(0) // no accumulated debt
  })
})

describe('cloneVars -- the player does not mutate the source doc (regression: broken bricks that "stay")', () => {
  it('clones the arrays: mutating the player Map does not touch the original variables', () => {
    const docVars = { score: 0, bricks: [1, 1, 1, 1] }
    const vars = cloneVars(docVars)
    // the player does `set bricks[i] = 0` (in-place mutation)
    ;(vars.get('bricks') as number[])[1] = 0
    vars.set('score', 99)
    expect(docVars.bricks).toEqual([1, 1, 1, 1]) // original array INTACT
    expect(docVars.score).toBe(0) // original scalar intact
    expect(vars.get('bricks')).toEqual([1, 0, 1, 1]) // the player's copy, however, has changed
  })
})
