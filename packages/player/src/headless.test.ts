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
