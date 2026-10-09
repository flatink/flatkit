import { describe, it, expect } from 'vitest'
import { parseFlatLib } from '@flatkit/engine/flatFormat'
import { compileFlatpack } from './compile'
import { checkProgram } from './check'

// Reported by flatink (forge): two `symbol "Pastille"` in one program compiled without a word. The pack
// carried both under the same name, the instances went to the LAST declared, and the first was drawn
// nowhere. An author who reuses a name by accident saw a drawing that was not theirs, with no lead.
// Measured before refusing: 0 of 1106 `.flat` / `.flatink` sources of the consumer repos declare a name twice.
const red = 'symbol "Pastille" { layer "c" { circle 0 0 20 fill #ff0000 } }'
const blue = 'symbol "Pastille" { layer "c" { circle 0 0 20 fill #0000ff } }'
const scene = 'size 200 100\nscene { layer "l" { instance "Pastille" as "p" at 100,50 } }'

describe('a symbol name declared twice', () => {
  it('in a program: a compile error on the second, naming the line of the first', () => {
    const r = checkProgram(`${scene}\n${red}\n${blue}\n`)
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', line: 4, col: 1 })
    expect(r.diagnostics[0].message).toContain('symbol "Pastille" is already declared at line 3')
  })
  it('in a `.flat` library: the same error', () => {
    expect(() => parseFlatLib(`${red}\n\n${blue}\n`)).toThrow('symbol "Pastille" is already declared at line 1')
  })
  it('a parameterized `symbol "X"(…)`: the same error', () => {
    const tmpl = (shape: string) => `symbol "Jeton"(c) { layer "c" { ${shape} fill $(c) } }`
    const r = checkProgram(`size 200 100\n${tmpl('circle 0 0 20')}\n${tmpl('rect 0 0 20 20')}\nscene { layer "l" { instance "Jeton"(#ff0000) as "j" at 100,50 } }\n`)
    expect(r.ok).toBe(false)
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', line: 3 })
    expect(r.diagnostics[0].message).toContain('symbol "Jeton" is already declared at line 2')
  })
})

describe('what does not change', () => {
  it('a program symbol still wins over a LIBRARY symbol of the same name, without a word (flatink/flatink#27)', () => {
    const doc = compileFlatpack(`${scene}\n${blue}\n`, [red])
    const inst = doc.layers[0].items[0] as { symbolId: string }
    const drawn = doc.symbols.find((s) => s.id === inst.symbolId)!
    expect(JSON.stringify(drawn)).toContain('#0000ff')
    expect(checkProgram(`${scene}\n${blue}\n`, { assetSrcs: [red] }).report).toBe('')
  })
  it('a template and a plain symbol of one name live side by side: one is called with parens, the other without', () => {
    const src = 'size 200 100\nsymbol "P"(c) { layer "c" { circle 0 0 20 fill $(c) } }\nsymbol "P" { layer "c" { rect 0 0 20 20 fill #0000ff } }\nscene { layer "l" {\n  instance "P"(#ff0000) as "p" at 100,50\n  instance "P" as "q" at 10,10\n} }\n'
    expect(checkProgram(src).ok).toBe(true)
  })
})

// Two LIBRARIES that declare one name: the last one read is the one instanced. `flatc` reads every `.flat`
// of the program's folder, so "last" is a matter of file names — and nothing said a symbol was shadowed.
describe('a symbol name declared by two libraries', () => {
  it('checkProgram: a warning that names both libraries and the one that is instanced', () => {
    const r = checkProgram(`${scene}\n`, { assetSrcs: [red, blue], assetNames: ['rouge.flat', 'bleu.flat'] })
    expect(r.ok).toBe(true)
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0]).toMatchObject({ severity: 'warning', line: 2 })
    expect(r.diagnostics[0].message).toContain('symbol "Pastille" is declared by rouge.flat and bleu.flat')
    expect(r.diagnostics[0].message).toContain('bleu.flat is the one instanced')
  })
  it('without names, the libraries are numbered in the order given', () => {
    expect(checkProgram(`${scene}\n`, { assetSrcs: [red, blue] }).report).toContain('declared by library 1 and library 2')
  })
  it('no warning when the program declares that name itself: its own symbol is the one instanced', () => {
    expect(checkProgram(`${scene}\n${blue}\n`, { assetSrcs: [red, red] }).report).toBe('')
  })
  it('no warning for two libraries with different names', () => {
    expect(checkProgram(`${scene}\n`, { assetSrcs: [red, red.replace('Pastille', 'Autre')] }).report).toBe('')
  })
})
