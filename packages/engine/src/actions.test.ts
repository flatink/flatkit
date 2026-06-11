import { describe, it, expect } from 'vitest'
import { compileExpr, evalExpr } from './expr'
import { runActions, MAX_REPEAT, MAX_ACTIONS_PER_TICK, type Action, type ActionHost } from './actions'

function mock() {
  const calls: string[] = []
  const events: { name: string; value?: number | string }[] = []
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
    callProc: () => {},
    emit: (name, value) => events.push(value === undefined ? { name } : { name, value }),
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
