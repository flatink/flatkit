import { describe, it, expect } from 'vitest'
import { playHeadless, type Gesture } from './headless'
import { simSteps } from './player'
import { parseProgramFull } from '@flatkit/engine/flatFormat'
import type { Doc } from '@flatkit/types'

// What `docs/behavior-and-interactions.md` says about HOW A FRAME RUNS (flatink/flatink#33 #34). The order
// was learnt by trial — "`when released` runs before `every frame`", "two gestures in one frame read a
// stale derived value" — and every activity computed its own `dt` from `clock`. These pin the facts the
// page states, so the page cannot drift from the player.
const play = (src: string, g: Gesture[], opts: { settle?: number } = {}) => playHeadless(parseProgramFull(src) as unknown as Doc, g, opts).vars

describe('the step: `every frame` is 60 Hz, whatever the timeline', () => {
  const SRC = (fps: number) => [
    `size 200 200`, `timeline ${fps} 3000`, 'var steps = 0', 'var t = 0', 'var c = 0', 'var f = 0',
    'scene { layer "c" { group "G" at 100,100 { layer "a" { circle 0 0 10 fill #cc3333 } } } }',
    'every frame {', '  steps = steps + 1', '  t = t + DT', '  c = clock', '  f = frame', '}',
  ].join('\n')

  it('`DT` is the step, in seconds: 1/60', () => {
    expect(play(SRC(24), [{ type: 'wait', frames: 1 }]).t).toBe(1 / 60)
  })
  for (const fps of [24, 30, 60]) {
    it(`timeline ${fps}: 60 steps are one second — \`DT\` sums to 1, \`clock\` reads 1, the playhead is at frame ${fps}`, () => {
      const v = play(SRC(fps), [{ type: 'wait', frames: 60 }])
      expect(v.steps).toBe(60)
      expect(v.t as number).toBeCloseTo(1, 9)
      expect(v.c as number).toBeCloseTo(1, 9)
      expect(v.f as number).toBeCloseTo(fps, 6)
    })
  }
  it('a slow display runs SEVERAL steps per picture, and a stall is not caught up', () => {
    const STEP = 1 / 60
    expect(simSteps(0, 1 / 30, STEP, 30).steps).toBe(2) // 30 pictures a second: two steps each
    expect(simSteps(0, 1 / 120, STEP, 30).steps).toBe(0) // 120 a second: a step every other picture…
    expect(simSteps(1 / 120, 1 / 120, STEP, 30).steps).toBe(1) // …the remainder is carried
    // The player hands in at most 0.25 s per picture (a tab that was in the background): 15 steps, not 600.
    expect(simSteps(0, 0.25, STEP, 30).steps).toBe(15)
    expect(simSteps(0, 5, STEP, 30)).toEqual({ steps: 30, acc: 0 }) // and never more than 30: the backlog is dropped
  })
})

describe('the order: handlers run when the event arrives, `every frame` at the next step', () => {
  // The reported program: a value derived in `every frame`, read by a handler.
  const SRC = [
    'size 200 200', 'var count = 0', 'var double = 0', 'var read = -1',
    'scene { layer "c" { group "B" at 100,100 { layer "a" { circle 0 0 40 fill #3366cc } } } }',
    'object "B" {', '  when released {', '    count = count + 1', '    read = double', '  }', '}',
    'every frame { double = count * 2 }',
  ].join('\n')
  const tap: Gesture = { type: 'tap', target: 'B' }

  it('a handler reads a derived value as the LAST step left it', () => {
    const v = play(SRC, [tap], { settle: 0 })
    expect(v.count).toBe(1)
    expect(v.read).toBe(0) // `double` has not been recomputed yet
    expect(v.double).toBe(0)
  })
  it('two events between two steps: the second sees what the first WROTE, not what `every frame` derives from it', () => {
    const v = play(SRC, [tap, tap], { settle: 0 })
    expect(v.count).toBe(2) // the handler's own write is there at once
    expect(v.read).toBe(0) // the derived value still is not
  })
  it('once a step has run, the derived value is there', () => {
    const v = play(SRC, [tap, { type: 'wait', frames: 1 }, tap], { settle: 0 })
    expect(v.read).toBe(2)
    expect(v.double).toBe(2) // …and the second tap is not derived yet
  })
  it('`at frame` scripts run after `every frame`, in the same step', () => {
    const src = ['size 200 200', 'timeline 60 600', 'var a = 0', 'var seen = -1',
      'scene { layer "c" { group "G" at 100,100 { layer "a" { circle 0 0 10 fill #cc3333 } } } }',
      'every frame { a = a + 1 }', 'at frame 3 { seen = a }'].join('\n')
    expect(play(src, [{ type: 'wait', frames: 3 }]).seen).toBe(3)
  })
  it('a channel binding is not a statement: it reads the variables whenever it is looked at', () => {
    const src = ['size 200 200', 'var px = 10',
      'scene { layer "c" { group "G" at 0,0 { layer "a" { circle 0 0 10 fill #cc3333 } }',
      '  group "H" at 0,0 { layer "a" { circle 0 0 10 fill #3366cc } } } }',
      'object "G" { x = px * 2 }', 'object "H" { when clicked { px = G.x } }'].join('\n')
    // `G.x` is read by a handler right after a `set`, with no step in between: it is already 2 * px.
    expect(play(src, [{ type: 'set', name: 'px', value: 50 }, { type: 'tap', x: 0, y: 0 }], { settle: 0 }).px).toBe(100)
  })
})
