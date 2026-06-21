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

  it('unknown variable (with "let" hint when no variable is known)', () => {
    const d = lint('rotation = speed * 2')
    expect(d.length).toBe(1)
    expect(d[0].message).toMatch(/unknown variable "speed".*let/)
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
