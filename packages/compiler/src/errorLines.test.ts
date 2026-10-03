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
