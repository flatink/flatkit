import { describe, it, expect } from 'vitest'
import { lint, lintReport } from './lint'

describe('lint — valid program', () => {
  it('no diagnostic on a correct program', () => {
    const src = `
      let score = 0
      when clicked {
        score = score + 1
        if score > 10 {
          go to "win" and play
        }
      }
      rotation = time * 2
      opacity = clamp(score / 10, 0, 1)
    `
    expect(lint(src)).toEqual([])
  })

  it('recognizes standard functions, constants, scalars and objects', () => {
    const src = `
      x = mouse.x + sin(time) * PI
      y = keys.ArrowDown * 5 + cos(frame)
      opacity = value
    `
    expect(lint(src)).toEqual([])
  })
})

describe('lint — expressions', () => {
  it('syntactically invalid expression', () => {
    const d = lint('rotation = time *')
    expect(d.length).toBe(1)
    expect(d[0].message).toMatch(/invalid expression/)
  })

  it('two statements on one line now parse (the parser splits at the boundary, no error)', () => {
    expect(lint('x = 1  y = 2')).toEqual([]) // x, y are channels → two valid bindings, nothing to report
    const d = lint('y = a  x = b') // a, b are unknown vars — flagged as such, NOT as "two statements"
    expect(d.every((x) => !/two statements on one line/.test(x.message))).toBe(true)
  })

  it('a swallowed ACTION (not just an assignment) is named, with the one-action-per-line rule', () => {
    // `score = score + 1  send "correct", 1` reported `unexpected character """` — the rule was in the docs
    // but nowhere near the message. Only assignments were detected; actions fell through to the generic text.
    const d = lint('when pressed { if t == 2 { score = score + 1  send "correct", 1 } }', { variables: ['score', 't'] })
    const m = d.map((x) => x.message).find((x) => /two statements on one line/.test(x))
    expect(m).toBeDefined()
    expect(m).toMatch(/`send …`/) // names what was swallowed
    expect(m).toMatch(/own line/) // states the rule
  })

  it('dx/dy are valid offset channels, but their expressions are still linted', () => {
    expect(lint('dx = 58 * sin(time)  dy = 0')).toEqual([]) // valid offset bindings → nothing to report
    const d = lint('dx = speed') // unknown variable inside the offset expression is still caught
    expect(d.some((x) => /unknown variable "speed"/.test(x.message))).toBe(true)
  })

  it('comparisons are NOT mistaken for a second statement (regex excludes ==/<=/>=/!=)', () => {
    expect(lint('rotation = a <= b', { variables: ['a', 'b'] })).toEqual([]) // valid comparison → no diagnostic
    const d = lint('rotation = a <=', { variables: ['a'] }) // invalid (incomplete) but NOT a 2nd statement
    expect(d[0].message).toMatch(/invalid expression/)
    expect(d[0].message).not.toMatch(/two statements/)
  })

  it('unknown function', () => {
    const d = lint('rotation = wobble(time)')
    expect(d.some((x) => /unknown function "wobble"/.test(x.message))).toBe(true)
  })

  it('unknown member object', () => {
    const d = lint('x = pointer.x')
    expect(d.some((x) => /unknown object "pointer"/.test(x.message))).toBe(true)
  })

  it('unknown variable — the hint names the declaration that carries across scopes', () => {
    // It used to say `let`, which is exactly what does NOT: a reader declared with `let`, the binding still
    // could not see it, and the message repeated itself. Reported as half an hour lost.
    const d = lint('rotation = speed * 2')
    expect(d.length).toBe(1)
    expect(d[0].message).toMatch(/unknown variable "speed"/)
    expect(d[0].message).toMatch(/var speed = 0/)
  })

  it('known scene object (Hero.x) accepted when provided', () => {
    expect(lint('x = Hero.x + 10', { objects: ['Hero'] })).toEqual([])
    expect(lint('x = Hero.x').some((x) => /unknown object "Hero"/.test(x.message))).toBe(true)
  })

  it('self.x and between(...) recognized (reserved object + built-in)', () => {
    expect(lint('rotation = atan2(self.y, self.x)')).toEqual([])
    expect(lint('opacity = between(self.y, 0, 100)')).toEqual([])
  })
})

describe('lint — known variables', () => {
  it('a variable declared with let is known', () => {
    expect(lint('let speed = 3\nrotation = speed * time')).toEqual([])
  })

  it('a variable simply assigned is known (kid-friendly)', () => {
    const src = `
      when clicked { health = health - 1 }
      opacity = health
    `
    expect(lint(src)).toEqual([])
  })

  it('a variable provided by the context is known', () => {
    expect(lint('rotation = speed * time', { variables: ['speed'] })).toEqual([])
  })
})

describe('lint — labels', () => {
  it('unknown label reported when the list is provided', () => {
    const d = lint('when clicked { go to "bonus" }', { labels: ['win'] })
    expect(d.some((x) => /unknown label "bonus"/.test(x.message))).toBe(true)
  })

  it('known label accepted', () => {
    expect(lint('when clicked { go to "win" and play }', { labels: ['win'] })).toEqual([])
  })

  it('no label check when the list is absent', () => {
    expect(lint('when clicked { go to "anything" }')).toEqual([])
  })
})

describe('lint — positions and accumulation', () => {
  it('points to the right line', () => {
    const d = lint('let score = 0\nrotation = bogus')
    expect(d.length).toBe(1)
    expect(d[0].line).toBe(2)
  })

  it('accumulates syntax errors (parser) and semantic ones, sorted by position', () => {
    // line 1: unknown channel (syntax); line 2: unknown variable (semantic)
    const d = lint('wobble = 1\nrotation = ghost')
    expect(d.length).toBe(2)
    expect(d[0].line).toBe(1)
    expect(d[0].message).toMatch(/unknown channel/)
    expect(d[1].line).toBe(2)
    expect(d[1].message).toMatch(/unknown variable "ghost"/)
  })
})

describe('lint — send / text()', () => {
  it('valid send (numeric and text payload): no diagnostic', () => {
    const d = lint('let x = 0\nwhen clicked {\n  send "correct", x + 1\n  send "answer", text("card0")\n}')
    expect(d).toEqual([])
  })
  it('text("…") outside a send payload → dedicated error', () => {
    const d = lint('when clicked {\n  x = text("card0")\n}')
    expect(d.some((e) => /text\("…"\) is only allowed as an argument to "send"/.test(e.message))).toBe(true)
  })
})

describe('lint — lintReport (repair loop)', () => {
  it('correct code → empty string', () => {
    expect(lintReport('let score = 0\nevery frame { score = score + 1 }')).toBe('')
  })
  it('errors → "line:col: message" lines', () => {
    const r = lintReport('rotation = wobble(time)')
    expect(r).toMatch(/^\d+:\d+: unknown function "wobble"/)
  })
})

// flatink/flatink#65 — arguments were never counted: `round(3.14159, 2)` is 3, `clamp(a, 0)` is 0 (NaN,
// then the fallback), `random(10)` stays in 0..1, and a missing argument of a user / package function is 0.
describe('lint — a call has the right number of arguments', () => {
  const msgs = (src: string, ctx = {}) => lint(src, ctx).map((d) => d.message)
  it('built-in functions', () => {
    expect(msgs('let a = 0\nx = round(3.14159, 2)')).toEqual([expect.stringMatching(/round.*1 argument.*2/)])
    expect(msgs('let a = 0\nx = clamp(a, 0)')).toEqual([expect.stringMatching(/clamp.*3 arguments.*2/)])
    expect(msgs('x = random(10)')).toEqual([expect.stringMatching(/random.*no argument.*1/)])
    expect(msgs('x = atan2(1)')).toEqual([expect.stringMatching(/atan2.*2 arguments/)])
  })
  it('variadic ones take one or more', () => {
    expect(msgs('x = max(1, 2, 3) + min(4) + hypot(3, 4)')).toEqual([])
    expect(msgs('x = max()')).toEqual([expect.stringMatching(/max.*at least 1/)])
  })
  it('user and package functions, and procedures', () => {
    expect(msgs('fn f(a, b) = a + b\nx = f(1)')).toEqual([expect.stringMatching(/"f".*2 arguments.*1/)])
    expect(msgs('use "collision"\nx = dist(3, 4)')).toEqual([expect.stringMatching(/dist.*4 arguments.*2/)])
    expect(msgs('fn reset(n) {\n  score = n\n}\nwhen clicked {\n  reset()\n}')).toEqual([expect.stringMatching(/reset.*1 argument.*0/)])
    expect(msgs('x = g(1)', { functions: ['g'], arities: { g: 2 } })).toEqual([expect.stringMatching(/"g".*2 arguments/)])
  })
  // `a = nothing(1)` was an error, the statement `nothing()` was not: it was skipped at runtime.
  it('a procedure call names a known procedure', () => {
    expect(msgs('when clicked {\n  nothing()\n}')).toEqual([expect.stringMatching(/unknown procedure "nothing"/)])
    expect(msgs('fn hop() {\n  x = 1\n}\nwhen clicked {\n  hop()\n}')).toEqual([])
  })
})

// flatink/flatink#68 (from #65.5c) — an unknown FIELD read 0 in silence (`B.zoom`, `mouse.down`), while an
// unknown object was already an error. A warning: an instance's fields depend on its symbol.
describe('lint — a field the object does not have', () => {
  const warns = (src: string, ctx = {}) => lint(src, ctx).map((d) => `${d.severity ?? 'error'}: ${d.message}`)
  it('mouse, self and named objects', () => {
    expect(warns('x = mouse.down')).toEqual([expect.stringMatching(/^warning: .*mouse.*no field "down".*wheel/)])
    expect(warns('x = mouse.x + mouse.dy + mouse.wheel')).toEqual([])
    expect(warns('x = self.hovered + self.rotation')).toEqual([])
    expect(warns('x = B.zoom', { objects: ['B'] })).toEqual([expect.stringMatching(/^warning: .*"B" has no field "zoom"/)])
    expect(warns('x = B.rotation + B.opacity', { objects: ['B'] })).toEqual([])
    expect(warns('x = keys.Space + keys.ArrowLeft')).toEqual([]) // keys are open-ended
  })
  it('an instance also answers to its params and states', () => {
    expect(warns('x = R.bras + R.queue', { objects: ['R'], fields: { R: ['bras', 'queue'] } })).toEqual([])
    expect(warns('x = R.brass', { objects: ['R'], fields: { R: ['bras'] } })).toEqual([expect.stringMatching(/no field "brass".*did you mean "bras"/)])
  })
})

// Security pass: an object named like an `Object.prototype` member made the field check read a FUNCTION from
// the table of built-in fields (`allowed.includes is not a function`) and `--check` crashed.
describe('lint — names that exist on Object.prototype', () => {
  it('an object named `toString` or `constructor` is an ordinary object', () => {
    expect(() => lint('x = toString.x + constructor.y', { objects: ['toString', 'constructor'] })).not.toThrow()
    expect(lint('x = toString.zoom', { objects: ['toString'] }).map((d) => d.message)).toEqual([expect.stringMatching(/no field "zoom"/)])
  })
})
