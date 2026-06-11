import { describe, it, expect } from 'vitest'
import { docToManifest, manifestObjects, llmContext } from './manifest'
import { languageCard } from './languageCard'
import { IDENTITY } from '@flatkit/engine/transform'
import type { Doc, Group, Instance, Layer, SymbolDef, Text } from '@flatkit/types'

const group = (name: string, layers: Layer[] = []): Group => ({ id: name, kind: 'group', name, transform: IDENTITY, layers })
const inst = (name: string, symbolId: string): Instance => ({ id: name, kind: 'instance', name, transform: IDENTITY, symbolId })
const text = (name: string): Text => ({ id: name, kind: 'text', name, transform: IDENTITY, content: '', font: 'sans-serif', size: 12, align: 'left', lineHeight: 1.2, color: '#000', box: { w: 1, h: 1 } })
const layer = (items: Layer['items']): Layer => ({ id: 'L', name: 'L', visible: true, locked: false, opacity: 1, items })
const sym = (id: string, name: string): SymbolDef => ({ id, name, layers: [] })

describe('manifest — manifestObjects', () => {
  it('lists the named objects with their type (instance → symbol)', () => {
    const d: Doc = { width: 800, height: 600, symbols: [sym('s1', 'Knight')], layers: [layer([inst('Hero', 's1'), text('Score'), group('Outer', [layer([group('Inner')])])])] }
    expect(manifestObjects(d)).toEqual([
      { name: 'Hero', kind: 'Instance:Knight' },
      { name: 'Score', kind: 'Text' },
      { name: 'Outer', kind: 'Symbol' },
      { name: 'Inner', kind: 'Symbol' },
    ])
  })
})

describe('manifest — docToManifest', () => {
  it('renders the non-empty sections (objects, vars, assets, funcs, packages)', () => {
    const d: Doc = {
      width: 480, height: 320, symbols: [sym('s1', 'Slime')],
      layers: [layer([inst('Enemy', 's1')])],
      variables: { score: 0, bricks: [1, 1, 1] },
      functions: [{ name: 'launch', params: [], kind: 'proc', body: [] }],
      imports: ['collision'],
      assets: [{ id: 'ding', kind: 'audio', name: 'ding', mime: 'audio/mp3', data: '' }],
    }
    const m = docToManifest(d)
    expect(m).toContain('size: 480x320')
    expect(m).toContain('objects: Enemy(Instance:Slime)')
    expect(m).toContain('vars: score=0, bricks[3]')
    expect(m).toContain('assets: audio:ding')
    expect(m).toContain('funcs: launch()')
    expect(m).toContain('packages: collision')
    expect(m).toContain('channels: x y scaleX scaleY rotation opacity')
  })

  it('omits the empty sections', () => {
    const m = docToManifest({ width: 100, height: 100, symbols: [], layers: [] })
    expect(m).not.toContain('objects:')
    expect(m).not.toContain('vars:')
    expect(m).toContain('channels:')
  })
})

describe('manifest — languageCard / llmContext', () => {
  it('the card covers the key language landmarks', () => {
    const c = languageCard()
    for (const token of ['every frame', 'when clicked', 'Name.x', 'each "Symbol"', 'atan2', 'use "package"']) expect(c).toContain(token)
  })
  it('llmContext = card + manifest', () => {
    const d: Doc = { width: 100, height: 100, symbols: [], layers: [] }
    const ctx = llmContext(d)
    expect(ctx).toContain('# FlatInk Script')
    expect(ctx).toContain('# SCENE')
  })
})
