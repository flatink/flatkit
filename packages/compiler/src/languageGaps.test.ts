import { describe, it, expect } from 'vitest'
import type { Doc, Group, Instance, Item, Transform } from '@flatkit/types'
import { apply } from '@flatkit/engine/transform'
import { compileExpr, evalExpr, exprScope } from '@flatkit/engine/expr'
import { parseFlat } from '@flatkit/engine/flatFormat'
import { playHeadless } from '@flatkit/player/debug'
import { compileFlatpack } from './compile'
import { checkProgram } from './check'

// Four places where the language refused something it accepts one block away. Each was reported by a
// crew writing real activities, with the workaround they had settled on (a 65 KB generated library, a
// dummy parameter on every local symbol, an `expr` for a fixed angle, a global array per lookup table).

const items = (doc: Doc): Item[] => doc.layers.flatMap((l) => l.items)

// flatink/flatink#15
describe('`repeat` in a `.flat` library', () => {
  const LIB = `symbol "Teeth" {
  layer "a" {
    repeat i from 0 to 3 { circle $(i*20) 0 6 fill #333333 }
  }
}`
  it('is unfolded, as it is in a program', () => {
    const [sym] = parseFlat(LIB)
    expect(sym.name).toBe('Teeth')
    expect(sym.layers[0].items).toHaveLength(4)
  })
  it('takes `def` constants and nests', () => {
    const [sym] = parseFlat(`def n = 2
symbol "Grid" {
  layer "a" {
    repeat r from 0 to $(n) { repeat c from 0 to 1 { rect $(c*10) $(r*10) 8 8 fill #333333 } }
  }
}`)
    expect(sym.layers[0].items).toHaveLength(6)
  })
  it('a library without `repeat` is read exactly as before', () => {
    const [sym] = parseFlat('symbol "One" {\n  layer "a" { circle 0 0 6 fill #333333 }\n}')
    expect(sym.layers[0].items).toHaveLength(1)
  })
})

// flatink/flatink#27
describe('a plain `symbol` written in the program', () => {
  const PROG = `size 200 200
symbol "Dot" {
  timeline 24 24
  layer "a" {
    group "Core" at 0,0 { layer "c" { circle 0 0 10 fill #cc3333 } }
    cel 0 tween { pose "Core" scale 1 }
    cel 24 { pose "Core" scale 2 }
  }
}
scene { layer "c" { instance "Dot" as "P" at 100,100 } }
object "P" { when clicked { send "hit" } }
`
  it('compiles: the instance resolves to it, with no library', () => {
    const r = checkProgram(PROG)
    expect(r.report).toBe('')
    const doc = compileFlatpack(PROG)
    expect(doc.symbols.map((s) => s.name)).toEqual(['Dot'])
    const inst = items(doc)[0] as Instance
    expect(inst.symbolId).toBe(doc.symbols[0].id)
  })
  it('keeps what makes it a symbol: its own timeline and cels', () => {
    const sym = compileFlatpack(PROG).symbols[0]
    expect(sym.timeline?.durationFrames).toBe(24)
    expect(sym.layers[0].cels ?? []).toHaveLength(2)
    // …and the symbol's `timeline 24 24` is not taken for the program's.
    expect(compileFlatpack(PROG).timeline?.durationFrames).toBe(60)
  })
  it('the behaviour around it still runs', () => {
    const r = playHeadless(compileFlatpack(PROG), [{ type: 'tap', target: 'P' }])
    expect(r.sends.map((s) => s.name)).toEqual(['hit'])
  })
  it('may sit after the scene, and next to a library', () => {
    const src = `size 200 200
scene { layer "c" { instance "Dot" as "P" at 100,100
  instance "Lib" as "Q" at 20,20 } }
symbol "Dot" { layer "a" { circle 0 0 10 fill #cc3333 } }
`
    const doc = compileFlatpack(src, ['symbol "Lib" { layer "a" { circle 0 0 4 fill #3333cc } }'])
    expect(doc.symbols.map((s) => s.name).sort()).toEqual(['Dot', 'Lib'])
    expect(checkProgram(src, { assetSrcs: ['symbol "Lib" { layer "a" { circle 0 0 4 fill #3333cc } }'] }).report).toBe('')
  })
  it('a parameterized symbol of the same program is untouched', () => {
    const doc = compileFlatpack(`size 200 200
symbol "Pill"(w) { layer "a" { rect 0 0 $(w) 10 fill #cc3333 } }
symbol "Dot" { layer "a" { circle 0 0 10 fill #cc3333 } }
scene { layer "c" { instance "Pill"(40) as "A" at 10,10
  instance "Dot" as "B" at 100,100 } }
`)
    expect(doc.symbols.map((s) => s.name)).toEqual(['Dot'])
    expect(items(doc).map((i) => ('kind' in i ? i.kind : 'shape'))).toEqual(['group', 'instance'])
  })
})

// flatink/flatink#28
describe('`rotate` / `scale` where a group or an instance is declared', () => {
  const tf = (decl: string, lib: string[] = []): Transform => (items(compileFlatpack(`size 200 200\nscene { layer "c" { ${decl} } }\n`, lib))[0] as Group).transform
  const near = (p: { x: number; y: number }, x: number, y: number) => { expect(p.x).toBeCloseTo(x, 6); expect(p.y).toBeCloseTo(y, 6) }
  const BODY = '{ layer "a" { rect -20 -20 40 40 fill #cc3333 } }'

  it('`rotate` is in degrees, as in a pose', () => {
    const t = tf(`group "G" at 100,100 rotate 90 ${BODY}`)
    near(apply(t, { x: 0, y: 0 }), 100, 100) // the origin stays where `at` put it
    near(apply(t, { x: 10, y: 0 }), 100, 110) // a quarter turn, clockwise on screen
  })
  it('`scale`, `scaleX` and `scaleY`', () => {
    near(apply(tf(`group "G" at 100,100 scale 2 ${BODY}`), { x: 10, y: 5 }), 120, 110)
    near(apply(tf(`group "G" at 100,100 scaleX 3 scaleY 0.5 ${BODY}`), { x: 10, y: 10 }), 130, 105)
  })
  it('they turn around the pivot, which stays in place', () => {
    const t = tf(`group "G" at 100,100 pivot 20,0 rotate 180 scale 2 ${BODY}`)
    near(apply(t, { x: 20, y: 0 }), 120, 100) // the pivot has not moved
    near(apply(t, { x: 0, y: 0 }), 160, 100)
  })
  it('written before or after `pivot`, it is the same', () => {
    expect(tf(`group "G" at 100,100 rotate 30 pivot 20,0 ${BODY}`)).toEqual(tf(`group "G" at 100,100 pivot 20,0 rotate 30 ${BODY}`))
  })
  it('on an instance too', () => {
    const t = tf('instance "Dot" as "D" at 50,50 rotate 90', ['symbol "Dot" { layer "a" { circle 0 0 10 fill #cc3333 } }'])
    near(apply(t, { x: 10, y: 0 }), 50, 60)
  })
  it('a group without them is placed exactly as before', () => {
    expect(tf(`group "G" at 100,100 ${BODY}`)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 100, f: 100 })
  })
})

// flatink/flatink#29
describe('a table written in place: `[a, b, c][i]`', () => {
  const ev = (src: string, vars: Record<string, unknown> = {}) => {
    const c = compileExpr(src)
    if (!c.ok) throw new Error(c.error)
    return evalExpr(c.node, exprScope(vars as never, 0, 0), Number.NaN)
  }
  it('picks the element', () => {
    expect(ev('[1, 2, 3][i]', { i: 1 })).toBe(2)
    expect(ev('[10, 20, 30][0] + [10, 20, 30][2]')).toBe(40)
  })
  it('elements and index are expressions', () => {
    expect(ev('[a * 2, a + 1, 7][(a > 2) ? 0 : 2]', { a: 5 })).toBe(10)
    expect(ev('[[1, 2][1], 9][0]')).toBe(2)
  })
  it('indexes as an array variable does: rounded, and nothing outside the table', () => {
    expect(ev('[1, 2, 3][0.6]')).toBe(2)
    expect(ev('[1, 2, 3][5]')).toBeNaN()
    expect(ev('[1, 2, 3][-1]')).toBeNaN()
  })
  it('a table that is not indexed is an error that says so', () => {
    const c = compileExpr('[1, 2, 3]')
    expect(c.ok).toBe(false)
    expect(!c.ok && c.error).toMatch(/index/)
  })
  it('runs in a program', () => {
    const doc = compileFlatpack(`size 200 200
var i = 1
var v = 0
scene { layer "c" { group "G" at 100,100 { layer "a" { circle 0 0 10 fill #cc3333 } } } }
every frame { v = [1, 2, 3][i] }
`)
    expect(playHeadless(doc, [{ type: 'wait', frames: 2 }]).vars.v).toBe(2)
  })
  it('and `--check` knows the names it reads', () => {
    const r = checkProgram(`size 200 200
var v = 0
scene { layer "c" { group "G" at 100,100 { layer "a" { circle 0 0 10 fill #cc3333 } } } }
every frame { v = [1, nope, 3][0] }
`)
    expect(r.report).toMatch(/nope/)
  })
})

// Found by a review: a `repeat` whose bound was not a constant unfolded ZERO times, in silence — a
// program's `def` used inside its own plain `symbol` (the defs were not passed to it), and a param used as
// a bound in a `.flat` (a param is not known when the library is read).
describe('`repeat` bounds', () => {
  it("a program's `def` bounds a `repeat` in the program's own plain symbol", () => {
    const doc = compileFlatpack('size 300 300\ndef N = 3\nsymbol "Dots" {\n  layer "a" {\n    repeat i from 0 to N {\n      circle $(i * 20) 0 5 fill #ff0000\n    }\n  }\n}\nscene {\n  layer "c" { instance "Dots" at 50,50 }\n}\n')
    expect(doc.symbols[0].layers[0].items).toHaveLength(4)
  })
  it('a bound that is not a constant is an error that says so, not zero iterations', () => {
    const LIB = 'symbol "Row" {\n  params { number count = 3 range 1 9 "count" }\n  layer "a" {\n    repeat i from 0 to count - 1 { circle $(i*10) 0 3 fill #333333 }\n  }\n}\n'
    expect(() => parseFlat(LIB)).toThrow(/repeat.*constant.*"count - 1"/s)
  })
})
