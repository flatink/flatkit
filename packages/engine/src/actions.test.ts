import { describe, it, expect } from 'vitest'
import { compileExpr, evalExpr } from './expr'
import { runActions, MAX_REPEAT, MAX_ACTIONS_PER_TICK, MAX_SEND_FIELDS, type Action, type ActionHost } from './actions'

function mock() {
  const calls: string[] = []
  const events: { name: string; value?: number | string; fields?: Record<string, number> }[] = []
  const texts: Record<string, string> = { greeting: 'Hello', card0: 'French Revolution' }
  const vars = new Map<string, number | number[]>()
  const labels: Record<string, number> = { start: 0, mid: 30 }
  const host: ActionHost = {
    play: () => calls.push('play'),
    pause: () => calls.push('pause'),
    seek: (f) => calls.push('seek:' + f),
    labelFrame: (n) => labels[n],
    setVar: (n, v) => vars.set(n, v),
    setIndex: (n, i, v) => { const a = vars.get(n); if (Array.isArray(a)) a[i] = v },
    fillVar: (n, c, v) => { vars.set(n, new Array<number>(Math.max(0, c)).fill(v)); calls.push(`fill:${n}[${c}]=${v}`) },
    setParam: (t, p, v) => calls.push(`setParam:${t}.${p}=${v}`),
    callProc: () => {},
    emit: (name, value, fields) => events.push({ name, ...(value === undefined ? {} : { value }), ...(fields ? { fields } : {}) }),
    textContent: (id) => texts[id] ?? '',
    playSound: (id) => calls.push('sound:' + id),
    // a "real" evalNumber: compiles the expression and resolves the current variables
    // → lets us test if/repeat with real conditions (score > 10, etc.).
    evalNumber: (s) => {
      const c = compileExpr(s)
      if (!c.ok) return 0
      const ctx: Record<string, number | number[]> = {}
      for (const [k, v] of vars) ctx[k] = v
      return evalExpr(c.node, ctx, 0)
    },
  }
  return { calls, events, vars, host }
}

describe('actions — interpreter', () => {
  it('play / pause', () => {
    const m = mock()
    runActions([{ do: 'play' }, { do: 'pause' }], m.host)
    expect(m.calls).toEqual(['play', 'pause'])
  })

  it('gotoFrame: seek + play/pause depending on the flag', () => {
    const a = mock()
    runActions([{ do: 'gotoFrame', frame: 10, play: true }], a.host)
    expect(a.calls).toEqual(['seek:10', 'play'])

    const b = mock()
    runActions([{ do: 'gotoFrame', frame: 5 }], b.host) // no flag → does not change the state
    expect(b.calls).toEqual(['seek:5'])

    const c = mock()
    runActions([{ do: 'gotoFrame', frame: 7, play: false }], c.host)
    expect(c.calls).toEqual(['seek:7', 'pause'])
  })

  it('gotoLabel: resolves the marker, otherwise does nothing', () => {
    const a = mock()
    runActions([{ do: 'gotoLabel', label: 'mid', play: false }], a.host)
    expect(a.calls).toEqual(['seek:30', 'pause'])

    const b = mock()
    runActions([{ do: 'gotoLabel', label: 'missing', play: true }], b.host)
    expect(b.calls).toEqual([]) // unknown marker → no-op
  })

  it('setVar evaluates the value via the host', () => {
    const m = mock()
    runActions([{ do: 'setVar', name: 'score', value: '42' }], m.host)
    expect(m.vars.get('score')).toBe(42)
  })

  it('a sequence of actions runs in order', () => {
    const m = mock()
    const seq: Action[] = [{ do: 'setVar', name: 'n', value: '1' }, { do: 'gotoFrame', frame: 0, play: true }]
    runActions(seq, m.host)
    expect(m.vars.get('n')).toBe(1)
    expect(m.calls).toEqual(['seek:0', 'play'])
  })

  describe('if', () => {
    it('runs the then branch when the condition is true (≠ 0)', () => {
      const m = mock()
      m.vars.set('score', 20)
      runActions([{ do: 'if', cond: 'score > 10', then: [{ do: 'play' }] }], m.host)
      expect(m.calls).toEqual(['play'])
    })

    it('skips then (and runs else if present) when the condition is false', () => {
      const m = mock()
      m.vars.set('score', 3)
      runActions([{ do: 'if', cond: 'score > 10', then: [{ do: 'play' }], else: [{ do: 'pause' }] }], m.host)
      expect(m.calls).toEqual(['pause'])
    })

    it('without else, a false condition is a no-op', () => {
      const m = mock()
      runActions([{ do: 'if', cond: '0', then: [{ do: 'play' }] }], m.host)
      expect(m.calls).toEqual([])
    })

    it('invalid condition → treated as false (fallback 0)', () => {
      const m = mock()
      runActions([{ do: 'if', cond: 'bad@expr', then: [{ do: 'play' }], else: [{ do: 'pause' }] }], m.host)
      expect(m.calls).toEqual(['pause'])
    })

    it('nested ifs', () => {
      const m = mock()
      m.vars.set('a', 1)
      m.vars.set('b', 1)
      runActions(
        [{ do: 'if', cond: 'a', then: [{ do: 'if', cond: 'b', then: [{ do: 'play' }] }] }],
        m.host,
      )
      expect(m.calls).toEqual(['play'])
    })
  })

  describe('repeat', () => {
    it('repeats the body N times (literal count)', () => {
      const m = mock()
      runActions([{ do: 'repeat', count: '3', body: [{ do: 'play' }] }], m.host)
      expect(m.calls).toEqual(['play', 'play', 'play'])
    })

    it('count comes from an expression on variables', () => {
      const m = mock()
      m.vars.set('n', 2)
      runActions([{ do: 'repeat', count: 'n + 1', body: [{ do: 'pause' }] }], m.host)
      expect(m.calls).toEqual(['pause', 'pause', 'pause'])
    })

    it('fractional count → floored', () => {
      const m = mock()
      runActions([{ do: 'repeat', count: '2.9', body: [{ do: 'play' }] }], m.host)
      expect(m.calls).toEqual(['play', 'play'])
    })

    it('negative / NaN count → 0 iterations (never a loop)', () => {
      const a = mock()
      runActions([{ do: 'repeat', count: '-5', body: [{ do: 'play' }] }], a.host)
      expect(a.calls).toEqual([])

      const b = mock()
      runActions([{ do: 'repeat', count: 'unknown', body: [{ do: 'play' }] }], b.host)
      expect(b.calls).toEqual([])
    })

    it('count is clamped to MAX_REPEAT (anti-freeze)', () => {
      const m = mock()
      let n = 0
      m.host.play = () => {
        n++
      }
      runActions([{ do: 'repeat', count: String(MAX_REPEAT + 5000), body: [{ do: 'play' }] }], m.host)
      expect(n).toBe(MAX_REPEAT)
    })

    it('repeat accumulates via setVar (body re-evaluated each pass)', () => {
      const m = mock()
      m.vars.set('total', 0)
      runActions([{ do: 'repeat', count: '4', body: [{ do: 'setVar', name: 'total', value: 'total + 1' }] }], m.host)
      expect(m.vars.get('total')).toBe(4)
    })

    it('if + repeat combined', () => {
      const m = mock()
      m.vars.set('lives', 0)
      runActions(
        [
          { do: 'repeat', count: '3', body: [{ do: 'setVar', name: 'lives', value: 'lives + 1' }] },
          { do: 'if', cond: 'lives == 3', then: [{ do: 'gotoLabel', label: 'mid', play: true }] },
        ],
        m.host,
      )
      expect(m.vars.get('lives')).toBe(3)
      expect(m.calls).toEqual(['seek:30', 'play'])
    })
  })

  describe('send — emitting events to the host', () => {
    it('bare form: emit without value', () => {
      const m = mock()
      runActions([{ do: 'send', event: 'ready' }], m.host)
      expect(m.events).toEqual([{ name: 'ready' }])
    })
    it('numeric payload: evaluates the expression', () => {
      const m = mock()
      m.vars.set('x', 2)
      runActions([{ do: 'send', event: 'score', payload: { kind: 'expr', expr: 'x + 1' } }], m.host)
      expect(m.events).toEqual([{ name: 'score', value: 3 }])
    })
    it('text(…) payload: resolves the Text item live content', () => {
      const m = mock()
      runActions([{ do: 'send', event: 'answer', payload: { kind: 'text', itemId: 'card0' } }], m.host)
      expect(m.events).toEqual([{ name: 'answer', value: 'French Revolution' }])
    })
    it('text(…) payload on a missing item: empty string (host returns "")', () => {
      const m = mock()
      runActions([{ do: 'send', event: 'answer', payload: { kind: 'text', itemId: 'missing' } }], m.host)
      expect(m.events).toEqual([{ name: 'answer', value: '' }])
    })
    it('record payload: each field evaluated, emitted as a named patch (no positional value)', () => {
      const m = mock()
      m.vars.set('px', 12)
      m.vars.set('doors', 3)
      runActions(
        [{ do: 'send', event: 'save', payload: { kind: 'record', fields: [{ name: 'x', expr: 'px + 1' }, { name: 'doors', expr: 'doors' }] } }],
        m.host,
      )
      expect(m.events).toEqual([{ name: 'save', fields: { x: 13, doors: 3 } }])
    })
    // A hand-written .flatpack never goes through the parser -> the interpreter re-checks (defense in depth).
    it('record payload: a prototype-pollution / malformed key is dropped (untrusted doc)', () => {
      const m = mock()
      m.vars.set('a', 1)
      runActions(
        [{ do: 'send', event: 'save', payload: { kind: 'record', fields: [
          { name: '__proto__', expr: 'a' }, { name: 'constructor', expr: 'a' }, { name: 'prototype', expr: 'a' },
          { name: '1bad', expr: 'a' }, { name: 'with space', expr: 'a' }, { name: '', expr: 'a' }, { name: 'ok', expr: 'a' },
        ] } }],
        m.host,
      )
      expect(m.events).toEqual([{ name: 'save', fields: { ok: 1 } }])
      expect(Object.getPrototypeOf(m.events[0].fields!)).toBe(Object.prototype) // prototype intact
    })
    it('record payload: the field count is capped (untrusted doc)', () => {
      const m = mock()
      const fields = Array.from({ length: MAX_SEND_FIELDS + 10 }, (_, i) => ({ name: `f${i}`, expr: '1' }))
      runActions([{ do: 'send', event: 'save', payload: { kind: 'record', fields } }], m.host)
      expect(Object.keys(m.events[0].fields!)).toHaveLength(MAX_SEND_FIELDS)
    })
  })

  describe('sound — triggering a clip', () => {
    it('calls host.playSound with the assetId', () => {
      const m = mock()
      runActions([{ do: 'sound', assetId: 'pop' }], m.host)
      expect(m.calls).toEqual(['sound:pop'])
    })
  })

  describe('repeat — global per-tick budget (anti-freeze)', () => {
    it('nested repeats cannot exceed MAX_ACTIONS_PER_TICK', () => {
      const m = mock()
      let n = 0
      const host: ActionHost = { ...m.host, setVar: () => { n++ } }
      // 100k × 100k = 10^10 naive iterations: a per-block cap would not save us; the shared budget must.
      const inner: Action = { do: 'repeat', count: '100000', body: [{ do: 'setVar', name: 'x', value: '1' }] }
      runActions([{ do: 'repeat', count: '100000', body: [inner] }], host)
      expect(n).toBeGreaterThan(0)
      expect(n).toBeLessThanOrEqual(MAX_ACTIONS_PER_TICK)
    })
  })
})

describe('actions — fillVar (`arr = fill(n, v)`)', () => {
  it('replaces the whole array, with both arguments evaluated', () => {
    const m = mock()
    m.vars.set('cols', 3)
    runActions([{ do: 'fillVar', name: 'grid', count: 'cols * 2', value: '7' }], m.host)
    expect(m.vars.get('grid')).toEqual([7, 7, 7, 7, 7, 7])
  })

  it('charges the tick budget what it WRITES, so a loop of fills cannot allocate for a second', () => {
    // The budget counts actions, assuming each costs about the same. A fill writes up to 100k slots, so a
    // `repeat` full of them would have run 200k of them — billions of writes — under a green ceiling.
    const m = mock()
    runActions([{ do: 'repeat', count: '1000', body: [{ do: 'fillVar', name: 'g', count: '50000', value: '0' }] }], m.host)
    const fills = m.calls.filter((c) => c.startsWith('fill:')).length
    expect(fills).toBeLessThanOrEqual(5) // 200k budget / 50k a fill — not a thousand of them
    expect(fills).toBeGreaterThan(0)
  })

  it('a fractional count is rounded, a negative one gives an empty array', () => {
    const m = mock()
    runActions([{ do: 'fillVar', name: 'a', count: '2.6', value: '1' }, { do: 'fillVar', name: 'b', count: '0 - 5', value: '1' }], m.host)
    expect(m.vars.get('a')).toEqual([1, 1, 1])
    expect(m.vars.get('b')).toEqual([])
  })
})
