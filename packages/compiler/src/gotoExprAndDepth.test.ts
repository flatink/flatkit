import { describe, it, expect } from 'vitest'
import { playHeadless } from '@flatkit/player/debug'
import { parseUnits, printUnits } from '@flatkit/engine/dsl'
import { compileFlatpack } from './compile'
import { checkProgram } from './check'

// Reported by Moiki: a generated activity ("orgue") held a 690-line function that only chose where to
// jump — `if mes == 0 { go to frame 5160 } else if mes == 1 { go to frame 5221.364 } …`, 343 branches —
// because `go to frame` took a literal and nothing else. Each `else if` nests the compiled document two
// levels deeper: 224 levels, and the host's database refuses a document past 180.
const stage = 'size 100 100\ntimeline 60 6000\nvar mes = 3\nvar R = 1\nvar T = [5160, 5221.364, 5282.727, 5344.091]\nvar pos = 0\nscene { layer "l" { group "G" at 10,10 { layer "c" { rect 0 0 40 40 fill #cc3333 } } } }\nevery frame { pos = frame }\n'
const tapped = (behavior: string) => playHeadless(compileFlatpack(stage + behavior), [{ type: 'tap', target: 'G', settle: 0 }, { type: 'wait', frames: 1 }], { settle: 0 }).vars.pos as number

describe('`go to frame <expression>`', () => {
  it('a table: the jump is read from an array', () => {
    const src = stage + 'object "G" { when clicked { go to frame T[mes] and pause } }\n'
    expect(checkProgram(src).errors).toBe(0)
    expect(tapped('object "G" { when clicked { go to frame T[mes] and pause } }\n')).toBeCloseTo(5344.091, 3)
  })
  it('a formula', () => {
    expect(tapped('object "G" { when clicked { go to frame 5160 + mes * 61.364 and pause } }\n')).toBeCloseTo(5344.092, 3)
  })
  it('`and play` / `and pause` still close the statement, and neither is needed', () => {
    expect(tapped('object "G" { when clicked { go to frame T[0] + 10 and play } }\n')).toBeCloseTo(5171, 0) // one step further: it plays
    expect(compileFlatpack(stage + 'object "G" { when clicked { go to frame T[0] } }\n').interactions![0]!.actions[0]).toEqual({ do: 'gotoFrame', frame: 0, expr: 'T[0]' })
  })
  it('a literal compiles exactly as before: older players read it', () => {
    expect(compileFlatpack(stage + 'object "G" { when clicked { go to frame 12.5 and pause } }\n').interactions![0]!.actions[0]).toEqual({ do: 'gotoFrame', frame: 12.5, play: false })
  })
  it('an unknown name in it is reported like in any expression', () => {
    expect(checkProgram(stage + 'object "G" { when clicked { go to frame nope + 1 } }\n').report).toMatch(/unknown variable "nope"/)
  })
  it('nothing after `frame` is still an error that says what is expected', () => {
    expect(checkProgram(stage + 'object "G" { when clicked {\n  go to frame\n} }\n').report).toMatch(/a frame number or an expression expected after "frame"/)
  })
  it('`and` followed by anything else keeps its own message', () => {
    expect(checkProgram(stage + 'object "G" { when clicked { go to frame 12 and stop } }\n').report).toMatch(/"play" or "pause" expected after "and"/)
    expect(checkProgram(stage + 'object "G" { when clicked { go to frame T[mes] and } }\n').report).toMatch(/"play" or "pause" expected after "and"/)
  })
  it('a value that is not a number moves nothing', () => {
    expect(tapped('object "G" { when clicked { go to frame 0 / 0 and pause } }\n')).toBeLessThan(5)
  })
  it('the text round-trips', () => {
    const text = 'when loaded {\n  go to frame 12\n  go to frame T[mes] + 1 and play\n  go to frame start and pause\n}\n'
    expect(printUnits(parseUnits(text).units)).toBe(text)
  })
})

const chain = (n: number, into = 'hit') => ['fn sauter() {', '  if R == 0 {', `    ${into} = 0`, ...Array.from({ length: n - 1 }, (_, i) => `  } else if R == ${i + 1} {\n    ${into} = ${i + 1}`), '  }', '}'].join('\n')
const prog = (n: number) => `size 100 100\nvar R = ${n - 1}\nvar hit = 0\nscene { layer "l" { group "G" at 10,10 { layer "c" { rect 0 0 40 40 fill #cc3333 } } } }\n${chain(n)}\nobject "G" { when clicked { sauter() } }\n`

describe('a compiled document that nests too deep', () => {
  it('--check warns past 100 levels, names the function and says what to write instead', () => {
    const r = checkProgram(prog(60))
    expect(r.ok).toBe(true)
    const d = r.diagnostics.find((x) => /levels deep/.test(x.message))!
    expect(d).toMatchObject({ severity: 'warning', line: 5 })
    expect(d.message).toMatch(/^fn sauter: the compiled document is 12\d levels deep/)
    expect(d.message).toContain('go to frame T[i]')
  })
  it('a chain that stays under it says nothing', () => {
    expect(checkProgram(prog(40)).report).not.toMatch(/levels deep/)
  })
  it('a handler is named by its object and event; a scene by its deepest group', () => {
    const handler = `size 100 100\nvar R = 0\nvar hit = 0\nscene { layer "l" { group "G" at 10,10 { layer "c" { rect 0 0 40 40 fill #cc3333 } } } }\nobject "G" { when clicked {\n${chain(60).split('\n').slice(1, -1).join('\n')}\n} }\n`
    expect(checkProgram(handler).report).toMatch(/object "G", when clicked: the compiled document is \d+ levels deep/)
    const nested = 'size 100 100\nscene { layer "l" {\n' + Array.from({ length: 30 }, (_, i) => `group "G${i}" at 0,0 { layer "c" {\n`).join('') + 'rect 0 0 4 4 fill #333333\n' + '} }\n'.repeat(30) + '} }\n'
    expect(checkProgram(nested).report).toMatch(/group "G\d+": the compiled document is \d+ levels deep/)
  })
  it('256 blocks deep still compiles and plays', () => {
    const r = checkProgram(prog(256))
    expect(r.errors).toBe(0)
    expect(playHeadless(compileFlatpack(prog(256)), [{ type: 'tap', target: 'G' }]).vars.hit).toBe(255)
  })
  it('past that it is ONE compile error, not a crash of the compiler — at any length', () => {
    for (const n of [258, 2000, 20000]) {
      const r = checkProgram(prog(n))
      expect(r.ok, String(n)).toBe(false)
      expect(r.diagnostics.filter((d) => d.severity === 'error'), String(n)).toHaveLength(1)
      expect(r.report, String(n)).toMatch(/blocks nested more than 256 deep/)
    }
  })
})

// Review pass: the other things that nest. Each ended on "Maximum call stack size exceeded" — as the text of
// a diagnostic for parentheses and groups, as an uncaught crash of the compiler for a run of 5000 `-`.
// (Measured on 1197 consumer sources: parentheses nest 11 deep at most, braces 16.)
describe('other nestings past any real program', () => {
  const head = 'size 100 100\nvar a = 0\nscene { layer "l" { group "G" at 10,10 { layer "c" { rect 0 0 40 40 fill #cc3333 } } } }\n'
  const groups = (n: number) => 'size 100 100\nscene { layer "l" {\n' + Array.from({ length: n }, (_, i) => `group "G${i}" at 0,0 { layer "c" {\n`).join('') + 'rect 0 0 4 4 fill #333333\n' + '} }\n'.repeat(n) + '} }\n'
  for (const n of [300, 5000, 50000]) {
    it(`${n} nested parentheses: an error that says so`, () => {
      const r = checkProgram(head + `object "G" { when clicked { a = ${'('.repeat(n)}1${')'.repeat(n)} } }\n`)
      expect(r.ok).toBe(false)
      expect(r.report).toMatch(/nested more than 200 deep/)
      expect(r.report).not.toMatch(/call stack/)
    })
    it(`${n} stacked \`-\`: the same, and no crash`, () => {
      const r = checkProgram(head + `object "G" { when clicked { a = ${'-'.repeat(n)}1 } }\n`)
      expect(r.ok).toBe(false)
      expect(r.report).toMatch(/nested more than 200 deep/)
    })
    it(`${n} nested groups: one compile error that says so`, () => {
      const r = checkProgram(groups(n))
      expect(r.ok).toBe(false)
      expect(r.report).toMatch(/nested more than 256 deep/)
      expect(r.report).not.toMatch(/call stack/)
    })
  }
  it('what a real program nests still goes through: 150 parentheses, 200 groups', () => {
    expect(checkProgram(head + `object "G" { when clicked { a = ${'('.repeat(150)}1${')'.repeat(150)} + ${'-'.repeat(150)}1 } }\n`).errors).toBe(0)
    expect(checkProgram(groups(200)).errors).toBe(0)
  })
  it('many groups side by side are not nesting', () => {
    const flat = 'size 100 100\nscene { layer "l" {\n' + Array.from({ length: 1000 }, (_, i) => `group "G${i}" at 0,0 { layer "c" { rect 0 0 4 4 fill #333333 } }\n`).join('') + '} }\n'
    expect(checkProgram(flat).errors).toBe(0)
    expect(checkProgram(head + `object "G" { when clicked { a = ${Array.from({ length: 400 }, () => '(1)').join(' + ')} } }\n`).errors).toBe(0)
  })
})
