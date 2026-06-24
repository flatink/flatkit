import { describe, it, expect } from 'vitest'
import { compileFlatpack, type MediaMap } from './compile'
import { exportFlatProject } from '@flatkit/engine/flatFormat'
import { parsePathData } from '@flatkit/engine/svgPath'
import { resolveLayerAt } from '@flatkit/engine/cel'
import { isInstance } from '@flatkit/engine/layers'
import type { Doc } from '@flatkit/types'

// End-to-end smoke: a `.flat` asset + a `.flatink` program → playable Doc.
const ASSET = `
symbol "Hero" {
  layer "body" {
    path "M0 0L20 0L20 20L0 20Z" fill #ff5a5f
  }
}`

const PROGRAM = `
size 400 300
background #0a0e1c
var score = 0

scene {
  layer "c" {
    instance "Hero" as "player" at 100,100
  }
}

every frame {
  score = score + 1
}

object "player" {
  when clicked { go to frame 1 and play }
  x = mouse.x
}`

describe('compile — .flat + .flatink → .flatpack (Doc)', () => {
  const doc = compileFlatpack(PROGRAM, [ASSET])

  it('assembles a coherent Doc (symbol refs resolved by name)', () => {
    expect(doc.width).toBe(400)
    expect(doc.background).toBe('#0a0e1c')
    expect(doc.variables).toEqual({ score: 0 })
    expect(doc.symbols).toHaveLength(1)
    const player = doc.layers[0].items[0]
    expect(isInstance(player) && player.symbolId).toBe(doc.symbols[0].id) // "@Hero" → real id
    expect(doc.timeline?.onEnterFrame?.length).toBe(1)
    expect(doc.interactions?.[0].event).toBe('click')
    // the expression and the click are attached to the "player" object
    expect((player as { expressions?: Record<string, string> }).expressions?.x).toBe('mouse.x')
    expect(doc.interactions?.[0].targetId).toBe(player.id)
  })

  it('the compiled Doc is PLAYABLE (resolveLayerAt does not throw)', () => {
    const ctx = { mouse: { x: 0, y: 0 }, score: 0 } as Record<string, unknown>
    for (const f of [0, 30, 59]) {
      expect(Array.isArray(resolveLayerAt(doc.layers[0], f, { fps: 24, ctx: ctx as never }))).toBe(true)
      for (const s of doc.symbols) for (const l of s.layers) expect(Array.isArray(resolveLayerAt(l, f, { fps: 24 }))).toBe(true)
    }
  })

  it('a stateful channel modifier (spring) survives .flat compile into the Doc', () => {
    const asset = `
symbol "Grue" {
  params {
    number crochetX = 0   range 0 1     "Hook position"
  }
  layer "body" {
    group "Suspente" spring rotation "crochetX" stiffness 0.08 damping 0.86 {
      layer "s" {
        path "M0 0L10 0L10 20L0 20Z" fill #888888
      }
    }
  }
}`
    const program = `
size 200 200
scene { layer "c" { instance "Grue" as "g1" at 100,100 } }`
    const out = compileFlatpack(program, [asset])
    const sym = out.symbols.find((s) => s.name === 'Grue')!
    const susp = sym.layers[0].items.find((it) => it.name === 'Suspente') as { modifiers?: Record<string, unknown> }
    expect(susp.modifiers?.rotation).toEqual({ kind: 'spring', target: 'crochetX', stiffness: 0.08, damping: 0.86 })
  })

  it('a .flatink object block carries a stateful modifier (scene-side), compiled onto the item', () => {
    const asset = `symbol "Hook" { layer "l" { path "M0 0L10 0L10 10Z" fill #888888 } }`
    const program = `
size 200 200
scene { layer "c" { instance "Hook" as "h" at 100,100 } }
object "h" {
  spring rotation = 0.5 { stiffness 0.08 damping 0.86 }
}`
    const out = compileFlatpack(program, [asset])
    const h = out.layers[0].items[0] as { modifiers?: Record<string, unknown> }
    expect(h.modifiers?.rotation).toEqual({ kind: 'spring', target: '0.5', stiffness: 0.08, damping: 0.86 })
  })

  it('a .flatink object block with an additive dx offset compiles AND resolves as at + dx', () => {
    const asset = `symbol "Dot" { layer "l" { path "M0 0L4 0L4 4Z" fill #3a6df0 } }`
    const program = `
size 1280 400
scene { layer "c" { group "p" at 620,200 pivot 0,0 { layer "g" { instance "Dot" as "d" } } } }
object "p" { dx = 80 }`
    const out = compileFlatpack(program, [asset])
    const p = out.layers[0].items[0] as { expressions?: Record<string, string> }
    expect(p.expressions?.dx).toBe('80') // carried onto the compiled item
    // resolved pose: the group sits at 620 + 80 = 700 (additive), not at 80 (absolute would desert it)
    const resolved = resolveLayerAt(out.layers[0], 0, { fps: 24 })
    const e = (resolved[0] as { transform: { e: number; f: number } }).transform
    expect(e.e).toBeCloseTo(700, 5)
    expect(e.f).toBeCloseTo(200, 5)
  })

  it('statements crammed on one line compile exactly like one-per-line (if lint passes, compile works)', () => {
    const out = compileFlatpack(`
size 400 300
var score = 0
var ticks = 0

scene {
  layer "c" {
    instance "Hero" as "player" at 100,100
  }
}

every frame { score = score + 1  ticks = ticks + 1 }

object "player" {
  x = mouse.x  opacity = 1
}`, [ASSET])
    // action body: both crammed assignments land as two setVars
    expect(out.timeline?.onEnterFrame).toEqual([
      { do: 'setVar', name: 'score', value: 'score + 1' },
      { do: 'setVar', name: 'ticks', value: 'ticks + 1' },
    ])
    // object bindings: both channels split onto the instance's expressions
    const player = out.layers[0].items[0] as { expressions?: Record<string, string> }
    expect(player.expressions?.x).toBe('mouse.x')
    expect(player.expressions?.opacity).toBe('1')
  })
})

// CAPSTONE: the editor GENERATES the sources (Doc → .flat + .flatink + media), the compiler reassembles them.
// The full round trip must be STABLE (identical text) and playable, with embedded media.
describe('capstone — Doc → export → compile (generator ⇄ compiler loop)', () => {
  const DATA_URI = 'data:image/svg+xml;base64,PHN2Zy8+'
  const doc: Doc = {
    width: 480, height: 320, background: '#0a0e1c',
    symbols: [{ id: 'sym_hero', name: 'Hero', layers: [{ id: 'hl', name: 'body', visible: true, locked: false, opacity: 1, items: [
      { id: 'r1', color: '#ff5a5f', path: parsePathData('M0 0L40 0L40 40L0 40Z') },
    ] }] }],
    variables: { score: 0 },
    assets: [{ id: 'photo', kind: 'image', name: 'art/photo.svg', mime: 'image/svg+xml', data: DATA_URI }],
    timeline: { fps: 24, durationFrames: 60, tracks: [], onEnterFrame: [{ do: 'setVar', name: 'score', value: 'score + 1' }], sounds: [] },
    interactions: [{ id: 'i1', targetId: 'player', event: 'click', actions: [{ do: 'gotoFrame', frame: 1, play: true }] }],
    layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [
      { id: 'player', kind: 'instance', name: 'player', symbolId: 'sym_hero', transform: { a: 1, b: 0, c: 0, d: 1, e: 100, f: 100 }, expressions: { x: 'mouse.x' } },
      { id: 'pic', kind: 'image', name: 'pic', assetId: 'photo', w: 120, h: 80, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
    ] }],
  }

  const src = exportFlatProject(doc)
  const mediaMap: MediaMap = Object.fromEntries(src.media.map((m) => [m.path, { mime: m.mime, data: m.data }]))
  const out = compileFlatpack(src.flatink, [src.flat], mediaMap)

  it('embedded media + resolved symbol', () => {
    expect(out.assets?.[0].data).toBe(DATA_URI) // path → data-URI
    const player = out.layers[0].items[0]
    expect(isInstance(player) && player.symbolId).toBe(out.symbols[0].id)
    expect(out.symbols[0].name).toBe('Hero')
  })

  it('the loop is STABLE (re-exporting the compiled Doc yields the same text)', () => {
    const round = exportFlatProject(out)
    expect(round.flat).toBe(src.flat)
    expect(round.flatink).toBe(src.flatink)
    expect(round.media).toEqual(src.media)
  })
})

// A font asset gets an explicit `family` (defaults to its declared id) so consumers don't rely on a fallback.
describe('font assets: family defaults to id', () => {
  const media: MediaMap = {
    'a.woff2': { mime: 'font/woff2', data: 'data:font/woff2;base64,AAAA' },
    'b.woff2': { mime: 'font/woff2', data: 'data:font/woff2;base64,AAAA' },
  }

  it('a font without an explicit family inherits its declared id', () => {
    const doc = compileFlatpack('size 10 10\nasset "Archivo" "a.woff2" font\nscene { layer "L" {} }', [], media)
    const font = doc.assets?.find((a) => a.id === 'Archivo')
    expect(font?.kind).toBe('font')
    expect(font?.family).toBe('Archivo')
  })

  it('an explicit family is preserved (not overwritten by the id)', () => {
    const doc = compileFlatpack('size 10 10\nasset "slug" "b.woff2" font "Real Family"\nscene { layer "L" {} }', [], media)
    expect(doc.assets?.find((a) => a.id === 'slug')?.family).toBe('Real Family')
  })
})
