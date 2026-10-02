// Symbol params the picture reads directly: `text` (flatink/flatink#9) and `color` written while the scene
// plays (flatink/flatink#26). Both are resolved per instance when it is drawn.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FlatPlayer } from './player'
import { parseProgramFull, parseFlat } from '@flatkit/engine/flatFormat'
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
