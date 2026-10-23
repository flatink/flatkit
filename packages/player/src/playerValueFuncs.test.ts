// Value functions (`fn f(a) = expr`) called from a running scene. Reported from a tower-defense mini-game
// (flatink/flatink#71): each call copied the whole expression context (every variable) before setting its
// params, so a frame of ~150 `pulse()` calls over ~250 variables cost x5.5 the same frame written inline.
import { describe, it, expect } from 'vitest'
import { playHeadless } from './headless'
import { parseProgramFull } from '@flatkit/engine/flatFormat'
import type { Doc } from '@flatkit/types'

const program = (lines: string[]): Doc =>
  parseProgramFull(['size 100 100', 'scene { layer "c" { circle 50 50 10 fill #000000 } }', ...lines, ''].join('\n')) as unknown as Doc

describe('value functions in a running scene', () => {
  it('see their params first, then the variables, the clock and the other functions', () => {
    const doc = program([
      'let k = 10',
      'let a = 1000',
      'let out = 0',
      'let late = 0',
      'fn add(a, b) = a + b + k',
      'fn twice(a) = add(a, a)',
      'fn sees(x) = x + late',
      'every frame {',
      '  out = twice(3)',
      '  late = 5',
      '  t = sees(1)',
      '  f = frame',
      '  g = add(frame, 0) - k',
      '}',
    ])
    const { vars } = playHeadless(doc, [{ type: 'wait', frames: 3 }])
    expect(vars.out).toBe(16) // the param `a` shadows the variable `a` (1000), `k` comes from the scene
    expect(vars.t).toBe(6) // a variable written earlier in the same step is seen by the next call
    expect(vars.g).toBeCloseTo(vars.f as number, 9) // `frame` inside a function is the scene's frame
  })

  it('cost the same whatever the number of variables in the program', () => {
    // Same 200 calls per step, with 100 then 6000 extra variables. A copy of the context per call makes the
    // second ~60x slower; a call that only sets its params keeps the two within noise.
    const timed = (extra: number): number => {
      const doc = program([
        ...Array.from({ length: extra }, (_, i) => `let v${i} = ${i}`),
        'let s = 0',
        'fn pulse(t, d) = clamp(1 - (clock - t) / d, 0, 1)',
        'every frame {',
        '  repeat i from 0 to 199 { s = s + pulse(i / 100, 0.35) }',
        '}',
      ])
      playHeadless(doc, [{ type: 'wait', frames: 5 }]) // warm-up
      const t0 = performance.now()
      playHeadless(doc, [{ type: 'wait', frames: 40 }])
      return performance.now() - t0
    }
    const small = Math.min(timed(100), timed(100))
    const large = Math.min(timed(6000), timed(6000))
    expect(large / small).toBeLessThan(5)
  })
})
