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
  // Found while triaging flatink/flatink#67: only the frame the playhead LANDS on was checked, so a frame
  // it stepped over (a 120 fps timeline stepped at 60 Hz, a 60 fps one on a 30 Hz display, a stalled
  // tab) never ran its script. Every whole frame crossed runs, in order, the loop wrap included.
  it('`at frame` runs for a frame the playhead steps OVER, too', () => {
    const src = (marks: string[]) => ['size 200 200', 'timeline 120 240', 'var seen = 0',
      'scene { layer "c" { group "G" at 100,100 { layer "a" { circle 0 0 10 fill #cc3333 } } } }',
      ...marks].join('\n')
    // Two frames per step: 30 is landed on, 31 is stepped over.
    expect(play(src(['at frame 30 { seen = seen + 1 }', 'at frame 31 { seen = seen + 10 }']), [{ type: 'wait', frames: 20 }]).seen).toBe(11)
    // Order is kept across a jump, and frames are not run twice.
    expect(play(src(['at frame 33 { seen = seen * 10 }', 'at frame 31 { seen = seen + 1 }']), [{ type: 'wait', frames: 20 }]).seen).toBe(10)
    // Across the loop: 239 is the last frame, 1 is stepped over after the wrap (240 -> 0, 2).
    expect(play(src(['at frame 239 { seen = seen + 1 }', 'at frame 1 { seen = seen + 10 }']), [{ type: 'wait', frames: 121 }]).seen).toBe(11 + 10)
    // A `go to` run by a stepped-over frame ends the walk: the playhead is elsewhere now.
    expect(play(src(['at frame 31 { go to frame 100 }', 'at frame 32 { seen = 1 }']), [{ type: 'wait', frames: 16 }]).seen).toBe(0)
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

// flatink/flatink#65, decided: a `repeat i from A to B` variable belongs to its loop. It used to leak into
// the document's variables (`--play` listed it, a host could read it) and overwrite a global of that name.
describe('a range loop variable is the loop\'s own', () => {
  const src = (head: string) => ['size 200 200', 'var s = 0', head,
    'scene { layer "c" { group "G" at 100,100 { layer "a" { circle 0 0 10 fill #cc3333 } } } }',
    'when loaded {', '  repeat i from 1 to 3 {', '    s = s + i', '  }', '}'].join('\n')
  it('it does not outlive the loop', () => {
    const v = play(src(''), [{ type: 'wait', frames: 1 }])
    expect(v.s).toBe(6)
    expect('i' in v).toBe(false)
  })
  it('a global of the same name gets its value back', () => {
    const v = play(src('var i = 7'), [{ type: 'wait', frames: 1 }])
    expect([v.s, v.i]).toEqual([6, 7])
  })
})

// flatink/flatink#62 — a compact `.flatpack` (default-valued fields left out) plays exactly like the full one:
// the player puts the defaults back on the way in. A missing `visible` used to read as a HIDDEN layer.
describe('a compact document plays like the full one', async () => {
  const { compactDoc } = await import('@flatkit/engine/validateDoc')
  const src = ['size 200 200', 'var hits = 0', 'var hidden = 0',
    'scene {', '  layer "c" {', '    group "B" at 100,100 { layer "a" { circle 0 0 30 fill #3366cc } }', '  }',
    '  layer "ghost" hidden {', '    group "G" at 20,20 { layer "a" { circle 0 0 15 fill #cc3333 } }', '  }', '}',
    'object "B" { when clicked { hits = hits + 1 } }', 'object "G" { when clicked { hidden = hidden + 1 } }'].join('\n')
  const g: Gesture[] = [{ type: 'tap', x: 100, y: 100 }, { type: 'tap', x: 20, y: 20 }, { type: 'tap', target: 'B' }]
  it('same variables, same events — and the hidden layer stays hidden', () => {
    const doc = parseProgramFull(src) as unknown as Doc
    const compact = JSON.parse(JSON.stringify(compactDoc(doc))) as Doc
    expect(JSON.stringify(compact)).not.toMatch(/"visible":true/)
    const a = playHeadless(doc, g), b = playHeadless(compact, g)
    expect(b.vars).toEqual(a.vars)
    expect(b.sends).toEqual(a.sends)
    expect(a.vars.hits).toBe(2)
  })
})

// Correctness pass over 0.41..0.43 — each reproduced first.
describe('review pass — the playhead and the frame walk', () => {
  const scene = 'scene { layer "c" { group "G" at 100,100 { layer "a" { circle 0 0 10 fill #cc3333 } } } }'
  it('a `pause` run by a STEPPED-OVER frame holds the playhead on that frame', () => {
    const src = ['size 200 200', 'timeline 120 240', 'var hit = -1', 'var f = -1', scene,
      'at frame 9 {', '  hit = frame', '  pause', '}', 'every frame { f = frame }'].join('\n')
    const v = play(src, [{ type: 'wait', frames: 20 }])
    expect(Math.floor(v.hit as number)).toBe(9)
    expect(Math.floor(v.f as number)).toBe(9)
  })
})
