import { describe, it, expect } from 'vitest'
import { docToManifest, manifestEvents, manifestObjects, llmContext } from './manifest'
import { languageCard } from './languageCard'
import { IDENTITY } from '@flatkit/engine/transform'
import type { Doc, Group, Instance, Interaction, Layer, SymbolDef, Text } from '@flatkit/types'

const group = (name: string, layers: Layer[] = []): Group => ({ id: name, kind: 'group', name, transform: IDENTITY, layers })
const inst = (name: string, symbolId: string): Instance => ({ id: name, kind: 'instance', name, transform: IDENTITY, symbolId })
const text = (name: string): Text => ({ id: name, kind: 'text', name, transform: IDENTITY, content: '', font: 'sans-serif', size: 12, align: 'left', lineHeight: 1.2, color: '#000', box: { w: 1, h: 1 } })
const layer = (items: Layer['items']): Layer => ({ id: 'L', name: 'L', visible: true, locked: false, opacity: 1, items })
const sym = (id: string, name: string): SymbolDef => ({ id, name, layers: [] })

describe('manifest — manifestObjects', () => {
  it('lists the named objects with their type (instance → symbol)', () => {
    const d: Doc = { width: 800, height: 600, symbols: [sym('s1', 'Knight')], layers: [layer([inst('Hero', 's1'), text('Score'), group('Outer', [layer([group('Inner')])])])] }
    expect(manifestObjects(d).map((o) => `${o.name}(${o.kind})`)).toEqual([
      'Hero(Instance:Knight)', 'Score(Text)', 'Outer(Symbol)', 'Inner(Symbol)',
    ])
  })

  it('an object with no logic on it carries an empty contract, not a missing one', () => {
    const d: Doc = { width: 800, height: 600, symbols: [], layers: [layer([group('Decor')])] }
    expect(manifestObjects(d)[0]).toMatchObject({ name: 'Decor', events: [], dragged: false, zone: false, channels: [], reads: [] })
  })
})

// The binding contract: what a host must HONOUR to swap the skin of a scene without touching its logic.
// Names, roles, the state it can read, the events it emits — and deliberately NOT one coordinate. A
// contract that carried positions would hand every reskin the same layout, which is the whole failure it
// exists to prevent.
describe('manifest — the binding contract', () => {
  const clicked = (targetId: string, value: string): Interaction => ({ id: `i_${targetId}`, targetId, event: 'click', actions: [{ do: 'setVar', name: 'score', value }] })

  it('reports the item events the logic handles', () => {
    const d: Doc = { width: 100, height: 100, symbols: [], variables: { score: 0 }, layers: [layer([group('Bell')])], interactions: [clicked('Bell', 'score + 1')] }
    expect(manifestObjects(d)[0].events).toEqual(['click'])
  })

  it('reports a dragged object, and the zone it can be dropped on', () => {
    const d: Doc = {
      width: 100, height: 100, symbols: [], layers: [layer([group('Tile'), group('Slot')])],
      interactors: [{ targetId: 'Tile', axis: 'xy', varX: 'tx', varY: 'ty' }],
      interactions: [{ id: 'd', targetId: 'Tile', event: 'drop', over: 'Slot', actions: [{ do: 'play' }] }],
    }
    const [tile, slot] = manifestObjects(d)
    expect(tile).toMatchObject({ name: 'Tile', dragged: true, zone: false })
    expect(tile.events).toContain('drop')
    expect(slot).toMatchObject({ name: 'Slot', dragged: false, zone: true }) // named as a drop target
  })

  it('a group carrying a hitbox is a zone even if nothing drops on it yet', () => {
    const withHitbox: Group = { ...group('Bin'), hitbox: { w: 100, h: 100 } }
    const d: Doc = { width: 100, height: 100, symbols: [], layers: [layer([withHitbox])] }
    expect(manifestObjects(d)[0].zone).toBe(true)
  })

  it('reports the channels the logic drives — the ones a skin must not fight', () => {
    const driven: Group = { ...group('Water'), expressions: { scaleY: 'level', opacity: '1 - fade' } }
    const d: Doc = { width: 100, height: 100, symbols: [], variables: { level: 0, fade: 0 }, layers: [layer([driven])] }
    expect(manifestObjects(d)[0].channels).toEqual(['scaleY', 'opacity'])
  })

  it('reports the state an object READS, and only that', () => {
    const driven: Group = { ...group('Gate'), expressions: { y: '-open * 110 + sin(time)' } }
    const d: Doc = {
      width: 100, height: 100, symbols: [], variables: { open: 0, unrelated: 7 },
      layers: [layer([driven])], interactions: [clicked('Gate', 'open + 1')],
    }
    const [gate] = manifestObjects(d)
    expect(gate.reads).toContain('open') // read by both the binding and the handler
    expect(gate.reads).not.toContain('unrelated') // never referenced by this object
    expect(gate.reads).not.toContain('time') // a runtime scalar, not state a host can set
    expect(gate.reads).not.toContain('sin') // a call, not a read
  })

  it('state is wider than the declared vars: a var written by a drag counts too', () => {
    // `drag tx, ty` writes two variables no `var` line declares, and they are exactly what a skin binds
    // its tile to. Restricting the contract to declared globals would hide the most useful ones.
    const tile: Group = { ...group('Tile'), expressions: { x: 'tx', y: 'ty' } }
    const d: Doc = {
      width: 100, height: 100, symbols: [], layers: [layer([tile])],
      interactors: [{ targetId: 'Tile', axis: 'xy', varX: 'tx', varY: 'ty' }],
    }
    expect(manifestObjects(d)[0].reads).toEqual(['tx', 'ty'])
  })

  it('a modifier target counts as a read (spring/smooth are bindings too)', () => {
    const sprung: Group = { ...group('Needle'), modifiers: { rotation: { kind: 'spring', target: 'aim', stiffness: 8, damping: 0.5 } } }
    const d: Doc = { width: 100, height: 100, symbols: [], variables: { aim: 0 }, layers: [layer([sprung])] }
    expect(manifestObjects(d)[0].reads).toContain('aim')
    expect(manifestObjects(d)[0].channels).toContain('rotation')
  })

  it('collects the events the program EMITS to its host', () => {
    const d: Doc = {
      width: 100, height: 100, symbols: [], layers: [layer([group('Bell')])],
      interactions: [{ id: 'i', targetId: 'Bell', event: 'click', actions: [
        { do: 'send', event: 'correct' },
        { do: 'if', cond: '1', then: [{ do: 'send', event: 'completed' }] }, // nested: must still be seen
      ] }],
    }
    expect(manifestEvents(d)).toEqual(['correct', 'completed'])
  })

  it('nested objects are walked, and a duplicate event is reported once', () => {
    const d: Doc = {
      width: 100, height: 100, symbols: [], layers: [layer([group('Outer', [layer([group('Inner')])])])],
      interactions: [
        { id: 'a', targetId: 'Inner', event: 'click', actions: [{ do: 'send', event: 'hit' }] },
        { id: 'b', targetId: 'Outer', event: 'click', actions: [{ do: 'send', event: 'hit' }] },
      ],
    }
    expect(manifestObjects(d).map((o) => o.name)).toEqual(['Outer', 'Inner'])
    expect(manifestEvents(d)).toEqual(['hit'])
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

  it('renders the contract: roles, driven channels, emitted events', () => {
    const tile: Group = { ...group('Tile'), expressions: { x: 'tx', y: 'ty' } }
    const d: Doc = {
      width: 400, height: 300, symbols: [], variables: { tx: 0, ty: 0, placed: 0 },
      layers: [layer([tile, { ...group('Slot'), hitbox: { w: 90, h: 90 } }])],
      interactors: [{ targetId: 'Tile', axis: 'xy', varX: 'tx', varY: 'ty' }],
      interactions: [{ id: 'd', targetId: 'Tile', event: 'drop', over: 'Slot', actions: [{ do: 'setVar', name: 'placed', value: '1' }, { do: 'send', event: 'correct' }] }],
    }
    const m = docToManifest(d)
    expect(m).toMatch(/Tile.*drag/)
    expect(m).toMatch(/Slot.*zone/)
    expect(m).toContain('events: correct')
  })

  it('never leaks a coordinate — a contract that carried positions would freeze the layout', () => {
    // This is the whole point: a skin honours the NAMES and redraws the composition freely. The moment a
    // position crosses this boundary, every reskin inherits the same layout, which is the failure the
    // contract exists to prevent.
    const placed: Group = { ...group('Chest'), transform: { a: 1, b: 0, c: 0, d: 1, e: 731, f: 4242 } }
    const d: Doc = { width: 400, height: 300, symbols: [], layers: [layer([placed])] }
    const m = docToManifest(d)
    expect(m).toContain('Chest')
    expect(m).not.toContain('731')
    expect(m).not.toContain('4242')
    expect(JSON.stringify(manifestObjects(d))).not.toContain('731')
  })
})

describe('manifest — languageCard / llmContext', () => {
  it('the card covers the key language landmarks', () => {
    const c = languageCard()
    for (const token of ['every frame', 'when clicked', 'Name.x', 'each "Symbol"', 'atan2', 'use "package"']) expect(c).toContain(token)
  })
  it('llmContext = behavior card + DRAWING card + manifest', () => {
    // Drawing is in by default on purpose: a model handed the behavior half alone invents the shapes
    // grammar, and what it invents does not compile. `{ drawing: false }` opts out when the model is only
    // editing behavior and the prompt budget is tight.
    const d: Doc = { width: 100, height: 100, symbols: [], layers: [] }
    const ctx = llmContext(d)
    expect(ctx).toContain('# FlatInk Script')
    expect(ctx).toContain('# FlatInk — drawing')
    expect(ctx).toContain('# SCENE')
    expect(llmContext(d, { drawing: false })).not.toContain('# FlatInk — drawing')
  })
})
