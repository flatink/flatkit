import { describe, it, expect } from 'vitest'
import { parseUnits, printUnits, type ScriptUnit } from './dsl'

/** Round-trip at the MODEL level: parse(print(u)) must give back u, with no diagnostic. */
function roundtrip(units: ScriptUnit[]) {
  const src = printUnits(units)
  const r = parseUnits(src)
  expect(r.diagnostics).toEqual([])
  expect(r.units).toEqual(units)
  return src
}

describe('dsl — interactors (drag / drop)', () => {
  it('prints drag / dragX / dragY', () => {
    expect(printUnits([{ kind: 'interactor', axis: 'xy', varX: 'cx', varY: 'cy' }])).toBe('drag cx, cy\n')
    expect(printUnits([{ kind: 'interactor', axis: 'x', varX: 'sx' }])).toBe('dragX sx\n')
    expect(printUnits([{ kind: 'interactor', axis: 'y', varY: 'sy' }])).toBe('dragY sy\n')
  })
  it('prints the confine / snap slots', () => {
    expect(printUnits([{ kind: 'interactor', axis: 'xy', varX: 'cx', varY: 'cy', confine: 'PlayField', grid: 20 }]))
      .toBe('drag cx, cy {\n  confine to PlayField\n  snap 20\n}\n')
  })
  it('round-trip free drag, dragX, and slots', () => {
    roundtrip([{ kind: 'interactor', axis: 'xy', varX: 'cx', varY: 'cy' }])
    roundtrip([{ kind: 'interactor', axis: 'x', varX: 'sx', confine: 'Rail' }])
    roundtrip([{ kind: 'interactor', axis: 'xy', varX: 'cx', varY: 'cy', confine: 'PlayField', grid: 20 }])
    roundtrip([{ kind: 'interactor', axis: 'y', varY: 'sy', grid: 8 }])
  })
  it('round-trip when dropped on Zone', () => {
    roundtrip([{ kind: 'drop', over: 'TargetC', body: [{ do: 'setVar', name: 'cx', value: 'TargetC.x' }, { do: 'setVar', name: 'cy', value: 'TargetC.y' }] }])
  })
  it('enabled slot (dynamic lock): printing + round-trip', () => {
    expect(printUnits([{ kind: 'interactor', axis: 'xy', varX: 'cx', varY: 'cy', enabled: 'p == 0' }]))
      .toBe('drag cx, cy {\n  enabled p == 0\n}\n')
    roundtrip([{ kind: 'interactor', axis: 'xy', varX: 'cx', varY: 'cy', enabled: 'p == 0' }])
    roundtrip([{ kind: 'interactor', axis: 'x', varX: 'sx', confine: 'Rail', grid: 10, enabled: 'unlocked' }])
  })
  it('turn (rotation at the pointer around a pivot): printing + round-trip', () => {
    expect(printUnits([{ kind: 'interactor', axis: 'turn', varX: 'angle', pivot: { x: 400, y: 300 } }]))
      .toBe('turn angle around 400,300\n')
    expect(printUnits([{ kind: 'interactor', axis: 'turn', varX: 'angle', pivot: { x: 400, y: 300 }, grid: 15 }]))
      .toBe('turn angle around 400,300 {\n  snap 15\n}\n')
    roundtrip([{ kind: 'interactor', axis: 'turn', varX: 'a', pivot: { x: 100, y: 200 } }])
    roundtrip([{ kind: 'interactor', axis: 'turn', varX: 'a', pivot: { x: 100, y: 200 }, grid: 30, enabled: 'p == 0' }])
  })
  it('trace (follow a path): printing + round-trip', () => {
    expect(printUnits([{ kind: 'interactor', axis: 'trace', varX: 'prog', confine: 'Path' }]))
      .toBe('trace prog along Path\n')
    expect(printUnits([{ kind: 'interactor', axis: 'trace', varX: 'prog', confine: 'Path', grid: 20 }]))
      .toBe('trace prog along Path {\n  tolerance 20\n}\n')
    roundtrip([{ kind: 'interactor', axis: 'trace', varX: 'p', confine: 'Letter' }])
    roundtrip([{ kind: 'interactor', axis: 'trace', varX: 'p', confine: 'Letter', grid: 18, enabled: 'go == 1' }])
  })
  it('INDEXED output (array element) on gestures: printing + round-trip', () => {
    expect(printUnits([{ kind: 'interactor', axis: 'xy', varX: 'hx[i]', varY: 'hy[i]' }])).toBe('drag hx[i], hy[i]\n')
    roundtrip([{ kind: 'interactor', axis: 'xy', varX: 'hx[i]', varY: 'hy[i]' }])
    roundtrip([{ kind: 'interactor', axis: 'x', varX: 'pos[i + 1]', confine: 'Rail' }])
    roundtrip([{ kind: 'interactor', axis: 'turn', varX: 'ang[k]', pivot: { x: 0, y: 0 } }])
    roundtrip([{ kind: 'interactor', axis: 'reveal', varX: 'seen[2]' }])
    roundtrip([{ kind: 'interactor', axis: 'link', varX: 'ex[i]', varY: 'ey[i]', varT: 'rel[i]', confine: 'Targets' }])
  })
  it('reveal (scratch/wipe): printing + round-trip', () => {
    expect(printUnits([{ kind: 'interactor', axis: 'reveal', varX: 'seen' }]))
      .toBe('reveal seen\n')
    expect(printUnits([{ kind: 'interactor', axis: 'reveal', varX: 'seen', grid: 30 }]))
      .toBe('reveal seen {\n  brush 30\n}\n')
    roundtrip([{ kind: 'interactor', axis: 'reveal', varX: 'seen' }])
    roundtrip([{ kind: 'interactor', axis: 'reveal', varX: 'seen', grid: 40, enabled: 'phase == 1' }])
  })
  it('link (pull a thread toward a target): printing + round-trip', () => {
    expect(printUnits([{ kind: 'interactor', axis: 'link', varX: 'ex', varY: 'ey', varT: 'target', confine: 'Countries' }]))
      .toBe('link ex, ey, target to Countries\n')
    expect(printUnits([{ kind: 'interactor', axis: 'link', varX: 'ex', varY: 'ey', varT: 'target', confine: 'Countries', enabled: 'active' }]))
      .toBe('link ex, ey, target to Countries {\n  enabled active\n}\n')
    roundtrip([{ kind: 'interactor', axis: 'link', varX: 'ex', varY: 'ey', varT: 'target', confine: 'Countries' }])
    roundtrip([{ kind: 'interactor', axis: 'link', varX: 'ex', varY: 'ey', varT: 'target', confine: 'Targets', enabled: 'go == 1' }])
  })
  it('when dropped on Zone at pointer: printing + round-trip', () => {
    expect(printUnits([{ kind: 'drop', over: 'Zone', atPointer: true, body: [{ do: 'play' }] }]))
      .toBe('when dropped on Zone at pointer {\n  play\n}\n')
    roundtrip([{ kind: 'drop', over: 'Zone', atPointer: true, body: [{ do: 'setVar', name: 'ok', value: '1' }] }])
  })
  it('round-trip of a complete object (drag + dropped + bindings)', () => {
    roundtrip([
      { kind: 'interactor', axis: 'xy', varX: 'cx', varY: 'cy' },
      { kind: 'drop', over: 'TargetC', body: [{ do: 'setVar', name: 'cx', value: 'TargetC.x' }] },
      { kind: 'binding', channel: 'x', expr: 'cx' },
      { kind: 'binding', channel: 'y', expr: 'cy' },
    ])
  })
})

describe('dsl — printer', () => {
  it('renders an event with actions and indentation', () => {
    const src = printUnits([
      { kind: 'event', event: 'click', body: [{ do: 'setVar', name: 'score', value: 'score + 1' }, { do: 'play' }] },
    ])
    expect(src).toBe('when clicked {\n  score = score + 1\n  play\n}\n')
  })

  it('renders the event labels', () => {
    const ev = (e: ScriptUnit & { kind: 'event' }) => printUnits([e]).split(' {')[0]
    expect(ev({ kind: 'event', event: 'click', body: [] })).toBe('when clicked')
    expect(ev({ kind: 'event', event: 'enter', body: [] })).toBe('when hovered')
    expect(ev({ kind: 'event', event: 'leave', body: [] })).toBe('when unhovered')
    expect(ev({ kind: 'event', event: 'press', body: [] })).toBe('when pressed')
    expect(ev({ kind: 'event', event: 'release', body: [] })).toBe('when released')
    expect(ev({ kind: 'event', event: 'drag', body: [] })).toBe('when dragged')
    expect(ev({ kind: 'event', event: 'longpress', body: [] })).toBe('when held')
    expect(ev({ kind: 'event', event: 'load', body: [] })).toBe('when loaded')
    expect(ev({ kind: 'event', event: 'enterFrame', body: [] })).toBe('every frame')
  })

  it('round-trip of input events (press/release/drag/held)', () => {
    roundtrip([
      { kind: 'event', event: 'press', body: [{ do: 'setVar', name: 'ox', value: 'mouse.x - px' }] },
      { kind: 'event', event: 'drag', body: [{ do: 'setVar', name: 'px', value: 'mouse.x - ox' }] },
      { kind: 'event', event: 'release', body: [{ do: 'pause' }] },
      { kind: 'event', event: 'longpress', body: [{ do: 'play' }] },
    ])
  })

  it('empty block = compact {}', () => {
    expect(printUnits([{ kind: 'event', event: 'load', body: [] }])).toBe('when loaded {}\n')
  })

  it('nested if / else and repeat', () => {
    const src = printUnits([
      {
        kind: 'event',
        event: 'click',
        body: [
          {
            do: 'if',
            cond: 'score > 10',
            then: [{ do: 'gotoLabel', label: 'win', play: true }],
            else: [{ do: 'repeat', count: '3', body: [{ do: 'play' }] }],
          },
        ],
      },
    ])
    expect(src).toBe(
      [
        'when clicked {',
        '  if score > 10 {',
        '    go to "win" and play',
        '  } else {',
        '    repeat 3 times {',
        '      play',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('go to frame with and without suffix', () => {
    const s = (a: import('./actions').Action) => printUnits([{ kind: 'event', event: 'load', body: [a] }])
    expect(s({ do: 'gotoFrame', frame: 5 })).toContain('go to frame 5\n')
    expect(s({ do: 'gotoFrame', frame: 5, play: true })).toContain('go to frame 5 and play')
    expect(s({ do: 'gotoFrame', frame: 5, play: false })).toContain('go to frame 5 and pause')
  })
})

describe('dsl — round-trip (model → text → model)', () => {
  it('all actions', () => {
    roundtrip([
      {
        kind: 'event',
        event: 'click',
        body: [
          { do: 'play' },
          { do: 'pause' },
          { do: 'gotoFrame', frame: 12 },
          { do: 'gotoFrame', frame: 0, play: true },
          { do: 'gotoFrame', frame: 3, play: false },
          { do: 'gotoLabel', label: 'menu' },
          { do: 'gotoLabel', label: 'win', play: true },
          { do: 'setVar', name: 'score', value: 'score + 1' },
        ],
      },
    ])
  })

  it('control: if/else and repeat (count = expression)', () => {
    roundtrip([
      {
        kind: 'event',
        event: 'enterFrame',
        body: [
          {
            do: 'if',
            cond: 'lives <= 0',
            then: [{ do: 'gotoLabel', label: 'over' }],
            else: [{ do: 'setVar', name: 'lives', value: 'lives' }],
          },
          { do: 'repeat', count: 'n + 1', body: [{ do: 'setVar', name: 'total', value: 'total + 1' }] },
        ],
      },
    ])
  })

  it('declarations and channel bindings', () => {
    roundtrip([
      { kind: 'declare', name: 'score', value: 0 },
      { kind: 'declare', name: 'gravity', value: -9.8 },
      { kind: 'binding', channel: 'rotation', expr: 'time * 2' },
      { kind: 'binding', channel: 'x', expr: 'mouse.x' },
      { kind: 'binding', channel: 'opacity', expr: 'clamp(score / 10, 0, 1)' },
    ])
  })

  it('events, frame-actions and labels', () => {
    roundtrip([
      { kind: 'event', event: 'load', body: [{ do: 'setVar', name: 'score', value: '0' }] },
      { kind: 'event', event: 'enter', body: [{ do: 'setVar', name: 'hot', value: '1' }] },
      { kind: 'event', event: 'leave', body: [{ do: 'setVar', name: 'hot', value: '0' }] },
      { kind: 'frameActions', frame: 30, body: [{ do: 'pause' }] },
      { kind: 'label', frame: 30, name: 'checkpoint' },
    ])
  })

  it('empty block round-trip', () => {
    roundtrip([{ kind: 'event', event: 'click', body: [] }])
  })
})

describe('dsl — parser (text → model)', () => {
  it('parses a complete program', () => {
    const r = parseUnits(`
      // score button
      when clicked {
        score = score + 1
        if score > 10 {
          go to "win" and play
        }
      }

      rotation = time * 2
    `)
    expect(r.diagnostics).toEqual([])
    expect(r.units).toEqual([
      {
        kind: 'event',
        event: 'click',
        body: [
          { do: 'setVar', name: 'score', value: 'score + 1' },
          { do: 'if', cond: 'score > 10', then: [{ do: 'gotoLabel', label: 'win', play: true }] },
        ],
      },
      { kind: 'binding', channel: 'rotation', expr: 'time * 2' },
    ])
  })

  it('`else if` is sugar for `else { if … }`', () => {
    const r = parseUnits('when clicked {\n  if s > 10 {\n    play\n  } else if s > 5 {\n    pause\n  } else {\n    stop = 1\n  }\n}')
    expect(r.diagnostics).toEqual([])
    expect(r.units).toEqual([
      {
        kind: 'event',
        event: 'click',
        body: [
          {
            do: 'if',
            cond: 's > 10',
            then: [{ do: 'play' }],
            else: [
              {
                do: 'if',
                cond: 's > 5',
                then: [{ do: 'pause' }],
                else: [{ do: 'setVar', name: 'stop', value: '1' }],
              },
            ],
          },
        ],
      },
    ])
  })

  it('accepts `let` inside a body (mapped to an assignment)', () => {
    const r = parseUnits('when loaded {\n  let x = 5\n}')
    expect(r.diagnostics).toEqual([])
    expect(r.units).toEqual([{ kind: 'event', event: 'load', body: [{ do: 'setVar', name: 'x', value: '5' }] }])
  })

  it('tolerates blocks on a single line', () => {
    const r = parseUnits('when clicked { play }')
    expect(r.diagnostics).toEqual([])
    expect(r.units).toEqual([{ kind: 'event', event: 'click', body: [{ do: 'play' }] }])
  })

  it('ignores end-of-line comments', () => {
    const r = parseUnits('rotation = time * 2 // turns')
    expect(r.diagnostics).toEqual([])
    expect(r.units).toEqual([{ kind: 'binding', channel: 'rotation', expr: 'time * 2' }])
  })
})

describe('dsl — diagnostics', () => {
  it('unknown channel at top-level', () => {
    const r = parseUnits('wobble = time')
    expect(r.diagnostics.length).toBe(1)
    expect(r.diagnostics[0].message).toMatch(/unknown channel/)
  })

  it('misspelled event', () => {
    const r = parseUnits('when tapped {\n}')
    expect(r.diagnostics[0].message).toMatch(/unknown event/)
  })

  it('missing brace', () => {
    const r = parseUnits('when clicked\n  play')
    expect(r.diagnostics.some((d) => /"{" expected/.test(d.message))).toBe(true)
  })

  it('repeat without "times"', () => {
    const r = parseUnits('every frame {\n  repeat 3 {\n    play\n  }\n}')
    expect(r.diagnostics.some((d) => /times/.test(d.message))).toBe(true)
  })

  it('nested event forbidden', () => {
    const r = parseUnits('when clicked {\n  when loaded {\n    play\n  }\n}')
    expect(r.diagnostics.some((d) => /event/.test(d.message))).toBe(true)
  })

  it('one error does not prevent parsing the rest', () => {
    const r = parseUnits('wobble = 1\nrotation = time')
    expect(r.diagnostics.length).toBe(1)
    expect(r.units).toEqual([{ kind: 'binding', channel: 'rotation', expr: 'time' }])
  })

  it('two assignments on one line → "one action per line", column on the 2nd =', () => {
    const line = '  x = 1  y = 2'
    const r = parseUnits(`when clicked {\n${line}\n}`)
    const d = r.diagnostics.find((x) => /one action per line/.test(x.message))
    expect(d).toBeTruthy()
    expect(line[(d!.col ?? 0) - 1]).toBe('=') // points at the offending "=", not the start of the expression
  })

  it('"send" payload containing an assignment → error (footgun absorbed)', () => {
    const r = parseUnits('when clicked {\n  send "evt", x = 1\n}')
    expect(r.diagnostics.some((d) => /"send" payload|one action per line/.test(d.message))).toBe(true)
  })

  it('a comparator in a payload/expression is NOT confused with an assignment', () => {
    const r = parseUnits('when clicked {\n  send "evt", a == b\n}')
    expect(r.diagnostics.filter((d) => /one action per line/.test(d.message))).toEqual([])
  })
})

describe('dsl — send (event channel to the host)', () => {
  // MODEL round-trip of the three payload forms: none, numeric, text("…").
  it('round-trip: bare form', () => {
    roundtrip([{ kind: 'event', event: 'click', body: [{ do: 'send', event: 'correct' }] }])
  })
  it('round-trip: numeric payload (literal and expression)', () => {
    roundtrip([{ kind: 'event', event: 'click', body: [{ do: 'send', event: 'score', payload: { kind: 'expr', expr: '42' } }] }])
    roundtrip([{ kind: 'event', event: 'click', body: [{ do: 'send', event: 'score', payload: { kind: 'expr', expr: 'x + 1' } }] }])
  })
  it('round-trip: text("itemId") payload', () => {
    roundtrip([{ kind: 'event', event: 'click', body: [{ do: 'send', event: 'answer', payload: { kind: 'text', itemId: 'txt_card0' } }] }])
  })

  it('prints the three forms as-is', () => {
    const src = printUnits([
      { kind: 'event', event: 'load', body: [
        { do: 'send', event: 'ready' },
        { do: 'send', event: 'score', payload: { kind: 'expr', expr: 'x + 1' } },
        { do: 'send', event: 'answer', payload: { kind: 'text', itemId: 'card0' } },
      ] },
    ])
    expect(src).toBe('when loaded {\n  send "ready"\n  send "score", x + 1\n  send "answer", text("card0")\n}\n')
  })

  it('empty name → error', () => {
    const r = parseUnits('when clicked {\n  send ""\n}')
    expect(r.diagnostics.some((d) => /empty/.test(d.message))).toBe(true)
  })
  it('invalid name (forbidden characters) → error', () => {
    const r = parseUnits('when clicked {\n  send "no spaces!"\n}')
    expect(r.diagnostics.some((d) => /invalid/.test(d.message))).toBe(true)
  })
  it('comma without payload → error', () => {
    const r = parseUnits('when clicked {\n  send "x",\n}')
    expect(r.diagnostics.some((d) => /expected after/.test(d.message))).toBe(true)
  })
  it('non-literal text(x) → error', () => {
    const r = parseUnits('when clicked {\n  send "x", text(x)\n}')
    expect(r.diagnostics.some((d) => /string literal/.test(d.message))).toBe(true)
  })
  it('text("a", "b") too many arguments → error', () => {
    const r = parseUnits('when clicked {\n  send "x", text("a", "b")\n}')
    expect(r.diagnostics.some((d) => /a single argument/.test(d.message))).toBe(true)
  })
  it('"send" stays usable as a variable (back-compat)', () => {
    const r = parseUnits('every frame {\n  send = 5\n}')
    expect(r.diagnostics).toEqual([])
    expect(r.units).toEqual([{ kind: 'event', event: 'enterFrame', body: [{ do: 'setVar', name: 'send', value: '5' }] }])
  })
})

describe('dsl — sound (play an audio clip)', () => {
  it('round-trip: sound "id"', () => {
    roundtrip([{ kind: 'event', event: 'click', body: [{ do: 'sound', assetId: 'pop' }] }])
  })
  it('prints sound "id"', () => {
    expect(printUnits([{ kind: 'event', event: 'click', body: [{ do: 'sound', assetId: 'pop' }] }]))
      .toBe('when clicked {\n  sound "pop"\n}\n')
  })
  it('"sound" stays usable as a variable (back-compat)', () => {
    const r = parseUnits('every frame {\n  sound = 1\n}')
    expect(r.diagnostics).toEqual([])
    expect(r.units).toEqual([{ kind: 'event', event: 'enterFrame', body: [{ do: 'setVar', name: 'sound', value: '1' }] }])
  })
})

describe('dsl — setParam (Name.param = value)', () => {
  it('round-trips a state assignment with a bare state name (no expression diagnostic)', () => {
    const units: ScriptUnit[] = [{ kind: 'event', event: 'click', body: [{ do: 'setParam', target: 'Door', param: 'door', value: 'open' }] }]
    const src = printUnits(units)
    expect(src).toBe('when clicked {\n  Door.door = open\n}\n')
    const r = parseUnits(src)
    expect(r.diagnostics).toEqual([]) // `open` is a state name, not linted as a variable
    expect(r.units).toEqual(units)
  })

  it('accepts an expression on the right-hand side too', () => {
    const r = parseUnits('when clicked {\n  Gauge.level = score / 100\n}\n')
    expect(r.diagnostics).toEqual([])
    expect(r.units[0]).toEqual({ kind: 'event', event: 'click', body: [{ do: 'setParam', target: 'Gauge', param: 'level', value: 'score / 100' }] })
  })
})
