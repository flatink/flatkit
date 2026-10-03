import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkProgram } from './check'
import { compileFlatpack } from './compile'
import { run } from './cli/flatc'

// A syntax error must point at the line of the AUTHOR's file. It did in a plain scene; it was off by the
// number of `def` lines and template blocks above it (they were cut out of the text before parsing), it
// pointed inside a re-built text for an error in the program's own `symbol`, and `flatc` printed no line
// at all.
const at = (src: string): string => /(\d+):(\d+): error/.exec(checkProgram(src).report)?.slice(1, 3).join(':') ?? ''
const BAD = 'circle 0 0 5 fill #ff0000 bogus 3'

describe('a syntax error is reported at its line in the source', () => {
  it('in the scene, under `def`s and a parameterized symbol', () => {
    const src = `size 100 100\ndef K = 2\ndef L = 3\nsymbol "T"(a) { layer "a" { circle 0 0 $(a) fill #000000 } }\nscene {\n  layer "c" {\n    ${BAD}\n  }\n}\n`
    expect(at(src)).toBe('7:31')
  })
  it("in the program's own plain symbol", () => {
    const src = `size 300 300\nvar n = 0\n\n\n\nsymbol "Dot" {\n  layer "a" {\n    ${BAD}\n  }\n}\nscene {\n  layer "c" { instance "Dot" at 50,50 }\n}\n`
    expect(at(src)).toBe('8:31')
  })
  it('`flatc` prints it as file:line:col', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flatc-errline-'))
    try {
      writeFileSync(join(dir, 'p.flatink'), `size 100 100\ndef K = 2\nscene {\n  layer "c" {\n    ${BAD}\n  }\n}\n`)
      const errs: string[] = []
      const se = vi.spyOn(process.stderr, 'write').mockImplementation((x: string | Uint8Array) => { errs.push(String(x)); return true })
      try { expect(run(['node', 'flatc', join(dir, 'p.flatink'), '--check', '--no-libs'])).toBe(1) } finally { se.mockRestore() }
      expect(errs.join('')).toMatch(/p\.flatink:5:31: compile error: "layer" expected, "bogus" found/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe("a parameterized symbol used inside the program's own plain symbol", () => {
  it('is unfolded there too, instead of failing on "("', () => {
    const src = 'size 300 300\nsymbol "Dot"(r = 5, c = #ff0000) {\n  layer "a" { circle 0 0 $(r) fill $(c) }\n}\nsymbol "Pair" {\n  layer "a" {\n    instance "Dot"(8) at 0,0\n    instance "Dot"(4, #0000ff) at 20,0\n  }\n}\nscene {\n  layer "c" { instance "Pair" at 50,50 }\n}\n'
    expect(checkProgram(src).report).toBe('')
    const pair = compileFlatpack(src).symbols.find((s) => s.name === 'Pair')!
    expect(pair.layers[0].items.map((i) => ('kind' in i ? i.kind : 'shape'))).toEqual(['group', 'group'])
  })
})

// A scene `repeat` puts one item per line when it unfolds, so every line below it moved down: a loop of ten
// made an error further down — in the scene or in an `object` block after it — 28 lines too low. The
// unfolded text now keeps the line count of the source: an error INSIDE the loop is reported at the line of
// the `repeat`, an error after it at its own line. Same for a parameterized symbol unfolded at its call.
describe('a syntax error after an unfolded loop or symbol keeps its line', () => {
  const loop = 'size 300 300\nvar n = 0\nscene {\n  layer "c" {\n    repeat i from 0 to 9 {\n      circle $(i*20) 10 5 fill #000000\n    }\n'
  it('in the scene, below a loop', () => {
    expect(at(loop + `    ${BAD}\n  }\n}\n`)).toBe('8:31')
  })
  it('in the behaviour after the scene', () => {
    const r = checkProgram(loop + '  }\n}\nobject "Nope" { x = 1 }\nevery frame { n = n + }\n').report
    expect(r).toMatch(/\[object "Nope"\] 10:/)
    expect(r).toMatch(/\[scene\] 11:/)
  })
  it('inside the loop: at the line of the `repeat`', () => {
    expect(at('size 300 300\nscene {\n  layer "c" {\n    repeat i from 0 to 2 {\n      circle $(i*20) 10 5 fill #000000 bogus 1\n    }\n  }\n}\n').split(':')[0]).toBe('4')
  })
  it('below an instance of a multi-line parameterized symbol', () => {
    const src = `size 300 300\nsymbol "Card"(t) {\n  layer "a" {\n    rect 0 0 40 20 fill #333333\n    circle 0 0 3 fill $(t)\n  }\n}\nscene {\n  layer "c" {\n    instance "Card"(#ff0000) as "C1" at 10,10\n    instance "Card"(#00ff00) as "C2" at 60,10\n    ${BAD}\n  }\n}\n`
    expect(at(src)).toBe('12:31')
  })
  it('a comment inside a loop body still ends at its line', () => {
    const doc = compileFlatpack('size 300 300\nscene {\n  layer "c" {\n    repeat i from 0 to 2 {\n      circle $(i*20) 10 5 fill #000000 // dot $(i)\n    }\n  }\n}\n')
    expect(doc.layers[0].items).toHaveLength(3)
  })
})

describe('what an unfolded body may hold', () => {
  it('comments with braces and quotes inside a loop, and a nested loop below them, still parse', () => {
    const src = 'size 400 400\nscene {\n  layer "c" {\n    repeat i from 0 to 2 {\n      // a { brace and a "quote\n      circle $(i*20) 10 5 fill #000000\n      repeat j from 0 to 1 {\n        circle $(i*20) $(20 + j*10) 2 fill #333333\n      }\n    }\n  }\n}\nobject "Missing" { x = 1 }\n'
    const r = checkProgram(src)
    expect(r.errors).toBe(1) // only the object that binds to nothing…
    expect(r.report).toMatch(/\[object "Missing"\] 13:/) // …at its own line
    expect(compileFlatpack(src).layers[0].items).toHaveLength(9)
  })
})
