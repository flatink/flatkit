import { describe, it, expect } from 'vitest'
import { playHeadless, type Gesture } from './headless'
import { parseProgramFull } from '@flatkit/engine/flatFormat'
import type { Doc, Layer, Text } from '@flatkit/types'
import type { Action } from '@flatkit/engine/actions'
import { IDENTITY, translation } from '@flatkit/engine/transform'

const piece = (): Text => ({
  id: 'Piece', kind: 'text', name: 'Piece', transform: IDENTITY, content: 'x',
  font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.25, color: '#000', box: { w: 100, h: 100 },
})

describe('headless -- playHeadless', () => {
  it('replays press/drag/release without a canvas, collects sends + vars', () => {
    const pc = { ...piece(), expressions: { x: 'px', y: 'py' } as Record<string, string> }
    const send: Action = { do: 'send', event: 'done' }
    const doc: Doc = {
      width: 100, height: 100, symbols: [], variables: { px: 0, py: 0 },
      layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [pc] } as Layer],
      interactors: [{ targetId: 'Piece', axis: 'xy', varX: 'px', varY: 'py' }],
      interactions: [{ id: 'r', targetId: 'Piece', event: 'release', actions: [send] }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const gestures: Gesture[] = [
      { type: 'down', x: 5, y: 5 },
      { type: 'move', x: 40, y: 30 },
      { type: 'up', x: 40, y: 30 },
    ]
    const res = playHeadless(doc, gestures)
    expect(res.vars.px).toBe(35) // 40 + offset -5
    expect(res.vars.py).toBe(25)
    expect(res.sends).toEqual([{ name: 'done' }])
  })

  it('expect: self-verifies sends (window since the last expect) + vars, reports mismatches', () => {
    const pc = { ...piece(), expressions: { x: 'px', y: 'py' } as Record<string, string> }
    const send: Action = { do: 'send', event: 'done' }
    const doc: Doc = {
      width: 100, height: 100, symbols: [], variables: { px: 0, py: 0 },
      layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [pc] } as Layer],
      interactors: [{ targetId: 'Piece', axis: 'xy', varX: 'px', varY: 'py' }],
      interactions: [{ id: 'r', targetId: 'Piece', event: 'release', actions: [send] }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    // all conforming (release emits "done", no move -> px/py stay 0) -> no failure
    const ok = playHeadless(doc, [
      { type: 'down', x: 5, y: 5 }, { type: 'up', x: 5, y: 5 },
      { type: 'expect', sends: ['done'], vars: { px: 0, py: 0 } },
    ])
    expect(ok.expectFailures).toBeUndefined()
    // expected sends empty but "done" emitted + px wrong -> 2 mismatches
    const ko = playHeadless(doc, [
      { type: 'down', x: 5, y: 5 }, { type: 'up', x: 5, y: 5 },
      { type: 'expect', sends: [], vars: { px: 999 } },
    ])
    expect(ko.expectFailures).toHaveLength(2)
  })

  it('turn: rotates a turnDeg target by the given angle (writes the bound var in degrees)', () => {
    const doc: Doc = {
      width: 100, height: 100, symbols: [], variables: { ang: 0 },
      layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [piece()] } as Layer],
      interactors: [{ targetId: 'Piece', axis: 'turnDeg', varX: 'ang', pivot: { x: 50, y: 50 } }],
      interactions: [],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    expect((playHeadless(doc, [{ type: 'turn', target: 'Piece', angle: 90 }]).vars.ang as number)).toBeCloseTo(90, 4)
    expect((playHeadless(doc, [{ type: 'turn', target: 'Piece', angle: -90 }]).vars.ang as number)).toBeCloseTo(-90, 4)
  })

  it('keypad (parametric symbols + each->handlers): tapping keys accumulates the input', () => {
    const src = [
      'symbol "Key"(label) {',
      '  layer "c" {',
      '    rect -28 -28 56 56 fill #e8e8e8',
      '    text "$(label)" font "sans-serif" size 28 align center line 1.2 color #111111 box 56 56',
      '  }',
      '}',
      'size 300 360', 'var input = 0', 'scene { layer "Pad" {',
      '  repeat i from 0 to 8 { instance "Key"($(i+1)) as "T$(i)" at $(70 + (i%3)*80),$(80 + floor(i/3)*80) }',
      '} }', '',
      'each "Key" as i { when clicked { input = input * 10 + (i + 1) } }',
    ].join('\n')
    const doc = parseProgramFull(src) as Doc
    const res = playHeadless(doc, [
      { type: 'tap', target: 'T0' }, // i=0 -> +1
      { type: 'tap', target: 'T4' }, // i=4 -> *10 +5
      { type: 'tap', target: 'T2' }, // i=2 -> *10 +3
      { type: 'expect', vars: { input: 153 } },
    ])
    expect(res.vars.input).toBe(153)
    expect(res.expectFailures).toBeUndefined()
  })

  it('the `wait` gesture advances the simulation (`every frame`) at a fixed 60 Hz step', () => {
    const doc: Doc = {
      width: 100, height: 100, symbols: [], variables: { t: 0 },
      layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [piece()] } as Layer],
      timeline: { fps: 24, durationFrames: 120, tracks: [], onEnterFrame: [{ do: 'setVar', name: 't', value: 't + 1' } as Action] },
    }
    const res = playHeadless(doc, [{ type: 'wait', frames: 10 }])
    expect(res.vars.t).toBe(10) // 10 sim steps = 10 runs of `every frame`
  })

  it('`clock` is monotone (never wraps) while `time` resets at durationFrames', () => {
    const doc: Doc = {
      width: 100, height: 100, symbols: [], variables: { mono: 0, wrap: 0 },
      layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [piece()] } as Layer],
      // default-ish short loop: 60 frames @24fps = 2.5 s
      timeline: { fps: 24, durationFrames: 60, tracks: [], onEnterFrame: [
        { do: 'setVar', name: 'mono', value: 'clock' } as Action,
        { do: 'setVar', name: 'wrap', value: 'time' } as Action,
      ] },
    }
    const res = playHeadless(doc, [{ type: 'wait', frames: 200 }]) // 200 sim steps = 80 frames > 60 → loop wrapped
    expect(res.vars.mono as number).toBeCloseTo(80 / 24, 5) // clock kept accumulating (3.33 s)
    expect(res.vars.wrap as number).toBeCloseTo(20 / 24, 5) // time wrapped back (0.83 s)
    expect(res.vars.mono as number).toBeGreaterThan(res.vars.wrap as number)
  })

  it('per-frame exprCtx cache keeps intra-frame var mutations live (sequential deps + named ref)', () => {
    // b reads `a` set EARLIER the same frame; c reads b. A stale cached context would freeze `a` at its
    // start-of-frame value and break b/c. gx reads a named object (the per-frame-memoized named channels).
    const doc = parseProgramFull([
      'size 200 200', 'var a = 0', 'var b = 0', 'var c = 0', 'var gx = 0',
      'scene { layer "L" { group "G" at 37,0 { layer "c" { circle 0 0 4 fill #ff0000 } } } }',
      'every frame {', '  a = a + 1', '  b = a * 2', '  c = b + a', '  gx = G.x', '}',
    ].join('\n')) as unknown as Doc
    const res = playHeadless(doc, [{ type: 'wait', frames: 5 }])
    expect(res.vars).toMatchObject({ a: 5, b: 10, c: 15, gx: 37 })
  })

  it('ctx cache write-through stays correct through a loop + setIndex + array read-back', () => {
    // `grid[i] = …` (setIndex, array mutated in place) inside a `repeat` (loop var via setVar), then the
    // array is READ BACK the same frame. A stale write-through would desync the loop var or the array.
    const doc = parseProgramFull([
      'size 100 100', 'var grid = [0, 0, 0]', 'var sum = 0', 'var last = 0',
      'scene { layer "L" { circle 50 50 5 fill #ff0000 } }',
      'every frame {',
      '  repeat i from 0 to 2 {', '    grid[i] = i * 10', '    last = i', '  }',
      '  sum = grid[0] + grid[1] + grid[2]',
      '}',
    ].join('\n')) as unknown as Doc
    const res = playHeadless(doc, [{ type: 'wait', frames: 3 }])
    expect(res.vars.grid).toEqual([0, 10, 20]) // setIndex visible
    expect(res.vars.sum).toBe(30) // array read back in the same frame sees the writes
    expect(res.vars.last).toBe(2) // loop var (setVar write-through) tracked
  })

  it('the `set` gesture drives a variable (unlocks an enabled drag)', () => {
    const pc = { ...piece(), expressions: { x: 'px', y: 'py' } as Record<string, string> }
    const doc: Doc = {
      width: 100, height: 100, symbols: [], variables: { px: 0, py: 0, unlocked: 0 },
      layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [pc] } as Layer],
      interactors: [{ targetId: 'Piece', axis: 'xy', varX: 'px', varY: 'py', enabled: 'unlocked' }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const locked = playHeadless(doc, [{ type: 'down', x: 5, y: 5 }, { type: 'move', x: 40, y: 40 }, { type: 'up', x: 40, y: 40 }])
    expect(locked.vars.px).toBe(0) // locked
    const unlocked = playHeadless(doc, [{ type: 'set', name: 'unlocked', value: 1 }, { type: 'down', x: 5, y: 5 }, { type: 'move', x: 40, y: 40 }, { type: 'up', x: 40, y: 40 }])
    expect(unlocked.vars.px).toBe(35) // unlocked -> follows the pointer
  })
})

describe('headless -- semantic gestures (drag/tap by name)', () => {
  const send = (event: string): Action => ({ do: 'send', event })
  // Draggable card positioned by EXPRESSIONS (cx,cy) -- its real position (100,100) != its transform (0,0).
  const card = (): Text => ({
    id: 'Card', kind: 'text', name: 'Card', transform: IDENTITY, content: 'C',
    font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.25, color: '#000', box: { w: 40, h: 40 },
    expressions: { x: 'cx', y: 'cy' },
  })
  const mkDoc = (over: string): Doc => ({
    width: 500, height: 400, symbols: [], variables: { cx: 100, cy: 100 },
    layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [
      card(),
      { id: 'Target', kind: 'group', name: 'Target', transform: { a: 1, b: 0, c: 0, d: 1, e: 300, f: 300 }, hitbox: { w: 80, h: 80 }, layers: [] } as never,
      { id: 'Trap', kind: 'group', name: 'Trap', transform: { a: 1, b: 0, c: 0, d: 1, e: 120, f: 300 }, hitbox: { w: 80, h: 80 }, layers: [] } as never,
    ] } as Layer],
    interactors: [{ targetId: 'Card', axis: 'xy', varX: 'cx', varY: 'cy' }],
    interactions: [{ id: 'd', targetId: 'Card', event: 'drop', over, atPointer: true, actions: [send('ok')] }],
    timeline: { fps: 24, durationFrames: 1, tracks: [] },
  })

  it('drag source->target resolves the centers and fires the drop', () => {
    const res = playHeadless(mkDoc('Target'), [{ type: 'drag', source: 'Card', target: 'Target' }])
    expect(res.sends).toEqual([{ name: 'ok' }])
    expect(res.vars.cx).toBe(300) // the card did end up at the center of the target
    expect(res.vars.cy).toBe(300)
  })

  it('dragging onto ANOTHER zone does not fire the targeted drop', () => {
    const res = playHeadless(mkDoc('Target'), [{ type: 'drag', source: 'Card', target: 'Trap' }])
    expect(res.sends).toEqual([]) // dropped on Trap, not on Target
  })

  it('object not found -> clear error', () => {
    expect(() => playHeadless(mkDoc('Target'), [{ type: 'drag', source: 'Ghost', target: 'Target' }]))
      .toThrow(/Ghost.*not found/)
  })
})

describe('headless -- match (runtime) + tap, via semantic gestures', () => {
  const matchProg = [
    'size 600 400', 'var Word1_x = 80', 'var Word1_y = 60',
    'scene {', '  layer "L" {',
    '    group "Word1" at 80,60 { layer "c" { circle 0 0 24 fill #ff3366 } }',
    '    group "Good" at 200,320 hitbox 120 90 { layer "c" { circle 0 0 6 fill #888888 } }',
    '    group "Bad" at 420,320 hitbox 120 90 { layer "c" { circle 0 0 6 fill #888888 } }',
    '  }', '}',
    'match Word1 onto Good, Bad {', '  correct Word1 -> Good',
    '  on correct as it { send "found" }', '  on done { send "win" }', '}',
    'object "Word1" {', '  x = Word1_placed == 1 ? Good.x : Word1_x', '  y = Word1_placed == 1 ? Good.y : Word1_y', '}',
  ].join('\n')

  it('drag onto the CORRECT zone -> events + placed state; the generated drag is active from the start (uninitialized var)', () => {
    const doc = parseProgramFull(matchProg) as unknown as Doc
    const res = playHeadless(doc, [{ type: 'drag', source: 'Word1', target: 'Good' }])
    expect(res.sends.map((s) => s.name)).toEqual(['found', 'win'])
    expect(res.vars.Word1_placed).toBe(1)
    expect(res.vars.Word1_ok).toBe(1)
  })
  it('drag onto the WRONG zone -> no event, retryable (no lock)', () => {
    const doc = parseProgramFull(matchProg) as unknown as Doc
    const res = playHeadless(doc, [{ type: 'drag', source: 'Word1', target: 'Bad' }])
    expect(res.sends).toEqual([])
    expect(res.vars.Word1_ok).toBe(0)
    expect(res.vars.Word1_placed).toBeUndefined() // not locked -> replayable
  })
  it('tap target -> click on the named object', () => {
    const doc = parseProgramFull([
      'size 200 200', 'scene {', '  layer "L" {',
      '    group "Button" at 100,100 { layer "c" { circle 0 0 30 fill #00aaff } }',
      '  }', '}',
      'object "Button" {', '  when clicked { send "click" }', '}',
    ].join('\n')) as unknown as Doc
    const res = playHeadless(doc, [{ type: 'tap', target: 'Button' }])
    expect(res.sends.map((s) => s.name)).toEqual(['click'])
  })
})

describe('headless -- trace (inspection per gesture)', () => {
  it('returns one step per gesture with sends + variable diff', () => {
    const doc = parseProgramFull([
      'size 200 200', 'var n = 0', 'scene {', '  layer "L" {',
      '    group "B" at 100,100 { layer "c" { circle 0 0 30 fill #00aaff } }',
      '  }', '}',
      'object "B" {', '  when clicked { n = n + 1', '    send "click", n', '  }', '}',
    ].join('\n')) as unknown as Doc
    const res = playHeadless(doc, [{ type: 'tap', target: 'B' }, { type: 'tap', target: 'B' }], { trace: true })
    expect(res.steps).toHaveLength(2)
    expect(res.steps![0].gesture).toBe('tap B')
    expect(res.steps![0].sends).toEqual([{ name: 'click', value: 1 }])
    expect(res.steps![0].changed.n).toEqual([0, 1])
    expect(res.steps![1].changed.n).toEqual([1, 2])
  })
  it('without trace: no steps', () => {
    const doc: Doc = { width: 100, height: 100, symbols: [], layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [] }] }
    expect(playHeadless(doc, [{ type: 'wait', frames: 1 }]).steps).toBeUndefined()
  })
})

describe('headless -- scratch / connect (semantic gestures for reveal/link)', () => {
  it('scratch sweeps a reveal target so its coverage reaches ~1', () => {
    const pc: Text = { ...piece(), box: { w: 40, h: 40 } } // 2x2 grid with brush 20
    const doc: Doc = {
      width: 100, height: 100, symbols: [], variables: { seen: 0 },
      layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [pc] } as Layer],
      interactors: [{ targetId: 'Piece', axis: 'reveal', varX: 'seen', grid: 20 }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const res = playHeadless(doc, [{ type: 'scratch', target: 'Piece' }, { type: 'expect', vars: { seen: 1 } }])
    expect(res.vars.seen).toBe(1) // the whole zone is covered by the synthesized sweep
    expect(res.expectFailures).toBeUndefined()
  })

  it('scratch on a huge target with a fine brush stays bounded (completes)', () => {
    const pc: Text = { ...piece(), box: { w: 5000, h: 5000 } }
    const doc: Doc = {
      width: 5000, height: 5000, symbols: [], variables: { seen: 0 },
      layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [pc] } as Layer],
      interactors: [{ targetId: 'Piece', axis: 'reveal', varX: 'seen', grid: 2 }], // 2500x2500 cells → capped sweep
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const res = playHeadless(doc, [{ type: 'scratch', target: 'Piece' }]) // must not hang (MAX_SWEEP)
    expect(res.vars.seen as number).toBeGreaterThanOrEqual(0)
    expect(res.vars.seen as number).toBeLessThanOrEqual(1)
  })

  const mkText = (id: string, x: number, y: number, s = 20): Text => ({
    id, kind: 'text', name: id, transform: translation(x, y), content: 'x',
    font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.25, color: '#000', box: { w: s, h: s },
  })

  it('connect pulls a link wire source -> target and resolves the target index', () => {
    const b = mkText('B', 70, 70) // bbox 70..90
    const targets = { id: 'Targets', kind: 'group', name: 'Targets', transform: IDENTITY, layers: [{ id: 'cl', name: 'c', visible: true, locked: false, opacity: 1, items: [b] }] } as never
    const source = mkText('Source', 0, 0)
    const doc: Doc = {
      width: 100, height: 100, symbols: [], variables: { ex: 0, ey: 0, target: 0 },
      layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [targets, source] } as Layer],
      interactors: [{ targetId: 'Source', axis: 'link', varX: 'ex', varY: 'ey', varT: 'target', confine: 'Targets' }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const res = playHeadless(doc, [{ type: 'connect', source: 'Source', target: 'B' }, { type: 'expect', vars: { target: 1 } }])
    expect(res.vars.target).toBe(1) // B is the 1st (only) target
    expect(res.expectFailures).toBeUndefined()
  })

  // `{ enabled … }` gates the GESTURE, not the handler: `when released` keeps firing once the link is off.
  // The target index used to keep the LAST resolved value, so a handler gated on `target == 1` re-ran on
  // every further press — an activity could finish with pairs it never actually connected.
  it('a link gated OFF resolves to target 0, never the previous gesture\'s index', () => {
    const b = mkText('B', 70, 70)
    const targets = { id: 'Targets', kind: 'group', name: 'Targets', transform: IDENTITY, layers: [{ id: 'cl', name: 'c', visible: true, locked: false, opacity: 1, items: [b] }] } as never
    const source = mkText('Source', 0, 0)
    const doc: Doc = {
      width: 100, height: 100, symbols: [], variables: { ex: 0, ey: 0, target: 0, done: 0, linked: 0 },
      layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [targets, source] } as Layer],
      interactors: [{ targetId: 'Source', axis: 'link', varX: 'ex', varY: 'ey', varT: 'target', confine: 'Targets', enabled: 'done == 0' }],
      interactions: [{ id: 'i1', targetId: 'Source', event: 'release', actions: [
        { do: 'if', cond: 'target == 1', then: [{ do: 'setVar', name: 'done', value: '1' }, { do: 'setVar', name: 'linked', value: 'linked + 1' }] },
      ] }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const res = playHeadless(doc, Array(3).fill({ type: 'connect', source: 'Source', target: 'B' }))
    expect(res.vars.linked).toBe(1) // counted ONCE, not once per release
    expect(res.vars.target).toBe(0) // the gated-off releases reached nothing
  })

  // Keyboard replay: the `key` gesture is the only way to exercise `keys.<Name>` without a browser.
  it('key holds a key for N sim frames, then releases it', () => {
    const doc: Doc = {
      width: 100, height: 100, symbols: [], variables: { px: 0, ticks: 0 },
      layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [] } as Layer],
      timeline: { fps: 24, durationFrames: 48, tracks: [], onEnterFrame: [
        { do: 'setVar', name: 'px', value: 'px + keys.ArrowRight * 2' },
        { do: 'setVar', name: 'ticks', value: 'ticks + 1' },
      ] },
    }
    const res = playHeadless(doc, [
      { type: 'key', name: 'ArrowRight', frames: 5 }, // held for 5 steps -> +2 each
      { type: 'wait', frames: 3 }, // released: the extra steps add nothing
      { type: 'expect', vars: { px: 10, ticks: 8 } },
    ])
    expect(res.vars.px).toBe(10)
    expect(res.expectFailures).toBeUndefined()
  })

  it('key defaults to a single frame, and the trace names it', () => {
    const doc: Doc = {
      width: 100, height: 100, symbols: [], variables: { px: 0 },
      layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [] } as Layer],
      timeline: { fps: 24, durationFrames: 48, tracks: [], onEnterFrame: [{ do: 'setVar', name: 'px', value: 'px + keys.Space' }] },
    }
    const res = playHeadless(doc, [{ type: 'key', name: 'Space' }], { trace: true })
    expect(res.vars.px).toBe(1)
    expect(res.steps?.[0].gesture).toBe('key Space')
  })

  it('connect to a missing target -> clear error', () => {
    const source = mkText('Source', 0, 0)
    const doc: Doc = {
      width: 100, height: 100, symbols: [], variables: {},
      layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [source] } as Layer],
      interactors: [{ targetId: 'Source', axis: 'link', varT: 'target' }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    expect(() => playHeadless(doc, [{ type: 'connect', source: 'Source', target: 'Ghost' }])).toThrow(/Ghost.*not found/)
  })
})

// `reveal … cells <array>`: the grid BEHIND the fraction — WHERE the finger passed, so the author can draw
// the cleared zone instead of recomputing it beside the interactor.
describe('headless -- reveal cells (the scratched grid)', () => {
  // A 100x100 veil at 50,50 → world 0..100; brush 25 → a 4x4 grid, cell centers at 12.5 / 37.5 / 62.5 / 87.5.
  // A pointer in a corner of the zone is within the brush of exactly ONE cell center → unambiguous indices.
  const veilProgram = (cellBody: string) => [
    'size 200 200', 'var covered = 0', 'var grid = fill(16, 0)',
    'scene {', '  layer "L" {',
    `    group "Veil" at 50,50 { layer "c" { ${cellBody} } }`,
    '  }', '}', '',
    'object "Veil" {', '  reveal covered {', '    brush 25', '    cells grid', '  }', '}',
  ].join('\n')
  const cleared = (grid: unknown) => (grid as number[]).flatMap((v, i) => (v ? [i] : []))

  it('writes 1 where the brush passed, indexed row * cols + col', () => {
    const doc = parseProgramFull(veilProgram('rect -50 -50 100 100 fill #999999')) as unknown as Doc
    const res = playHeadless(doc, [
      { type: 'down', x: 1, y: 1 },
      { type: 'move', x: 1, y: 1 }, // top-left corner → cell (0,0) = index 0
      { type: 'move', x: 99, y: 1 }, // top-right → cell (0,3) = index 3
      { type: 'move', x: 1, y: 99 }, // bottom-left → cell (3,0) = index 12
      { type: 'up', x: 1, y: 99 },
    ])
    expect(cleared(res.vars.grid)).toEqual([0, 3, 12])
    expect(res.vars.covered).toBeCloseTo(3 / 16, 6) // the fraction agrees with the grid
  })

  it('accumulates across strokes, and a cleared cell is never written back to 0 (monotone, like the fraction)', () => {
    const doc = parseProgramFull(veilProgram('rect -50 -50 100 100 fill #999999')) as unknown as Doc
    const res = playHeadless(doc, [
      { type: 'down', x: 1, y: 1 }, { type: 'move', x: 1, y: 1 }, { type: 'up', x: 1, y: 1 },
      { type: 'down', x: 99, y: 99 }, { type: 'move', x: 99, y: 99 }, { type: 'up', x: 99, y: 99 },
    ])
    expect(cleared(res.vars.grid)).toEqual([0, 15]) // the first stroke's cell survived the second grab
    expect(res.vars.covered).toBeCloseTo(2 / 16, 6)
  })

  it('a grid declared too SHORT drops the writes past its end instead of throwing (--check states the size)', () => {
    const doc = parseProgramFull(veilProgram('rect -50 -50 100 100 fill #999999').replace('fill(16, 0)', 'fill(2, 0)')) as unknown as Doc
    const res = playHeadless(doc, [{ type: 'down', x: 99, y: 99 }, { type: 'move', x: 99, y: 99 }, { type: 'up', x: 99, y: 99 }])
    expect(res.vars.grid).toEqual([0, 0]) // index 15 is past the end — dropped, gesture unharmed
    expect(res.vars.covered).toBeCloseTo(1 / 16, 6) // the fraction still counts it
  })

  it('the grid is re-synced with the coverage when a grab starts (the two can never disagree)', () => {
    // The array is writable from the scene, the coverage is monotone and has no reset — so a scene that
    // zeroes a slot would otherwise show an intact cell over a zone the interactor counts as cleared.
    // Zeroed ONCE, after the first stroke (the guard), and restored when the next grab opens.
    const doc = parseProgramFull(veilProgram('rect -50 -50 100 100 fill #999999')
      .replace('var covered = 0', 'var covered = 0\nvar wiped = 0')
      .replace('object "Veil" {', ['object "Veil" {', '  when released {', '    if wiped < 0.5 {', '      wiped = 1', '      grid[0] = 0', '    }', '  }'].join('\n'))) as unknown as Doc
    const res = playHeadless(doc, [
      { type: 'down', x: 1, y: 1 }, { type: 'move', x: 1, y: 1 }, { type: 'up', x: 1, y: 1 }, // clears cell 0, the handler zeroes the slot…
      { type: 'down', x: 99, y: 99 }, { type: 'move', x: 99, y: 99 }, { type: 'up', x: 99, y: 99 },
    ])
    expect(cleared(res.vars.grid)).toEqual([0, 15]) // …and the next grab restored it from the coverage
  })

  it('the veil stays grabbable where it has already been erased (the gesture does not stall)', () => {
    // The cells ARE the grid: each fades out as it is cleared (`opacity = 1 - grid[i]`), which is the whole
    // point of `cells` — and an item at opacity 0 lets the pointer through. The second stroke STARTS on an
    // already-cleared cell: without the reveal ZONE it would grab nothing and the scratching would stop
    // dead, on a scene that looks perfectly normal.
    const at = (i: number) => ({ x: -50 + (i % 4) * 25 + 12.5, y: -50 + Math.floor(i / 4) * 25 + 12.5 })
    const cells = Array.from({ length: 16 }, (_, i) => `group "C${i}" at ${at(i).x},${at(i).y} { layer "c" { rect -12.5 -12.5 25 25 fill #999999 } }`).join(' ')
    const fades = Array.from({ length: 16 }, (_, i) => `object "C${i}" {\n  opacity = 1 - grid[${i}]\n}`).join('\n\n')
    const doc = parseProgramFull(`${veilProgram(cells)}\n\n${fades}`) as unknown as Doc
    const res = playHeadless(doc, [
      { type: 'down', x: 1, y: 1 }, { type: 'move', x: 1, y: 1 }, { type: 'up', x: 1, y: 1 }, // clears cell 0
      { type: 'down', x: 1, y: 1 }, { type: 'move', x: 99, y: 1 }, { type: 'up', x: 99, y: 1 }, // starts ON the cleared cell
    ])
    expect(cleared(res.vars.grid)).toEqual([0, 3]) // the second stroke landed
    expect(res.vars.covered).toBeCloseTo(2 / 16, 6)
  })
})

// `trace` with `step`: a TRACE, not a cursor. Measured on the reported case — a straight line, tolerance 30
// — where a single press a few pixels from the finish used to report the exercise as completed.
describe('headless -- continuous trace (`step`)', () => {
  const line = (slots: string) => [
    'size 600 200', 'var progress = 0', 'var tipX = 0', 'var tipY = 0',
    'scene { layer "L" {',
    '  group "Path" at 0,0 { layer "c" { path "M60 100L540 100" nofill stroke #cccccc 18 cap round } }',
    '} }', '',
    'object "Path" {', '  trace progress along Path {', '    tolerance 30', slots, '  }', '}',
  ].join('\n')
  const sweep = (from: number, to: number, by: number): Gesture[] => {
    const g: Gesture[] = [{ type: 'down', x: from, y: 100 }]
    for (let x = from; by > 0 ? x < to : x > to; x += by) g.push({ type: 'move', x, y: 100 })
    g.push({ type: 'move', x: to, y: 100 }) // always land ON the target: `up` alone advances nothing
    g.push({ type: 'up', x: to, y: 100 })
    return g
  }
  const play = (slots: string, gestures: Gesture[]) => playHeadless(parseProgramFull(line(slots)) as unknown as Doc, gestures).vars

  it('a press near the FINISH advances nothing (it used to complete the exercise)', () => {
    expect(play('    step 40', [{ type: 'down', x: 530, y: 100 }, { type: 'move', x: 540, y: 100 }, { type: 'up', x: 540, y: 100 }]).progress).toBe(0)
  })

  it('…while the same press completes it WITHOUT `step` (the historical cursor)', () => {
    expect(play('', [{ type: 'down', x: 530, y: 100 }, { type: 'move', x: 540, y: 100 }, { type: 'up', x: 540, y: 100 }]).progress).toBe(1)
  })

  it('a continuous run from the start reaches 1', () => {
    expect(play('    step 40', sweep(60, 540, 30)).progress).toBeCloseTo(1, 6)
  })

  it('a JUMP mid-run freezes the progress where it was (you must pass through what is between)', () => {
    const vars = play('    step 40', [
      { type: 'down', x: 60, y: 100 }, { type: 'move', x: 100, y: 100 },
      { type: 'move', x: 400, y: 100 }, { type: 'move', x: 540, y: 100 }, { type: 'up', x: 540, y: 100 },
    ])
    expect(vars.progress).toBeCloseTo(40 / 480, 6) // stopped at x=100, the last continuous point
  })

  it('lifting the finger and putting it back where it was RESUMES (a child stops mid-letter)', () => {
    const vars = play('    step 40', [
      ...sweep(60, 300, 30),
      ...sweep(302, 540, 30), // second grab, starting where the first ended
    ])
    expect(vars.progress).toBeCloseTo(1, 6)
  })

  it('and putting it back somewhere ELSE does not (the run is not transferable)', () => {
    const vars = play('    step 40', [...sweep(60, 300, 30), ...sweep(400, 540, 30)])
    expect(vars.progress).toBeCloseTo((300 - 60) / 480, 6) // still where the first grab left it
  })

  it('`both ends`: the far end is a legal entry, and the progress counts from THERE', () => {
    expect(play('    step 40\n    both ends', sweep(540, 420, -30)).progress).toBeCloseTo(120 / 480, 6)
    expect(play('    step 40', sweep(540, 420, -30)).progress).toBe(0) // …without it, only the `d`'s own start
  })

  it('assigning the progress variable RESTARTS it (the only reset there is)', () => {
    const vars = playHeadless(parseProgramFull(line('    step 40').replace('object "Path" {', 'object "Path" {\n  when released {\n    progress = 0\n  }')) as unknown as Doc, [
      ...sweep(60, 300, 30), // …traced, then the handler resets it
      ...sweep(302, 540, 30), // …so this grab is NOT a resume: it starts far from the (re-opened) start
    ]).vars
    expect(vars.progress).toBe(0)
  })

  it('`point x, y` places the pen tip at the current progress — and on the START before anything is touched', () => {
    const before = play('    step 40\n    point tipX, tipY', [])
    expect([before.tipX, before.tipY]).toEqual([60, 100]) // the path's start, not the origin
    const after = play('    step 40\n    point tipX, tipY', sweep(60, 300, 30))
    expect(after.tipX).toBeCloseTo(300, 6)
    expect(after.tipY).toBeCloseTo(100, 6)
  })
})

// Restoring an activity: `doc.variables` is the seed a host replays a reader's state from, and it carried
// only what IS a variable. A continuous trace's progress and a scratched grid live beside them — seeded
// alone, the numbers were right and the gestures had forgotten everything.
describe('headless -- a seeded document brings its derived state back', () => {
  const traceDoc = (seed: number) => [
    `size 600 200`, `var progress = ${seed}`, 'var tipX = 0', 'var tipY = 0',
    'scene { layer "L" {',
    '  group "Path" at 0,0 { layer "c" { path "M60 100L540 100" nofill stroke #cccccc 18 cap round } }',
    '} }', '',
    'object "Path" {', '  trace progress along Path {', '    tolerance 30', '    step 40', '    point tipX, tipY', '  }', '}',
  ].join('\n')
  const play = (src: string, gestures: Gesture[]) => playHeadless(parseProgramFull(src) as unknown as Doc, gestures).vars

  it('a seeded progress puts the pen tip where the ink stops, not at the start', () => {
    const vars = play(traceDoc(0.6), [])
    expect(vars.progress).toBe(0.6)
    expect(vars.tipX).toBeCloseTo(60 + 0.6 * 480, 6) // 348 — it used to report the path's start
  })

  it('…and the finger RESUMES there instead of having to start over', () => {
    const vars = play(traceDoc(0.6), [
      { type: 'down', x: 348, y: 100 }, { type: 'move', x: 380, y: 100 }, { type: 'move', x: 410, y: 100 }, { type: 'up', x: 410, y: 100 },
    ])
    expect(vars.progress).toBeCloseTo((410 - 60) / 480, 6)
  })

  it('the host `setVar` re-seats it too — the public write is the scene-side write', () => {
    // Measured from outside: `setVar` used to write the map directly, so the variable moved, the stroke
    // was inked to the new value, and the marker stayed at the start. Nothing about it looked wrong.
    const vars = play(traceDoc(0), [{ type: 'set', name: 'progress', value: 0.6 }])
    expect(vars.tipX).toBeCloseTo(348, 6)
  })

  const veilDoc = (grid: number[]) => [
    'size 200 200', 'var covered = 0', `var grid = [${grid.join(', ')}]`,
    'scene { layer "L" {', '  group "Veil" at 50,50 { layer "c" { rect -50 -50 100 100 fill #999999 } }', '} }', '',
    'object "Veil" {', '  reveal covered {', '    brush 25', '    cells grid', '  }', '}',
  ].join('\n')
  const seed = (...on: number[]) => Array.from({ length: 16 }, (_v, i) => (on.includes(i) ? 1 : 0))

  it('a seeded `cells` grid restores the scratched zone AND its fraction', () => {
    // The array `cells` writes is the same array that seeds it back: one format, both directions.
    expect(play(veilDoc(seed(0, 1, 4)), []).covered).toBeCloseTo(3 / 16, 6)
  })

  it('…and the next stroke accumulates on top of it', () => {
    const vars = play(veilDoc(seed(0, 1, 4)), [{ type: 'down', x: 99, y: 99 }, { type: 'move', x: 99, y: 99 }, { type: 'up', x: 99, y: 99 }])
    expect(vars.covered).toBeCloseTo(4 / 16, 6)
    expect((vars.grid as number[])[15]).toBe(1)
  })

  it('an empty grid seeds nothing (a fresh document is still fresh)', () => {
    expect(play(veilDoc(seed()), []).covered).toBe(0)
  })
})
