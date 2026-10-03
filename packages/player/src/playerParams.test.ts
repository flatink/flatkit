// Symbol params the picture reads directly: `text` (flatink/flatink#9) and `color` written while the scene
// plays (flatink/flatink#26). Both are resolved per instance when it is drawn.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FlatPlayer } from './player'
import { parseProgramFull, parseFlat } from '@flatkit/engine/flatFormat'
import { exprCacheSize } from '@flatkit/engine/expr'
import type { Doc, Instance } from '@flatkit/types'
import { IDENTITY } from '@flatkit/engine/transform'

/** A 2D context that records the texts drawn and the fill colour of every `fill()`. */
const recorder = () => {
  const seen = { texts: [] as string[], fills: [] as string[] }
  const state: Record<string, unknown> = { fillStyle: '' }
  const ctx = new Proxy(state, {
    get: (t, p) => p === 'fillText' ? (s: string) => { seen.texts.push(s) }
      : p === 'fill' ? () => { seen.fills.push(String(t.fillStyle)) }
      : p === 'measureText' ? (s: string) => ({ width: s.length * 8 })
      : p === 'getTransform' ? () => IDENTITY
      : p in t ? t[p as string] : () => {},
    set: (t, p, v) => { t[p as string] = v; return true },
  }) as unknown as CanvasRenderingContext2D
  const canvas = { getContext: () => ctx, getBoundingClientRect: () => ({ width: 200, height: 100, left: 0, top: 0, right: 200, bottom: 100 }), addEventListener: () => {}, removeEventListener: () => {}, style: {} } as unknown as HTMLCanvasElement
  return { canvas, seen, reset: () => { seen.texts.length = 0; seen.fills.length = 0 } }
}

beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 })
  vi.stubGlobal('addEventListener', () => {}); vi.stubGlobal('removeEventListener', () => {})
  vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('Path2D', class { addPath() {} rect() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {} closePath() {} arc() {} ellipse() {} })
})
afterEach(() => vi.unstubAllGlobals())

const [button] = parseFlat([
  'symbol "Bouton" {', '  params {', '    text libelle = "OK"', '    color fond = #3366cc', '  }',
  '  layer "l" {', '    rect -40 -15 80 30 fill fond', '    text libelle at -40,-10 font "sans-serif" size 16 align center line 1.2 color #ffffff box 80 20', '  }', '}', '',
].join('\n'))
/** A scene with the given instances of "Bouton" (named B0, B1…), and optional behavior. */
function scene(insts: Array<Record<string, string> | undefined>, behavior = ''): Doc {
  const doc = parseProgramFull(`size 200 100\nvar go = 0\nscene {\n  layer "c" {\n  }\n}\n${behavior}\n`) as unknown as Doc
  doc.layers[0].items.push(...insts.map((params, i): Instance => ({ id: `b${i}`, kind: 'instance', name: `B${i}`, transform: IDENTITY, symbolId: button.id, ...(params ? { params } : {}) })))
  doc.symbols = [button]
  return doc
}

describe('FlatPlayer — a `text` param is what the instance says', () => {
  it('each instance draws its own label, the default when it gives none', () => {
    const r = recorder()
    new FlatPlayer(r.canvas, scene([{ libelle: 'Valider' }, undefined, { libelle: 'Effacer tout' }]), { input: false, audio: false })
    expect(r.seen.texts).toEqual(['Valider', 'OK', 'Effacer tout'])
  })
  it('`B0.libelle = "…"` changes it while the scene runs', () => {
    const r = recorder()
    const pl = new FlatPlayer(r.canvas, scene([{ libelle: 'Valider' }, undefined], 'every frame {\n  if go == 1 {\n    B0.libelle = "Bravo !"\n  }\n}'), { input: false, audio: false })
    pl.setVar('go', 1); pl.stepSim(1); r.reset(); pl.render()
    expect(r.seen.texts).toEqual(['Bravo !', 'OK'])
  })
  it('a new document forgets what the old one was told', () => {
    const r = recorder()
    const pl = new FlatPlayer(r.canvas, scene([undefined], 'when loaded {\n  B0.libelle = "Bravo !"\n}'), { input: false, audio: false })
    pl.load(scene([undefined])); r.reset(); pl.render()
    expect(r.seen.texts).toEqual(['OK'])
  })
})

describe('FlatPlayer — a `color` param written while the scene runs', () => {
  const fillsOf = (behavior: string, steps = 1) => {
    const r = recorder()
    const pl = new FlatPlayer(r.canvas, scene([{ fond: '#cc3333' }, undefined], behavior), { input: false, audio: false })
    pl.setVar('go', 1); pl.stepSim(steps); r.reset(); pl.render()
    return r.seen.fills
  }
  it('`B0.fond = #33aa33` repaints that instance in the new colour, and only that one', () => {
    expect(fillsOf('')).toEqual(['#cc3333', '#3366cc'])
    expect(fillsOf('every frame {\n  if go == 1 {\n    B0.fond = #33aa33\n  }\n}')).toEqual(['#33aa33', '#3366cc'])
  })
  it('a value that is not a colour is ignored: the instance keeps the one it had', () => {
    expect(fillsOf('every frame {\n  B0.fond = go + 3\n}')).toEqual(['#cc3333', '#3366cc'])
  })
})

// Asked for by a host that drives a symbol's params from its own controls: it reached the private method
// through a cast, built DSL literals by hand, and a rename would have broken it without a compile error.
describe('FlatPlayer.setParam — the host sets an instance param', () => {
  const [gauge] = parseFlat([
    'symbol "Jauge" {', '  timeline 24 24', '  params {', '    number niveau = 0 range 0 1', '    bool actif = false', '    text titre = "Niveau"', '    color teinte = #3366cc', '  }',
    '  states porte { fermee at 0   ouverte at 24   initial fermee   transition 0 }',
    '  layer "l" {', '    rect 0 0 40 10 fill teinte', '    text titre at 0,20 font "sans-serif" size 12 align left line 1.2 color #000000 box 80 16', '  }', '}', '',
  ].join('\n'))
  const make = () => {
    const r = recorder()
    const doc = parseProgramFull('size 200 100\nscene {\n  layer "c" {\n  }\n}\n') as unknown as Doc
    doc.layers[0].items.push({ id: 'j', kind: 'instance', name: 'J', transform: IDENTITY, symbolId: gauge.id })
    doc.symbols = [gauge]
    const pl = new FlatPlayer(r.canvas, doc, { input: false, audio: false })
    const numbers = () => (pl as unknown as { paramsForInstance(id: string): Record<string, number> | undefined }).paramsForInstance('j') ?? {}
    return { pl, r, numbers }
  }

  it('a number, a boolean and a state, by their natural values', () => {
    const { pl, numbers } = make()
    expect(pl.setParam('J', 'niveau', 0.4)).toBe(true)
    expect(pl.setParam('J', 'actif', true)).toBe(true)
    expect(pl.setParam('J', 'porte', 'ouverte')).toBe(true)
    expect(numbers()).toEqual({ niveau: 0.4, actif: 1, porte: 1 })
  })
  it('a number is clamped to the declared range, as in the scene', () => {
    const { pl, numbers } = make()
    pl.setParam('J', 'niveau', 7)
    expect(numbers().niveau).toBe(1)
  })
  it('a colour, and a text given RAW — no quoting, no escaping', () => {
    const { pl, r } = make()
    expect(pl.setParam('J', 'teinte', '#33aa33')).toBe(true)
    expect(pl.setParam('J', 'titre', 'She said "50 %" \\ done')).toBe(true)
    r.reset(); pl.render()
    expect(r.seen.fills).toEqual(['#33aa33'])
    expect(r.seen.texts).toEqual(['She said "50 %" \\ done'])
  })
  it('paints the change by itself', () => {
    const { pl, r } = make()
    r.reset()
    pl.setParam('J', 'titre', 'Plein')
    expect(r.seen.texts).toEqual(['Plein'])
  })
  it('says no — and changes nothing — for an unknown instance, an undeclared param or a value of the wrong kind', () => {
    const { pl, r, numbers } = make()
    expect(pl.setParam('Absente', 'niveau', 1)).toBe(false)
    expect(pl.setParam('J', 'nivo', 1)).toBe(false)
    expect(pl.setParam('J', 'teinte', 'rouge')).toBe(false)
    expect(pl.setParam('J', 'niveau', 'beaucoup')).toBe(false)
    expect(pl.setParam('J', 'porte', 'entrouverte')).toBe(false)
    expect(numbers()).toEqual({})
    r.reset(); pl.render()
    expect([r.seen.fills, r.seen.texts]).toEqual([['#3366cc'], ['Niveau']])
  })
})

// Found by a security pass: `setParam` wrote a number as text and evaluated it as an expression, so every
// distinct value was compiled and kept for good — a slider at 60 Hz grew the heap by 150 MB per million
// writes. And `Inst.flag = true`, accepted at a call site, did nothing in an assignment.
describe('setParam and `Inst.p = …`: numbers are numbers, booleans are booleans', () => {
  const LAMP = `size 200 200
symbol "Lamp" {
  params {
    bool on = false
    number level = 0 range 0 1000000
  }
  layer "a" { group "Bulb" at 0,0 expr opacity "on" { layer "c" { circle 0 0 10 fill #ffcc00 } } }
}
var hits = 0
scene { layer "c" {
  instance "Lamp" as "L1" at 50,50
  instance "Lamp" as "L2" at 150,50
} }
when loaded {
  L1.on = true
  L2.on = 1
}
`
  /** A player on `src`, whose plain `symbol` blocks are resolved by name (what the compiler does). */
  const playerFor = (src: string) => {
    const doc = parseProgramFull(src) as unknown as Doc
    const byName = new Map(doc.symbols.map((sy) => [sy.name, sy.id]))
    for (const it of doc.layers[0].items as Instance[]) it.symbolId = byName.get(it.symbolId.slice(1)) ?? it.symbolId
    const r = recorder()
    const pl = new FlatPlayer(r.canvas as unknown as HTMLCanvasElement, doc, { input: false, audio: false, autoplay: false })
    return { pl, r }
  }
  const bulbs = (r: ReturnType<typeof recorder>) => r.seen.fills.filter((f) => f.toLowerCase() === '#ffcc00').length
  it('a host writing a thousand distinct numbers compiles none of them', () => {
    const { pl } = playerFor(LAMP)
    const loaded = exprCacheSize()
    for (let k = 0; k < 1000; k++) expect(pl.setParam('L1', 'level', k + 0.5)).toBe(true)
    expect(exprCacheSize() - loaded).toBe(0)
  })
  it('`Inst.boolParam = true` turns it on, as `= 1` does', () => {
    const { pl, r } = playerFor(LAMP)
    r.reset(); pl.render()
    expect(bulbs(r)).toBe(2) // both lamps lit — L1 used to stay dark
  })
})
