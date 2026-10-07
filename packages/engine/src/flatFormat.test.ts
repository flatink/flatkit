import { describe, it, expect } from 'vitest'
import { printFlat, parseFlat, parseFlatLib, pathToData, printProgram, parseProgram, printProgramFull, parseProgramFull, behaviorDiagnostics, objectTargetDiagnostics, expandFeedback, sceneOnlyUnitDiagnostics, itemOnlyUnitDiagnostics, type Program } from './flatFormat'
import { parsePathData, circlePath, ellipsePath, rectPath } from './svgPath'
import { folderPath } from './layers'
import { resolveLayerAt } from './cel'
import type { Folder, Group, Image, Instance, Region, SymbolDef, Text } from '@flatkit/types'
import type { Path } from './path'

const layer = (id: string, name: string, items: SymbolDef['layers'][number]['items'], opacity = 1) =>
  ({ id, name, visible: true, locked: false, opacity, items })
const T = (e: number, f: number) => ({ a: 1, b: 0, c: 0, d: 1, e, f })
// Minimal program with an `extra` header line (before the scene).
const prog0 = (extra: string) => ['size 100 100', extra, 'scene {', '  layer "L" {', '    path "M0 0L10 0L10 10Z" fill #000000', '  }', '}', ''].join('\n')

// Test library: "Hero" (substance + tinted/filtered group + text + image) + "Scene" (group + instances).
function lib(): SymbolDef[] {
  const hero: SymbolDef = {
    id: 'h', name: 'Hero', layers: [
      layer('hl', 'body', [
        { id: 'r1', color: '#ff0000', path: parsePathData('M0 0L20 0L20 20L0 20Z') },
        { id: 'r2', color: '#00ff00', path: parsePathData('M0 0L5 5L0 5Z'), paint: { type: 'linear', angle: 45, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }] } },
        { id: 'r3', color: '#abcdef', path: parsePathData('M0 0C1 1 2 2 3 3'), noFill: true, stroke: { width: 4, paint: { type: 'solid', color: '#abcdef' } } },
        { id: 'r4', color: '#112233', path: parsePathData('M0 0L1 0L1 1Z'), paint: { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: [{ offset: 0, color: '#ffffff' }, { offset: 0.6, color: '#888888' }, { offset: 1, color: '#000000' }] }, opacity: 0.5 },
        // poseable group: tint + filters + expressions + pivot
        {
          id: 'fx', kind: 'group', name: 'aura', transform: T(0, 0), pivot: { x: 5, y: 5 }, opacity: 0.9,
          tint: { color: '#9fc3ff', amount: 0.3 },
          filters: [{ type: 'glow', blur: 26, color: '#7fa8ff' }, { type: 'shadow', dx: 0, dy: 18, blur: 22, color: '#00000066' }, { type: 'adjust', saturate: 1.5 }],
          expressions: { rotation: 'time * 6', opacity: '0.5 + sin(time)*0.5' },
          layers: [layer('fxl', 'c', [{ id: 'fr', color: '#fff', path: parsePathData('M0 0L2 0L2 2Z') }])],
        } as Group,
        { id: 'tx', kind: 'text', name: 'title', transform: T(10, 20), content: 'Hello\n!', font: 'Georgia, serif', size: 32, align: 'center', lineHeight: 1.25, color: '#222222', weight: 700, italic: true, box: { w: 200, h: 40 } } as Text,
        { id: 'im', kind: 'image', name: 'photo', transform: T(0, 0), assetId: 'asset-7', w: 120, h: 80, opacity: 0.8 } as Image,
      ]),
    ],
  }
  const scene: SymbolDef = {
    id: 's', name: 'Scene', layers: [
      layer('sl', 'c', [
        { id: 'g1', kind: 'group', name: 'wrap', transform: { a: 2, b: 0, c: 0, d: 2, e: 20, f: 30 }, layers: [layer('gl', 'c', [{ id: 'i1', kind: 'instance', name: 'Hero', transform: T(5, 5), symbolId: 'h' } as Instance])] } as Group,
        { id: 'i2', kind: 'instance', name: 'Hero', transform: T(100, 0), symbolId: 'h' } as Instance,
        { id: 'i3', kind: 'instance', name: 'enemy', transform: T(50, 50), symbolId: 'h', tint: { color: '#ff0000', amount: 0.6 } } as Instance,
      ], 0.8),
    ],
  }
  // "Robot": internal timeline + animated layer (tween/spin poses) + morph layer (substance).
  const cos = (a: number) => Math.round(Math.cos(a) * 100) / 100
  const sin = (a: number) => Math.round(Math.sin(a) * 100) / 100
  const robot: SymbolDef = {
    id: 'rob', name: 'Robot',
    timeline: { fps: 24, durationFrames: 16, tracks: [] },
    layers: [
      {
        id: 'legsL', name: 'legs', visible: true, locked: false, opacity: 1,
        items: [{ id: 'legL', kind: 'instance', name: 'leg', symbolId: 'h', transform: T(-16, 56) } as Instance],
        cels: [
          { frame: 0, tween: true, ease: 'easeInOut', poses: [{ id: 'legL', transform: T(-16, 56), opacity: 1 }] },
          { frame: 8, poses: [{ id: 'legL', transform: { a: cos(0.4), b: sin(0.4), c: -sin(0.4), d: cos(0.4), e: -16, f: 56 }, spin: 'cw', turns: 1 }] },
          { frame: 16, poses: [{ id: 'legL', transform: T(-16, 56) }] },
        ],
      },
      {
        id: 'morphL', name: 'shape', visible: true, locked: false, opacity: 1, items: [],
        cels: [
          { frame: 0, shapeTween: true, ease: { cubic: [0.34, 1.56, 0.64, 1] }, poses: [], matter: [{ id: 'm1', color: '#5ec8ff', path: parsePathData('M0 0L10 0L10 10Z'), paint: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#bdecff' }, { offset: 1, color: '#2f8fe0' }] } }] },
          { frame: 40, poses: [], matter: [{ id: 'm2', color: '#ffd24d', path: parsePathData('M5 0L10 10L0 10Z') }] },
        ],
      },
    ],
  }
  return [hero, scene, robot]
}

describe('flatFormat — .flat serializer', () => {
  it('STABLE round-trip: print → parse → print is idempotent', () => {
    const text = printFlat(lib())
    expect(printFlat(parseFlat(text))).toBe(text)
  })

  it('library folders: print `in "A/B"` → parse reconstructs the paths', () => {
    const symbols: SymbolDef[] = [
      { id: 'a', name: 'Wheel', layers: [layer('al', 'c', [])], folderId: 'fB' },
      { id: 'b', name: 'Body', layers: [layer('bl', 'c', [])], folderId: 'fA' },
      { id: 'c', name: 'Free', layers: [layer('cl', 'c', [])] },
    ]
    const folders: Folder[] = [{ id: 'fA', name: 'Vehicles' }, { id: 'fB', name: 'Parts', parent: 'fA' }]
    const text = printFlat(symbols, folders)
    expect(text).toContain('symbol "Wheel" in "Vehicles/Parts"')
    expect(text).toContain('symbol "Body" in "Vehicles"')
    expect(text).toContain('symbol "Free" {') // root: no `in` clause
    const { symbols: s2, folders: f2 } = parseFlatLib(text)
    expect(folderPath(f2, s2.find((s) => s.name === 'Wheel')!.folderId)).toBe('Vehicles/Parts')
    expect(folderPath(f2, s2.find((s) => s.name === 'Body')!.folderId)).toBe('Vehicles')
    expect(s2.find((s) => s.name === 'Free')!.folderId).toBeUndefined()
    expect(f2.filter((f) => f.name === 'Vehicles' && !f.parent)).toHaveLength(1) // dedup of the shared parent
  })

  it('compat: a .flat without an `in` clause creates no folder', () => {
    expect(parseFlatLib(printFlat(lib())).folders).toHaveLength(0)
  })

  it('the text is readable (SVG path, paints, poseable attributes)', () => {
    const text = printFlat(lib())
    expect(text).toContain('symbol "Hero"')
    expect(text).toContain('fill linear(45, 0:#ffffff, 1:#000000)')
    expect(text).toContain('stroke #abcdef 4')
    expect(text).toContain('radial(0.5, 0.5, 0.5,')
    expect(text).toContain('instance "Hero" at 100,0')
    expect(text).toContain('group "wrap" matrix(2,0,0,2,20,30)')
    // poseable attributes: tint, filters, expressions, pivot
    expect(text).toContain('tint #9fc3ff 0.3')
    expect(text).toContain('filter glow 26 #7fa8ff')
    expect(text).toContain('expr rotation "time * 6"')
    expect(text).toContain('pivot 5,5')
    // text + image
    expect(text).toContain('font "Georgia, serif" size 32 align center')
    expect(text).toContain('box 200 40')
    expect(text).toContain('image "asset-7" 120 80')
    // instance with a name distinct from the symbol
    expect(text).toContain('instance "Hero" as "enemy"')
  })

  it('additive offset channels: `expr dx`/`expr dy` serialize and round-trip', () => {
    const sym: SymbolDef = {
      id: 'o', name: 'Off', layers: [layer('ol', 'c', [
        { id: 'p', kind: 'group', name: 'p', transform: T(620, 150),
          expressions: { dx: '58 * sin(time)', dy: '0' },
          layers: [layer('pl', 'c', [{ id: 'pr', color: '#fff', path: parsePathData('M0 0L2 0L2 2Z') }])] } as Group,
      ])],
    }
    const text = printFlat([sym])
    expect(text).toContain('expr dx "58 * sin(time)"')
    expect(text).toContain('expr dy "0"')
    expect(printFlat(parseFlat(text))).toBe(text) // stable round-trip
    const back = parseFlat(text)[0].layers[0].items[0] as Group
    expect(back.expressions).toEqual({ dx: '58 * sin(time)', dy: '0' })
  })

  it('reconstructs the structure (items, paints, resolved instances)', () => {
    const parsed = parseFlat(printFlat(lib()))
    expect(parsed.map((s) => s.name)).toEqual(['Hero', 'Scene', 'Robot'])
    const hero = parsed[0]
    expect(hero.layers[0].items).toHaveLength(7)
    const r2 = hero.layers[0].items[1] as { paint?: { type: string } }
    expect(r2.paint?.type).toBe('linear')
    // The instance references the Hero symbol by its REAL id (resolved from the name).
    const scene = parsed[1]
    const i2 = scene.layers[0].items[1] as Instance
    expect(i2.symbolId).toBe(hero.id)
    const enemy = scene.layers[0].items[2] as Instance
    expect(enemy.name).toBe('enemy')
    expect(enemy.symbolId).toBe(hero.id)
    expect(scene.layers[0].opacity).toBe(0.8)
  })

  it('animates: internal timeline + cels (tween/spin poses, morph/substance)', () => {
    const text = printFlat(lib())
    expect(text).toContain('timeline 24 16')
    expect(text).toContain('cel 0 tween ease easeInOut')
    expect(text).toContain('pose "leg" at -16,56 opacity 1')
    expect(text).toContain('spin cw turns 1')
    expect(text).toContain('cel 0 morph ease cubic(0.34,1.56,0.64,1)')
    expect(text).toContain('matter {')

    const robot = parseFlat(text).find((s) => s.name === 'Robot')!
    expect(robot.timeline?.fps).toBe(24)
    const legs = robot.layers[0]
    const rosterId = legs.items[0].id
    // the pose references the roster by its RESOLVED id (from the name "leg")
    expect(legs.cels?.[0].poses[0].id).toBe(rosterId)
    expect(legs.cels?.[0].tween).toBe(true)
    expect(legs.cels?.[1].poses[0].spin).toBe('cw')
    const morph = robot.layers[1]
    expect(morph.cels?.[0].shapeTween).toBe(true)
    expect(morph.cels?.[0].matter?.[0].paint?.type).toBe('linear')
  })

  it('pathToData ⇄ parsePathData: geometry preserved (anchors + handles)', () => {
    const p: Path = parsePathData('M10 10C20 0 30 0 40 10L40 40Z')
    const back = parsePathData(pathToData(p))
    const anchors = (pp: Path) => pp.subpaths.flatMap((s) => s.segments.map((g) => [Math.round(g.anchor.x), Math.round(g.anchor.y)]))
    expect(anchors(back)).toEqual(anchors(p))
  })

  it('stroke cap/join/dash + animated NAMED image (the name resolves the cel pose)', () => {
    const sym: SymbolDef = {
      id: 's', name: 'S', layers: [{
        id: 'l', name: 'L', visible: true, locked: false, opacity: 1,
        items: [
          { id: 'r', color: '#abcdef', path: parsePathData('M0 0L10 0'), noFill: true, stroke: { width: 16, paint: { type: 'solid', color: '#abcdef' }, cap: 'round', join: 'round', miterLimit: 8, dash: [4, 2] } },
          { id: 'im', kind: 'image', name: 'photo', assetId: 'a', w: 100, h: 80, transform: T(10, 20) } as Image,
        ],
        cels: [{ frame: 0, poses: [{ id: 'im', transform: T(10, 20), opacity: 0.5 }] }],
      }],
    }
    const text = printFlat([sym])
    expect(text).toContain('cap round join round miter 8 dash 4,2')
    expect(text).toContain('image "a" 100 80 as "photo"')
    expect(printFlat(parseFlat(text))).toBe(text) // stable round-trip

    const back = parseFlat(text)[0]
    const reg = back.layers[0].items[0] as Region
    expect(reg.stroke).toMatchObject({ cap: 'round', join: 'round', miterLimit: 8, dash: [4, 2] })
    const img = back.layers[0].items.find((i) => 'kind' in i && i.kind === 'image') as Image
    expect(img.name).toBe('photo')
    const pose = back.layers[0].cels![0].poses[0]
    expect(pose.id).toBe(img.id) // resolved by NAME (no orphan "@photo")
    expect(pose.id.startsWith('@')).toBe(false)
  })

  it('text stroke (outline): solid + gradient paint, cap/join/dash + stable round-trip', () => {
    const sym: SymbolDef = {
      id: 's', name: 'S', layers: [{
        id: 'l', name: 'L', visible: true, locked: false, opacity: 1,
        items: [
          { id: 't1', kind: 'text', name: 'a', transform: T(0, 0), content: 'Hi', font: 'sans-serif', size: 40, align: 'left', lineHeight: 1.2, color: '#ffd23f', box: { w: 80, h: 40 }, stroke: { width: 6, paint: { type: 'solid', color: '#e23b3b' }, cap: 'round', join: 'round', miterLimit: 8, dash: [4, 2] } } as Text,
          { id: 't2', kind: 'text', name: 'b', transform: T(0, 50), content: 'Yo', font: 'sans-serif', size: 40, align: 'left', lineHeight: 1.2, color: '#ffffff', box: { w: 80, h: 40 }, stroke: { width: 3, paint: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] } } } as Text,
        ],
      }],
    }
    const text = printFlat([sym])
    expect(text).toContain('color #ffd23f stroke #e23b3b 6 cap round join round miter 8 dash 4,2')
    expect(text).toContain('stroke linear(') // gradient paint on the outline
    expect(printFlat(parseFlat(text))).toBe(text) // stable round-trip

    const back = parseFlat(text)[0]
    const t1 = back.layers[0].items[0] as Text
    expect(t1.stroke).toMatchObject({ width: 6, cap: 'round', join: 'round', miterLimit: 8, dash: [4, 2] })
    expect(t1.stroke!.paint).toMatchObject({ type: 'solid', color: '#e23b3b' })
    const t2 = back.layers[0].items[1] as Text
    expect(t2.stroke!.paint.type).toBe('linear')
  })
})

describe('flatFormat — .flatink program', () => {
  it('size / background / variables / scene (symbol refs by name) + round-trip', () => {
    const hero = lib()[0]
    const doc = {
      width: 1200, height: 800, background: '#0a0e1c',
      variables: { score: 0, lives: 3 },
      symbols: [hero],
      layers: [layer('L0', 'c', [
        { id: 'p', kind: 'instance', name: 'player', symbolId: hero.id, transform: T(100, 400) } as Instance,
        { id: 'rr', color: '#ffffff', path: parsePathData('M0 0L10 0L10 10Z') },
      ])],
    }
    const text = printProgram(doc)
    expect(text).toContain('size 1200 800')
    expect(text).toContain('background #0a0e1c')
    expect(text).toContain('var score = 0')
    expect(text).toContain('var lives = 3')
    expect(text).toContain('scene {')
    expect(text).toContain('instance "Hero" as "player" at 100,400')

    expect(printProgram(parseProgram(text))).toBe(text) // stable round-trip

    const parsed = parseProgram(text)
    expect(parsed.width).toBe(1200)
    expect(parsed.height).toBe(800)
    expect(parsed.background).toBe('#0a0e1c')
    expect(parsed.variables).toEqual({ score: 0, lives: 3 })
    expect(parsed.layers[0].items).toHaveLength(2)
    // the instance references the symbol by NAME (resolved at compile time with the .flat files)
    expect((parsed.layers[0].items[0] as Instance).symbolId).toBe('@Hero')
  })

  it('asset directive: kinds + optional font family alias round-trip', () => {
    const prog: Program = {
      width: 100, height: 100, symbols: [], layers: [],
      assets: [
        { id: 'logo', name: 'logo.svg', kind: 'image', mime: '', data: 'logo.svg' },
        { id: 'qs', name: 'Quicksand.woff2', kind: 'font', mime: '', data: 'Quicksand.woff2', family: 'Quicksand' },
        { id: 'plain', name: 'Inter.woff2', kind: 'font', mime: '', data: 'Inter.woff2' },
      ],
    }
    const text = printProgram(prog)
    expect(text).toContain('asset "logo" "logo.svg" image')
    expect(text).toContain('asset "qs" "Quicksand.woff2" font "Quicksand"') // alias printed after the kind
    expect(text).toContain('asset "plain" "Inter.woff2" font\n') // no alias → no trailing string
    expect(printProgram(parseProgram(text))).toBe(text) // stable round-trip

    const parsed = parseProgram(text)
    expect(parsed.assets?.map((a) => a.family)).toEqual([undefined, 'Quicksand', undefined])
    expect(parsed.assets?.[0].kind).toBe('image') // a non-font kind never swallows a following string
  })

  it('mask / guide / folder: nested layers (parent relationship) + round-trip', () => {
    const reg = (d: string, color = '#000000') => ({ id: 'r', color, path: parsePathData(d) })
    const L = (id: string, name: string, items: ReturnType<typeof reg>[], extra: object) =>
      ({ id, name, visible: true, locked: false, opacity: 1, items, ...extra })
    const prog: Program = {
      width: 200, height: 200, symbols: [],
      layers: [
        L('g', 'Track', [reg('M0 0L100 0L100 100Z')], { isGuide: true }),
        L('t', 'Train', [reg('M0 0L5 0L5 5Z', '#ff0000')], { parent: 'g', orientToGuide: true }),
        L('m', 'Spot', [reg('M0 0L10 0L10 10Z', '#ffffff')], { isMask: true }),
        L('c', 'Hidden', [reg('M0 0L3 0L3 3Z', '#00ff00')], { parent: 'm' }),
        L('f', 'Folder', [], { isFolder: true, collapsed: true }),
        L('d', 'Inside', [reg('M0 0L1 0L1 1Z', '#0000ff')], { parent: 'f' }),
      ],
    }
    const text = printProgram(prog)
    // the parent relationship is rendered by NESTING + modifiers
    expect(text).toContain('guide layer "Track"')
    expect(text).toContain('layer "Train" orient')
    expect(text).toContain('mask layer "Spot"')
    expect(text).toContain('folder layer "Folder" collapsed')
    expect(printProgram(parseProgram(text))).toBe(text) // STABLE round-trip

    const p = parseProgram(text)
    const by = (nm: string) => p.layers.find((l) => l.name === nm)!
    expect(p.layers.map((l) => l.name)).toEqual(['Track', 'Train', 'Spot', 'Hidden', 'Folder', 'Inside']) // flattened into siblings
    expect(by('Track').isGuide).toBe(true)
    expect(by('Train').orientToGuide).toBe(true)
    expect(by('Train').parent).toBe(by('Track').id)
    expect(by('Spot').isMask).toBe(true)
    expect(by('Hidden').parent).toBe(by('Spot').id)
    expect(by('Folder').isFolder).toBe(true)
    expect(by('Folder').collapsed).toBe(true)
    expect(by('Inside').parent).toBe(by('Folder').id)
  })

  it('full program: behavior (scene every frame + object click/expression)', () => {
    const hero = lib()[0]
    const doc: Program = {
      width: 800, height: 600, background: '#101010', symbols: [hero],
      variables: { score: 0 },
      timeline: { fps: 24, durationFrames: 60, tracks: [], onEnterFrame: [{ do: 'setVar', name: 'score', value: 'score + 1' }] },
      layers: [layer('L0', 'c', [
        { id: 'p', kind: 'instance', name: 'player', symbolId: hero.id, transform: T(100, 200), expressions: { x: 'mouse.x' } } as Instance,
      ])],
      interactions: [{ id: 'int1', targetId: 'p', event: 'click', actions: [{ do: 'gotoFrame', frame: 1, play: true }] }],
    }
    const text = printProgramFull(doc)
    expect(text).toContain('every frame {')
    expect(text).toContain('score = score + 1')
    expect(text).toContain('object "player" {')
    expect(text).toContain('when clicked {')
    expect(text).toContain('x = mouse.x')
    // the expression must NOT be duplicated in the composition
    expect(text).not.toContain('instance "Hero" as "player" at 100,200 expr')

    expect(printProgramFull(parseProgramFull(text))).toBe(text) // stable round-trip

    const parsed = parseProgramFull(text)
    expect(parsed.timeline?.onEnterFrame?.length).toBe(1)
    const player = parsed.layers[0].items[0] as Instance
    expect(player.expressions?.x).toBe('mouse.x') // attached to the object by name → id
    expect(parsed.interactions?.[0].event).toBe('click')
    expect(parsed.interactions?.[0].targetId).toBe(player.id)
  })

  it('full program: a scene-object stateful modifier (spring) round-trips into the object block', () => {
    const hero = lib()[0]
    const doc: Program = {
      width: 200, height: 200, symbols: [hero],
      layers: [layer('L0', 'c', [
        { id: 'p', kind: 'instance', name: 'player', symbolId: hero.id, transform: T(100, 100), modifiers: { rotation: { kind: 'spring', target: 'crochetX', stiffness: 0.08, damping: 0.86 } } } as Instance,
      ])],
    }
    const text = printProgramFull(doc)
    expect(text).toContain('object "player" {')
    expect(text).toContain('spring rotation = crochetX { stiffness 0.08 damping 0.86 }')
    expect(text).not.toContain('at 100,100 spring') // not duplicated in the composition (behavior lives in the object block)
    expect(printProgramFull(parseProgramFull(text))).toBe(text) // stable round-trip
    const back = parseProgramFull(text).layers[0].items[0] as Instance & { modifiers?: Record<string, unknown> }
    expect(back.modifiers?.rotation).toEqual({ kind: 'spring', target: 'crochetX', stiffness: 0.08, damping: 0.86 })
  })

  it('channel expression binding on a TEXT (not only group/instance)', () => {
    const src = [
      'size 400 300',
      '',
      'scene {',
      '  layer "c" {',
      '    text "End" font "sans-serif" size 20 align left line 1.2 color #000000 box 40 24',
      '  }',
      '}',
      '',
      'object "End" {',
      '  opacity = lit * lit',
      '}',
      '',
    ].join('\n')
    const parsed = parseProgramFull(src)
    const txt = parsed.layers[0].items[0] as { kind: string; expressions?: Record<string, string> }
    expect(txt.kind).toBe('text')
    expect(txt.expressions?.opacity).toBe('lit * lit') // attached to the text (before the patch: ignored)
    expect(printProgramFull(parseProgramFull(src))).toBe(src) // stable round-trip
  })

  it('object addresses a bare text leaf by its `as` id (≠ content)', () => {
    // The text content is "Bravo" but its handle is `as "msgOK"`. `object "msgOK"` must gate it —
    // before the fix, `object` resolved by name (= content) only, so the `as` id silently no-op'd.
    const src = [
      'size 400 300',
      'scene {',
      '  layer "c" {',
      '    text "Bravo" as "msgOK" font "sans-serif" size 20 align left line 1.2 color #000000 box 40 24',
      '  }',
      '}',
      'object "msgOK" {',
      '  opacity = 0',
      '}',
      '',
    ].join('\n')
    const txt = parseProgramFull(src).layers[0].items[0] as { kind: string; id: string; expressions?: Record<string, string> }
    expect(txt.id).toBe('msgOK')
    expect(txt.expressions?.opacity).toBe('0') // gated via the `as` id, not the content
  })

  it('behaviorDiagnostics surfaces dropped parse errors in object blocks (unknown channel)', () => {
    const src = [
      'size 100 100',
      'scene {',
      '  layer "L" {',
      '    group "G" { layer "c" { circle 0 0 5 fill #f00 } }',
      '  }',
      '}',
      'object "G" {',
      '  scaleZ = 1',
      '}',
      '',
    ].join('\n')
    // The Doc-based linter can't see this (the binding is dropped before reaching the model).
    const g = parseProgramFull(src).layers[0].items[0] as { expressions?: Record<string, string> }
    expect(g.expressions).toBeUndefined()
    const diags = behaviorDiagnostics(src)
    expect(diags).toHaveLength(1)
    expect(diags[0].scope).toBe('object "G"')
    expect(diags[0].diag.line).toBe(8) // absolute line of `scaleZ = 1`
    expect(diags[0].diag.message).toContain('unknown channel "scaleZ"')
  })

  it('a misplaced `as` states the ordering rule instead of "layer expected"', () => {
    // `as` at the END lands where the next item/layer was expected → the bare `"layer" expected, "as" found`
    // sent the author auditing their layer structure, which was never the problem.
    const bad = 'size 100 100\nscene { layer "L" { rect 0 0 10 10 fill #ffffff as "Eclat" } }\n'
    expect(() => parseProgramFull(bad)).toThrow(/"as" is out of place/)
    expect(() => parseProgramFull(bad)).toThrow(/RIGHT AFTER its geometry/)
    // The correct order still parses, and the shape carries the name.
    const good = 'size 100 100\nscene { layer "L" { rect 0 0 10 10 as "Eclat" fill #ffffff } }\n'
    expect((parseProgramFull(good).layers[0].items[0] as Region).name).toBe('Eclat')
  })

  it('a stroke option written after another item option names the rule instead of "layer expected"', () => {
    // `dash`/`cap`/`join`/`miter` belong to `stroke` and must FOLLOW it directly. Slipping `nofill` in
    // between ends the stroke, so `dash` lands where the next item or layer was expected — and the bare
    // `"layer" expected, "dash" found` reads as a grammar regression (it was reported as one), sending the
    // author to check `dash` against the docs, where it is correctly documented.
    const bad = 'size 100 100\nscene { layer "L" { path "M0 0 L10 0" stroke #a08040 2 nofill dash 6,5 } }\n'
    expect(() => parseProgramFull(bad)).toThrow(/"dash" belongs to `stroke`/)
    expect(() => parseProgramFull(bad)).toThrow(/directly after/)
    // The correct order parses and keeps the dash pattern.
    const good = 'size 100 100\nscene { layer "L" { path "M0 0 L10 0" nofill stroke #a08040 2 dash 6,5 } }\n'
    expect((parseProgramFull(good).layers[0].items[0] as Region).stroke?.dash).toEqual([6, 5])
    // Same treatment for the other three options of the same grammar.
    for (const opt of ['cap round', 'join round', 'miter 4']) {
      expect(() => parseProgramFull(`size 100 100\nscene { layer "L" { path "M0 0 L10 0" stroke #a08040 2 nofill ${opt} } }\n`))
        .toThrow(new RegExp(`"${opt.split(' ')[0]}" belongs to \`stroke\``))
    }
  })

  it('`#` used as a comment inside `scene` names the real cause instead of blaming layers', () => {
    // `#` opens a COLOUR. It happens to survive the header half, so an author who comments with it sees
    // the first half work and the second break, on a message about `layer` that points nowhere near the
    // `#`. It cost two of the three broken examples in the shipped prompts.
    const bad = 'size 100 100\nscene {  # composition\n  layer "L" { rect 0 0 10 10 fill #ffffff }\n}\n'
    expect(() => parseProgramFull(bad)).toThrow(/"#" opens a colour/)
    expect(() => parseProgramFull(bad)).toThrow(/comment.*`\/\/`/)
    // The colour itself is untouched, and `//` works where `#` did not.
    const good = 'size 100 100\nscene {  // composition\n  layer "L" { rect 0 0 10 10 fill #ffffff }\n}\n'
    expect(() => parseProgramFull(good)).not.toThrow()
  })

  it('objectTargetDiagnostics: an `object` block on a SHAPE binds to nothing (was silent)', () => {
    const src = [
      'size 100 100',                              // 1
      'var doneAt = 0',                            // 2
      'scene {',                                   // 3
      '  layer "L" {',                             // 4
      '    rect 0 0 100 100 as "Eclat" fill #fff', // 5
      '  }',                                       // 6
      '}',                                         // 7
      'object "Eclat" {',                          // 8
      '  opacity = 1 - doneAt',                    // 9
      '}',                                         // 10
      '',
    ].join('\n')
    // The binding really is dropped: a Region carries no pose (isPoseable is false).
    const item = parseProgramFull(src).layers[0].items[0] as { expressions?: Record<string, string> }
    expect(item.expressions).toBeUndefined()
    const diags = objectTargetDiagnostics(src)
    expect(diags).toHaveLength(1)
    expect(diags[0].scope).toBe('object "Eclat"')
    expect(diags[0].diag.line).toBe(8) // the `object` keyword, absolute in the source
    expect(diags[0].diag.message).toContain('is a shape')
    expect(diags[0].diag.message).toContain('Wrap it in a group')
  })

  it('objectTargetDiagnostics: tells a LAYER and an unknown name apart, and stays silent on real targets', () => {
    const src = [
      'size 100 100',
      'scene {',
      '  layer "L" {',
      '    group "G" { layer "c" { circle 0 0 5 fill #f00 } }',
      '    text "Hi" as "Greet" at 0,0 size 10 color #000000',
      '  }',
      '}',
      'object "L" { opacity = 0.5 }',     // a layer — not animatable
      'object "Nope" { opacity = 0.5 }',  // a typo — nothing of that name
      'object "G" { opacity = 0.5 }',     // a group — fine
      'object "Greet" { opacity = 0.5 }', // a text id — fine
      'object "Hi" { opacity = 0.5 }',    // a text content name — fine
      '',
    ].join('\n')
    const diags = objectTargetDiagnostics(src)
    expect(diags.map((d) => d.scope)).toEqual(['object "L"', 'object "Nope"'])
    expect(diags[0].diag.message).toContain('is a layer')
    expect(diags[1].diag.message).toContain('no group, instance, text or image named "Nope"')
  })

  it('behaviorDiagnostics surfaces a dropped parse error in a SCENE script (incomplete assignment)', () => {
    const src = [
      'size 100 100',          // 1
      'var a = 0',             // 2
      'var b = 0',             // 3
      'scene {',               // 4
      '  layer "L" {',         // 5
      '    circle 0 0 5 fill #f00', // 6
      '  }',                   // 7
      '}',                     // 8
      'every frame {',         // 9
      '  if a < 5 { a = }',    // 10 — incomplete RHS (note: `a = 1  b = 2` now parses as two statements)
      '}',                     // 11
      '',
    ].join('\n')
    const diags = behaviorDiagnostics(src)
    expect(diags).toHaveLength(1)
    expect(diags[0].scope).toBe('scene')
    expect(diags[0].diag.line).toBe(10) // absolute line, mapped through the masked scene text
    expect(diags[0].diag.message).toContain('expression expected after "="')
  })

  it('behaviorDiagnostics is silent on statements crammed on one line (the parser splits them)', () => {
    const src = [
      'size 100 100', 'var a = 0', 'var b = 0',
      'scene {', '  layer "L" {', '    circle 0 0 5 fill #f00', '  }', '}',
      'every frame {', '  if a < 5 { a = 1  b = 2 }', '}', '',
    ].join('\n')
    expect(behaviorDiagnostics(src)).toEqual([])
    expect(parseProgramFull(src).timeline?.onEnterFrame).toEqual([
      { do: 'if', cond: 'a < 5', then: [{ do: 'setVar', name: 'a', value: '1' }, { do: 'setVar', name: 'b', value: '2' }] },
    ])
  })

  it('behaviorDiagnostics is silent on a clean program', () => {
    const src = ['size 100 100', 'scene {', '  layer "L" {', '    group "G" { layer "c" { circle 0 0 5 fill #f00 } }', '  }', '}', 'object "G" {', '  scale = 2', '}', ''].join('\n')
    expect(behaviorDiagnostics(src)).toEqual([])
  })

  it('behavior placed BEFORE the scene block is honored, not silently dropped (scene survives too)', () => {
    // A `fn` / `every frame` in the header used to make the composition parser bail and drop the WHOLE
    // scene (layers: []), and the behavior was never parsed. Now placement is independent.
    const header = [
      'size 100 100', 'var a = 0', 'var d = 0',
      'fn dbl(n) = n * 2',
      'every frame { a = a + 1\n  d = dbl(a) }',
      'scene { layer "L" { circle 50 50 10 fill #ff0000 } }',
    ].join('\n')
    const tail = [
      'size 100 100', 'var a = 0', 'var d = 0',
      'scene { layer "L" { circle 50 50 10 fill #ff0000 } }',
      'fn dbl(n) = n * 2',
      'every frame { a = a + 1\n  d = dbl(a) }',
    ].join('\n')
    for (const src of [header, tail]) {
      const doc = parseProgramFull(src)
      expect(doc.layers[0].items).toHaveLength(1) // scene preserved
      expect(doc.functions?.map((f) => f.name)).toEqual(['dbl']) // fn parsed wherever it sits
      expect(doc.timeline?.onEnterFrame).toHaveLength(2) // every-frame parsed
    }
    expect(behaviorDiagnostics(header)).toEqual([]) // no spurious diagnostics from the masked header/scene
  })

  // ── `text "…" as "<id>"`: stable id, driven by the explicit `idExplicit` flag (zero heuristic) ──
  const prog = (textLine: string) => ['size 400 200', '', 'scene {', '  layer "L" {', `    ${textLine}`, '  }', '}', ''].join('\n')
  const firstText = (src: string) => parseProgram(src).layers[0].items[0] as Text
  const roundtripText = (line: string) => printProgram(parseProgram(prog(line)))

  it('text … as "<id>": sets the Text item id + idExplicit flag', () => {
    const t = firstText(prog('text "Hello" as "txt_hello" at 0, 0 box 10 10'))
    expect(t.kind).toBe('text')
    expect(t.id).toBe('txt_hello')
    expect(t.idExplicit).toBe(true)
    expect(t.content).toBe('Hello')
  })

  it('text without "as": auto-generated id, no flag, and NO stray "as" on print', () => {
    const t = firstText(prog('text "Hello" at 0, 0 box 10 10'))
    expect(t.content).toBe('Hello')
    expect(t.idExplicit).toBeFalsy()
    expect(roundtripText('text "Hello" at 0, 0 box 10 10')).not.toContain(' as ') // "no stray as" guarantee
  })

  // The `as` survives the round-trip regardless of the FORM of the id. "tab" and "t2b" would have been
  // STRIPPED by the old heuristic (^t[0-9a-z]+$); "title" too (documented limitation).
  it.each(['txt_hello', 'tab', 'title', 't2b'])('round-trip: as "%s" survives (arbitrary id form)', (id) => {
    const out = roundtripText(`text "Hello" as "${id}" at 0, 0 box 10 10`)
    expect(out).toContain(`as "${id}"`)
    expect((parseProgram(out).layers[0].items[0] as Text).id).toBe(id) // id preserved → text("…") resolves on the host side
    expect(printProgram(parseProgram(out))).toBe(out) // stable
  })

  it('legacy doc without idExplicit flag → no "as" printed (assumed legacy behavior, out of migration scope)', () => {
    const t: Text = { id: 'id-abc123', kind: 'text', name: 'Text', transform: T(0, 0), content: 'Hi', font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.2, color: '#000000', box: { w: 10, h: 10 } }
    const doc = { width: 100, height: 100, symbols: [], layers: [layer('L', 'c', [t])] }
    const out = printProgram(doc)
    expect(out).not.toContain(' as ')
    expect(out).toContain('text "Hi"')
  })

  it('error: "as" id empty / space / leading digit', () => {
    expect(() => parseProgram(prog('text "Hello" as "" at 0, 0 box 10 10'))).toThrow(/as.*invalid/)
    expect(() => parseProgram(prog('text "Hello" as "foo bar" at 0, 0 box 10 10'))).toThrow(/as.*invalid/)
    expect(() => parseProgram(prog('text "Hello" as "1abc" at 0, 0 box 10 10'))).toThrow(/as.*invalid/)
  })

  // ── Program-level `timeline <fps> <dur>` directive (long loop without a seam) ──
  it('root timeline: parse + round-trip of `timeline <fps> <dur>`', () => {
    const src = prog0('timeline 30 300')
    const doc = parseProgramFull(src)
    expect(doc.timeline?.fps).toBe(30)
    expect(doc.timeline?.durationFrames).toBe(300)
    expect(printProgramFull(doc)).toContain('timeline 30 300')
  })
  it('implicit timeline 24/60: no directive printed', () => {
    const doc: Program = { width: 100, height: 100, symbols: [], layers: [layer('L', 'c', [])] }
    expect(printProgram(doc)).not.toContain('timeline ')
  })
})

describe('flatFormat — noHit flag (non-interactive)', () => {
  it('round-trip: nohit on a region and on a text', () => {
    const src = prog0('').replace('path "M0 0L10 0L10 10Z" fill #000000', 'path "M0 0L10 0L10 10Z" fill #000000 nohit\n    text "X" as "t" at 0,0 box 10 10 nohit')
    const out = printProgram(parseProgram(src))
    expect(out).toContain('fill #000000 nohit')
    expect(out).toContain('box 10 10 nohit')
    const items = parseProgram(out).layers[0].items
    expect((items[0] as { noHit?: boolean }).noHit).toBe(true)
    expect((items[1] as Text).noHit).toBe(true)
    expect(printProgram(parseProgram(out))).toBe(out) // stable
  })
  it('absence of nohit: field omitted', () => {
    const out = printProgram(parseProgram(prog0('')))
    expect(out).not.toContain('nohit')
  })
})

describe('flatFormat — inline expressions on text/image in a .flat', () => {
  it('round-trip: channel expression on a text in a symbol', () => {
    const sym: SymbolDef = { id: 's', name: 'S', layers: [layer('L', 'c', [
      { id: 'tx', kind: 'text', name: 't', transform: T(0, 0), content: 'Hi', font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.2, color: '#000000', box: { w: 10, h: 10 }, expressions: { opacity: 'sin(time)' } } as Text,
    ])] }
    const text = printFlat([sym])
    expect(text).toContain('expr opacity "sin(time)"')
    const back = parseFlat(text)[0].layers[0].items[0] as Text
    expect(back.expressions?.opacity).toBe('sin(time)')
  })
  it('round-trip: channel expression on an image in a symbol', () => {
    const sym: SymbolDef = { id: 's', name: 'S', layers: [layer('L', 'c', [
      { id: 'im', kind: 'image', name: 'i', transform: T(0, 0), assetId: 'a1', w: 20, h: 20, expressions: { rotation: 'time * 90' } } as Image,
    ])] }
    const text = printFlat([sym])
    expect(text).toContain('expr rotation "time * 90"')
    expect((parseFlat(text)[0].layers[0].items[0] as Image).expressions?.rotation).toBe('time * 90')
  })
})

describe('flatFormat — stateful channel modifiers (spring/smooth) in a .flat', () => {
  it('round-trip: spring modifier on a group', () => {
    const sym: SymbolDef = { id: 's', name: 'S', layers: [layer('L', 'c', [
      { id: 'g', kind: 'group', name: 'Suspente', transform: T(0, 0), layers: [], modifiers: { rotation: { kind: 'spring', target: 'crochetX', stiffness: 0.08, damping: 0.86 } } } as Group,
    ])] }
    const text = printFlat([sym])
    expect(text).toContain('spring rotation "crochetX" stiffness 0.08 damping 0.86')
    const back = parseFlat(text)[0].layers[0].items[0] as Group
    expect(back.modifiers?.rotation).toEqual({ kind: 'spring', target: 'crochetX', stiffness: 0.08, damping: 0.86 })
  })

  it('round-trip: smooth modifier on an image', () => {
    const sym: SymbolDef = { id: 's', name: 'S', layers: [layer('L', 'c', [
      { id: 'im', kind: 'image', name: 'i', transform: T(0, 0), assetId: 'a1', w: 20, h: 20, modifiers: { opacity: { kind: 'smooth', target: 'lit', k: 0.18 } } } as Image,
    ])] }
    const text = printFlat([sym])
    expect(text).toContain('smooth opacity "lit" k 0.18')
    expect((parseFlat(text)[0].layers[0].items[0] as Image).modifiers?.opacity).toEqual({ kind: 'smooth', target: 'lit', k: 0.18 })
  })

  it('round-trip: a spring target containing velocity() (opaque to the format)', () => {
    const sym: SymbolDef = { id: 's', name: 'S', layers: [layer('L', 'c', [
      { id: 'g', kind: 'group', name: 'Suspente', transform: T(0, 0), layers: [], modifiers: { rotation: { kind: 'spring', target: 'rad(-velocity(crochetX) * 40)', stiffness: 0.06, damping: 0.22 } } } as Group,
    ])] }
    const text = printFlat([sym])
    expect(text).toContain('spring rotation "rad(-velocity(crochetX) * 40)" stiffness 0.06 damping 0.22')
    expect((parseFlat(text)[0].layers[0].items[0] as Group).modifiers?.rotation).toEqual({ kind: 'spring', target: 'rad(-velocity(crochetX) * 40)', stiffness: 0.06, damping: 0.22 })
  })

  // `rotate 45` on a declaration line is a FIXED rotation in DEGREES (0.38). A channel spelled `rotate` on
  // that same line meant radians — `group "G" rotate 45 spring rotate "a"` mixed the two units in one
  // breath. On a declaration line the channel is now written `rotation` (radians) or `rotationDeg`.
  it('on a declaration line, a modifier on `rotate` is an error that names the two spellings', () => {
    expect(() => parseFlat('symbol "S" {\n  layer "c" {\n    group "A" spring rotate "crochetX" stiffness 0.08 damping 0.86 {\n    }\n  }\n}')).toThrow(/`rotate`.*degrees.*`rotation`.*`rotationDeg`/s)
  })
  it('authoring sugar: `rotationDeg` wraps the target in rad()', () => {
    const text = [
      'symbol "S" {',
      '  layer "c" {',
      '    group "A" spring rotation "crochetX" stiffness 0.08 damping 0.86 {',
      '    }',
      '    group "B" smooth rotationDeg "valeur * 270" k 0.18 {',
      '    }',
      '  }',
      '}',
    ].join('\n')
    const items = parseFlat(text)[0].layers[0].items as Group[]
    expect(items[0].modifiers?.rotation).toEqual({ kind: 'spring', target: 'crochetX', stiffness: 0.08, damping: 0.86 })
    expect(items[1].modifiers?.rotation).toEqual({ kind: 'smooth', target: 'rad(valeur * 270)', k: 0.18 })
  })
})

describe('flatFormat — shape primitives (sugar normalized to path)', () => {
  const sceneItem = (line: string): Region =>
    parseProgramFull(['size 100 100', 'scene {', '  layer "L" {', `    ${line}`, '  }', '}'].join('\n')).layers[0].items[0] as Region

  it('circle cx cy r → same trace as circlePath', () => {
    expect(sceneItem('circle 50 50 20 fill #ff0000').path).toEqual(circlePath(50, 50, 20))
  })
  it('ellipse cx cy rx ry → same trace as ellipsePath', () => {
    expect(sceneItem('ellipse 40 30 20 10 fill #00ff00').path).toEqual(ellipsePath(40, 30, 20, 10))
  })
  it('rect x y w h [r] [ry] → rectPath (square, uniform rounding, rx/ry rounding)', () => {
    expect(sceneItem('rect 0 0 30 20 fill #0000ff').path).toEqual(rectPath(0, 0, 30, 20, 0, 0))
    expect(sceneItem('rect 0 0 30 20 5 fill #0000ff').path).toEqual(rectPath(0, 0, 30, 20, 5, 5))
    expect(sceneItem('rect 0 0 30 20 6 3 fill #0000ff').path).toEqual(rectPath(0, 0, 30, 20, 6, 3))
  })
  it('the primitives inherit fill/stroke/opacity like a path', () => {
    const r = sceneItem('circle 10 10 5 fill #112233 stroke #445566 2 opacity 0.5')
    expect(r.color).toBe('#112233')
    expect(r.stroke).toEqual({ width: 2, paint: { type: 'solid', color: '#445566' } })
    expect(r.opacity).toBe(0.5)
  })
})

describe('flatFormat — text: wrap + bind (dynamic text)', () => {
  const textItem = (line: string): Text =>
    parseProgramFull(['size 200 100', 'scene {', '  layer "L" {', `    ${line}`, '  }', '}'].join('\n')).layers[0].items[0] as Text

  it('parse wrap / bind / decimals', () => {
    const t = textItem('text "Angle: {} deg" at 0,0 font "sans-serif" size 16 align left line 1.2 color #000000 box 120 40 wrap bind "round(aDeg)" decimals 1')
    expect(t.wrap).toBe(true)
    expect(t.bind).toBe('round(aDeg)')
    expect(t.decimals).toBe(1)
  })
  // flatink/flatink#32 — French school activities need `−3,25` and `12,50`, not `-3.25` / `12.50`.
  it('`locale fr` is parsed, printed back, and checked', () => {
    const t = textItem('text "{}" at 0,0 bind "v" decimals 2 locale fr')
    expect(t.locale).toBe('fr')
    const src = ['size 200 100', '', 'scene {', '  layer "L" {', '    text "v={}" at 10,5 font "sans-serif" size 16 align left line 1.2 color #000000 box 80 20 bind "score" decimals 2 locale fr', '  }', '}', ''].join('\n')
    expect(printProgramFull(parseProgramFull(src))).toBe(src)
    expect(() => textItem('text "{}" at 0,0 bind "v" locale de')).toThrow(/locale/)
  })
  it('`bind "a", "b"`: several expressions, printed back the same', () => {
    const t = textItem('text "{} sur {}" at 0,0 bind "a", "b + 1"')
    expect([t.bind, t.bindMore]).toEqual(['a', ['b + 1']])
    const src = ['size 200 100', '', 'scene {', '  layer "L" {', '    text "{} sur {}" at 10,5 font "sans-serif" size 16 align left line 1.2 color #000000 box 80 20 bind "a", "b"', '  }', '}', ''].join('\n')
    expect(printProgramFull(parseProgramFull(src))).toBe(src)
  })
  it('stable round-trip with wrap/bind/decimals', () => {
    const src = ['size 200 100', '', 'scene {', '  layer "L" {', '    text "v={}" at 10,5 font "sans-serif" size 16 align left line 1.2 color #000000 box 80 20 wrap bind "score" decimals 2', '  }', '}', ''].join('\n')
    expect(printProgramFull(parseProgramFull(src))).toBe(src)
  })
})

describe('flatFormat — scene repeat (sugar unfolded at parse)', () => {
  it('generates N items, index interpolated via $()', () => {
    const src = ['size 200 100', 'scene {', '  layer "L" {', '    repeat i from 0 to 2 {', '      circle $(10 + i*20) 50 5 fill #000000', '    }', '  }', '}'].join('\n')
    const items = parseProgramFull(src).layers[0].items as Region[]
    expect(items).toHaveLength(3)
    expect(items.map((it) => it.path)).toEqual([circlePath(10, 50, 5), circlePath(30, 50, 5), circlePath(50, 50, 5)])
  })
  it('nested loops (grid)', () => {
    const src = ['size 200 200', 'scene {', '  layer "L" {', '    repeat r from 0 to 1 {', '      repeat c from 0 to 1 {', '        circle $(c*10) $(r*10) 2 fill #000000', '      }', '    }', '  }', '}'].join('\n')
    const items = parseProgramFull(src).layers[0].items as Region[]
    expect(items).toHaveLength(4)
    expect(items[0].path).toEqual(circlePath(0, 0, 2))
    expect(items[3].path).toEqual(circlePath(10, 10, 2))
  })
  it('does not touch the runtime `repeat` of object scripts (after the scene)', () => {
    const src = ['size 100 100', 'scene {', '  layer "L" {', '    circle 10 10 5 fill #000000', '  }', '}', '', 'object "X" {', '  when clicked {', '    repeat 3 times {', '      play', '    }', '  }', '}'].join('\n')
    // A single circle in the scene; the runtime repeat stays a handler (not unfolded into items).
    expect(parseProgramFull(src).layers[0].items).toHaveLength(1)
    expect(parseProgramFull(src).interactions?.some((i) => i.event === 'click')).toBe(true)
  })
})

describe('flatFormat — def constants + generalized $()', () => {
  it('def usable in scene coordinates via $() (without repeat)', () => {
    const src = ['def colG = 120', 'size 200 200', 'scene {', '  layer "L" {', '    circle $(colG) $(colG / 2) 5 fill #000000', '  }', '}'].join('\n')
    const items = parseProgramFull(src).layers[0].items as Region[]
    expect(items).toHaveLength(1)
    expect(items[0].path).toEqual(circlePath(120, 60, 5))
  })
  it('def in a chain (references a previous def) + combined with repeat', () => {
    const src = ['def x0 = 60', 'def gap = 40', 'def n = 2', 'size 400 200', 'scene {', '  layer "L" {', '    repeat i from 0 to n {', '      circle $(x0 + i*gap) 50 5 fill #000000', '    }', '  }', '}'].join('\n')
    const items = parseProgramFull(src).layers[0].items as Region[]
    expect(items).toHaveLength(3) // i = 0,1,2 (bound n = 2 resolved via def)
    expect(items.map((it) => it.path)).toEqual([circlePath(60, 50, 5), circlePath(100, 50, 5), circlePath(140, 50, 5)])
  })
  it('def resolved in a BEHAVIOR expression (object), not just the scene (#3 EDU)', () => {
    const src = [
      'def vmax = 7', 'size 200 200', 'var t = 0',
      'scene { layer "L" {',
      '  group "Ball" at 20,100 { layer "c" { circle 0 0 10 fill #000000 } }',
      '} }', '',
      'object "Ball" { x = 20 + t * $(vmax) }',
    ].join('\n')
    const g = parseProgramFull(src).layers[0].items[0] as Group
    expect(g.expressions?.x).toBe('20 + t * 7') // $(vmax) resolved in the behavior, not just the scene
  })
  it('the def lines are removed from the source (no parse error)', () => {
    const src = ['def k = 7', 'size 100 100', 'scene {', '  layer "L" {', '    circle 10 10 5 fill #000000', '  }', '}'].join('\n')
    const prog = parseProgramFull(src)
    expect(prog.width).toBe(100)
    expect(prog.layers[0].items).toHaveLength(1)
  })
})

describe('flatFormat — at center anchor', () => {
  const tf = (at: string) => {
    const src = ['size 400 300', 'scene {', '  layer "L" {', `    group "G" at ${at} { layer "c" { path "M0 0L1 0L1 1Z" fill #000000 } }`, '  }', '}'].join('\n')
    return (parseProgramFull(src).layers[0].items[0] as Group).transform
  }
  it('at center = canvas center; center on a single axis; numbers intact', () => {
    expect(tf('center')).toMatchObject({ e: 200, f: 150 }) // 400/2, 300/2
    expect(tf('center,540')).toMatchObject({ e: 200, f: 540 })
    expect(tf('120,center')).toMatchObject({ e: 120, f: 150 })
    expect(tf('10,20')).toMatchObject({ e: 10, f: 20 })
  })
})

describe('flatFormat — parameterized symbols (VISUAL template, expanded at parse)', () => {
  const tmpl = [
    'symbol "Tile"(label, tint = "#ffffff") {',
    '  layer "c" {',
    '    rect -20 -20 40 40 fill $(tint)',
    '    text "$(label)" font "sans-serif" size 16 align center line 1.2 color #000000 box 40 40',
    '  }',
    '}',
  ]
  const grp = (prog: Program, name: string) => prog.layers[0].items.find((it) => 'name' in it && it.name === name) as Group
  const txt = (g: Group) => (g.layers[0].items.find((it) => 'kind' in it && it.kind === 'text') as Text).content
  const rgn = (g: Group) => g.layers[0].items.find((it) => !('kind' in it)) as Region

  it('each instance → a concrete group, text/color params substituted, default applied', () => {
    const src = [...tmpl, 'size 200 200', 'scene {', '  layer "L" {',
      '    instance "Tile"("A", "#ff0000") as "T1" at 50,50',
      '    instance "Tile"("B") as "T2" at 100,60', // default tint
      '  }', '}'].join('\n')
    const prog = parseProgramFull(src)
    const t1 = grp(prog, 'T1'), t2 = grp(prog, 'T2')
    expect(t1.transform).toMatchObject({ e: 50, f: 50 })
    expect(t2.transform).toMatchObject({ e: 100, f: 60 })
    expect(txt(t1)).toBe('A')
    expect(txt(t2)).toBe('B')
    expect(rgn(t1).color).toBe('#ff0000')
    expect(rgn(t2).color).toBe('#ffffff') // default
  })
  it('combined with repeat = keypad generation (visual): i in args + ids + positions', () => {
    const src = [
      'symbol "Key"(label) { layer "c" { text "$(label)" font "sans-serif" size 24 align center line 1.2 color #000000 box 60 60 } }',
      'size 300 300', 'scene {', '  layer "L" {',
      '    repeat i from 0 to 2 {',
      '      instance "Key"($(i+1)) as "T$(i)" at $(50 + i*70),100',
      '    }',
      '  }', '}'].join('\n')
    const prog = parseProgramFull(src)
    const tiles = prog.layers[0].items.filter((it) => 'name' in it && typeof it.name === 'string' && /^T\d$/.test(it.name)) as Group[]
    expect(tiles.map((t) => t.name)).toEqual(['T0', 'T1', 'T2'])
    expect(tiles.map((t) => txt(t))).toEqual(['1', '2', '3']) // $(i+1)
    expect(tiles.map((t) => t.transform.e)).toEqual([50, 120, 190]) // $(50 + i*70)
  })
  it('arity exceeded → error', () => {
    const src = [...tmpl, 'size 100 100', 'scene { layer "L" { instance "Tile"("A","#fff","extra") at 0,0 } }'].join('\n')
    expect(() => parseProgramFull(src)).toThrow(/3 arguments for 2/)
  })
  it('unknown parameterized symbol → error', () => {
    const src = ['size 100 100', 'scene { layer "L" { instance "Ghost"(1) at 0,0 } }'].join('\n')
    expect(() => parseProgramFull(src)).toThrow(/not defined/)
  })
  it('an instance can share its line with the closing braces of its layer/scene (no brace swallowed)', () => {
    // `… at 50,50 } }` on one line: the trailing `}}` close the layer+scene, not the generated group.
    const src = [...tmpl, 'size 100 100', 'scene { layer "L" { instance "Tile"("A", "#ff0000") as "T1" at 50,50 } }'].join('\n')
    const prog = parseProgramFull(src)
    const t1 = grp(prog, 'T1')
    expect(t1.transform).toMatchObject({ e: 50, f: 50 })
    expect(txt(t1)).toBe('A')
    expect(rgn(t1).color).toBe('#ff0000')
  })
  it('each "Tmpl" as i { when clicked … } → one handler per generated instance (index substituted)', () => {
    const src = [
      'symbol "Key"(label) { layer "c" { text "$(label)" font "sans-serif" size 24 align center line 1.2 color #000000 box 60 60 } }',
      'size 300 300', 'var input = 0', 'scene { layer "L" {',
      '  repeat i from 0 to 2 { instance "Key"($(i+1)) as "T$(i)" at $(50 + i*70),100 }',
      '} }', '',
      'each "Key" as i { when clicked { input = input * 10 + (i + 1) } }',
    ].join('\n')
    const prog = parseProgramFull(src)
    const clicks = (prog.interactions ?? []).filter((it) => it.event === 'click')
    expect(clicks).toHaveLength(3) // one per generated tile
    expect(new Set(clicks.map((c) => c.targetId)).size).toBe(3) // distinct targets (T0/T1/T2)
    const vals = clicks.flatMap((c) => c.actions).filter((a) => a.do === 'setVar').map((a) => (a.value as string).replace(/\s/g, ''))
    expect(vals.sort()).toEqual(['input*10+(0+1)', 'input*10+(1+1)', 'input*10+(2+1)']) // i substituted per instance
  })
  it('each "Tmpl" as i: $(def + i*gap) in the body is resolved per instance (checker/runtime parity, EDU #5)', () => {
    const src = [
      'def col = 50',
      'def gap = 70',
      'symbol "Key"(label) { layer "c" { text "$(label)" font "sans-serif" size 24 align center line 1.2 color #000000 box 60 60 } }',
      'size 300 300', 'var v = 0', 'scene { layer "L" {',
      '  repeat i from 0 to 2 { instance "Key"($(i+1)) as "T$(i)" at $(50 + i*70),100 }',
      '} }', '',
      'each "Key" as i { when clicked { v = $(col + i*gap) } }',
    ].join('\n')
    const prog = parseProgramFull(src)
    const clicks = (prog.interactions ?? []).filter((it) => it.event === 'click')
    const vals = clicks.flatMap((c) => c.actions).filter((a) => a.do === 'setVar').map((a) => a.value as string)
    expect(vals.every((v) => !v.includes('$'))).toBe(true) // no leftover `$(` (which the checker rejects)
    expect(vals.map(Number).sort((a, b) => a - b)).toEqual([50, 120, 190]) // col + i*gap, per instance
  })
  it('each + drag with INDEXED output: one interactor per instance, output hx[k] (EDU case)', () => {
    const src = [
      'symbol "Handle"(c) { layer "c" { circle 0 0 10 fill $(c) } }',
      'size 300 300', 'var hx = [0, 0]', 'var hy = [0, 0]', 'scene { layer "L" {',
      '  repeat i from 0 to 1 { instance "Handle"("#ffffff") as "P$(i)" at $(80 + i*100),150 }',
      '} }', '',
      'each "Handle" as i { drag hx[i], hy[i] }',
    ].join('\n')
    const drags = parseProgramFull(src).interactors ?? []
    expect(drags).toHaveLength(2) // one drag per generated handle
    expect(drags.map((d) => d.varX).sort()).toEqual(['hx[0]', 'hx[1]']) // the index substituted in the indexed output
    expect(drags.map((d) => d.varY).sort()).toEqual(['hy[0]', 'hy[1]'])
  })
  it('each on a NON-parameterized symbol stays a runtime binding (Timeline.binds, intact)', () => {
    const src = ['size 100 100', 'scene { layer "L" { circle 0 0 5 fill #000000 } }', '', 'each "Brick" as i { opacity = vals[i] }'].join('\n')
    const prog = parseProgramFull(src)
    expect(prog.timeline?.binds).toEqual([{ symbol: 'Brick', as: 'i', expr: { opacity: 'vals[i]' } }])
    expect(prog.interactions ?? []).toHaveLength(0) // not transformed into handlers
  })
})

describe('flatFormat — align <point> of "Name" anchor', () => {
  // Setup: group at (100,100), content rect -50..50 → WORLD bbox 50..150 (center 100,100).
  const scene = (pawnClause: string) => [
    'size 400 300', 'scene {', '  layer "L" {',
    '    group "Frame" at 100,100 { layer "c" { rect -50 -50 100 100 fill #000000 } }',
    `    group "Pawn" ${pawnClause} { layer "c" { circle 0 0 5 fill #ff0000 } }`,
    '  }', '}',
  ].join('\n')
  const pawn = (clause: string) => (parseProgramFull(scene(clause)).layers[0].items.find((it) => 'name' in it && it.name === 'Pawn') as Group).transform
  it('places the origin on the 9 points of the static bbox', () => {
    expect(pawn('align center of "Frame"')).toMatchObject({ e: 100, f: 100 })
    expect(pawn('align right of "Frame"')).toMatchObject({ e: 150, f: 100 })
    expect(pawn('align left of "Frame"')).toMatchObject({ e: 50, f: 100 })
    expect(pawn('align top of "Frame"')).toMatchObject({ e: 100, f: 50 })
    expect(pawn('align bottom of "Frame"')).toMatchObject({ e: 100, f: 150 })
    expect(pawn('align topleft of "Frame"')).toMatchObject({ e: 50, f: 50 })
    expect(pawn('align bottomright of "Frame"')).toMatchObject({ e: 150, f: 150 })
  })
  it('offset slot dx,dy', () => {
    expect(pawn('align bottom of "Frame" offset 0,18')).toMatchObject({ e: 100, f: 168 })
    expect(pawn('align right of "Frame" offset 12,-4')).toMatchObject({ e: 162, f: 96 })
  })
  it('chain + forward reference: C aligned on B (declared after) itself aligned on A', () => {
    const src = [
      'size 400 300', 'scene {', '  layer "L" {',
      '    group "A" at 100,100 { layer "c" { rect -10 -10 20 20 fill #000000 } }',
      '    group "C" align center of "B" { layer "c" { circle 0 0 2 fill #ff0000 } }', // declared BEFORE its target B
      '    group "B" align center of "A" { layer "c" { rect -10 -10 20 20 fill #0000ff } }',
      '  }', '}',
    ].join('\n')
    const items = parseProgramFull(src).layers[0].items as Group[]
    expect(items.find((it) => it.name === 'B')!.transform).toMatchObject({ e: 100, f: 100 })
    expect(items.find((it) => it.name === 'C')!.transform).toMatchObject({ e: 100, f: 100 })
  })
  it('target not found → hard error', () => {
    expect(() => parseProgramFull(scene('align center of "Ghost"'))).toThrow(/not found/)
  })
  it('does NOT capture the text-align attribute (align left|center without "of")', () => {
    const src = ['size 100 100', 'scene {', '  layer "L" {', '    text "Hi" align center font "sans-serif" size 12 box 40 20', '  }', '}'].join('\n')
    const t = parseProgramFull(src).layers[0].items[0] as Text
    expect(t.align).toBe('center') // text-align preserved, not interpreted as an anchor
  })
})

describe('flatFormat — hitbox on group (drop zone)', () => {
  it('parse and round-trip a hitbox', () => {
    const src = ['size 100 100', '', 'scene {', '  layer "L" {', '    group "Zone" at 50,50 hitbox 80 60 {', '      layer "c" {', '        path "M0 0L1 0L1 1Z" fill #000000', '      }', '    }', '  }', '}', ''].join('\n')
    const g = parseProgramFull(src).layers[0].items[0] as Group
    expect(g.hitbox).toEqual({ w: 80, h: 60 })
    expect(printProgramFull(parseProgramFull(src))).toBe(src) // stable round-trip
  })
})

describe('flatFormat — filter on path (region)', () => {
  it('parse and round-trip a filter on a path', () => {
    const src = ['size 100 100', '', 'scene {', '  layer "L" {', '    path "M0 0L10 0L10 10Z" fill #000000 filter glow 5 #ffffff', '  }', '}', ''].join('\n')
    const reg = parseProgramFull(src).layers[0].items[0] as Region
    expect(reg.filters).toEqual([{ type: 'glow', blur: 5, color: '#ffffff' }])
    expect(printProgramFull(parseProgramFull(src))).toBe(src) // stable round-trip
  })
})

describe('flatFormat — `draw` (stroke extent by arc length)', () => {
  const shape = (attrs: string) => `    path "M0 0L100 0" nofill stroke #ffffff 18 cap round${attrs}`
  const prog = (attrs: string) => ['size 100 100', '', 'scene {', '  layer "L" {', shape(attrs), '  }', '}', ''].join('\n')

  it('a literal fraction parses and round-trips', () => {
    const src = prog(' draw 0.35')
    expect(parseProgramFull(src).layers[0].items[0] as Region).toMatchObject({ draw: 0.35 })
    expect(printProgramFull(parseProgramFull(src))).toBe(src)
  })

  it('a QUOTED value is an expression (re-evaluated per frame), with an optional `from` window', () => {
    const src = prog(' draw "progress" from "progress - 0.2"')
    const reg = parseProgramFull(src).layers[0].items[0] as Region
    expect(reg).toMatchObject({ drawExpr: 'progress', drawFromExpr: 'progress - 0.2' })
    expect(reg.draw).toBeUndefined() // the numeric value is the renderer's, resolved per frame
    expect(printProgramFull(parseProgramFull(src))).toBe(src)
  })

  it('`draw 1` is the default → not printed; a bare `from` still prints its (implicit) end', () => {
    expect(printProgramFull(parseProgramFull(prog(' draw 1')))).toBe(prog(''))
    expect(printProgramFull(parseProgramFull(prog(' draw 1 from 0.4')))).toBe(prog(' draw 1 from 0.4'))
  })

  it('it sits AFTER the stroke options, and leaves the rest of the attributes alone', () => {
    const src = ['size 100 100', '', 'scene {', '  layer "L" {',
      '    path "M0 0L100 0" nofill stroke #ffffff 18 cap round dash 6,5 draw "p" opacity 0.5 nohit', '  }', '}', ''].join('\n')
    const reg = parseProgramFull(src).layers[0].items[0] as Region
    expect(reg).toMatchObject({ drawExpr: 'p', opacity: 0.5, noHit: true })
    expect(reg.stroke).toMatchObject({ width: 18, cap: 'round', dash: [6, 5] })
    expect(printProgramFull(parseProgramFull(src))).toBe(src)
  })
})

describe('flatFormat — reveal / link gestures (object → model → text)', () => {
  const src = [
    'size 200 200', 'scene {', '  layer "c" {',
    '    group "Card" at 10,10 { layer "c" { path "M0 0L1 0L1 1Z" fill #000000 } }',
    '    group "Capital" at 50,50 { layer "c" { path "M0 0L1 0L1 1Z" fill #000000 } }',
    '    group "Country" at 100,100 { layer "c" { path "M0 0L1 0L1 1Z" fill #000000 } }',
    '  }', '}', '',
    'object "Card" {', '  reveal seen {', '    brush 30', '    grain 8', '    erase', '    cells grid', '  }', '}', '',
    'object "Capital" {', '  link ex, ey, target to Country', '}', '',
  ].join('\n')

  it('parse the reveal/link interactors with their fields', () => {
    const doc = parseProgramFull(src)
    const reveal = doc.interactors!.find((i) => i.axis === 'reveal')!
    expect(reveal).toMatchObject({ axis: 'reveal', varX: 'seen', grid: 30, grain: 8, erase: true, cells: 'grid' })
    const link = doc.interactors!.find((i) => i.axis === 'link')!
    expect(link).toMatchObject({ axis: 'link', varX: 'ex', varY: 'ey', varT: 'target', confine: 'Country' })
  })

  it('stable round-trip (idempotent) + canonical gesture lines', () => {
    const once = printProgramFull(parseProgramFull(src))
    expect(printProgramFull(parseProgramFull(once))).toBe(once) // print∘parse idempotent
    expect(once).toContain('reveal seen {\n    brush 30\n    grain 8\n    erase\n    cells grid\n  }')
    expect(once).toContain('link ex, ey, target to Country')
  })
})

describe('flatFormat — match (declarative matching, unfolded into object blocks)', () => {
  const prog = (matchBlock: string) => [
    'size 400 300', 'scene {', '  layer "L" {',
    '    group "Word1" at 10,10 { layer "c" { path "M0 0L1 0L1 1Z" fill #000000 } }',
    '    group "Word2" at 30,10 { layer "c" { path "M0 0L1 0L1 1Z" fill #000000 } }',
    '    group "Good" at 100,100 { layer "c" { path "M0 0L1 0L1 1Z" fill #000000 } }',
    '    group "Bad" at 200,100 { layer "c" { path "M0 0L1 0L1 1Z" fill #000000 } }',
    '  }', '}', '', matchBlock,
  ].join('\n')

  it('generates a drag-if-free per item + a drop per zone, with state', () => {
    const doc = parseProgramFull(prog([
      'match Word1, Word2 onto Good, Bad {',
      '  correct Word1 -> Good, Word2 -> Bad',
      '  on wrong as it { send "ko", text(it) }',
      '}',
    ].join('\n')))
    // one drag per item, dynamic lock on _placed
    expect(doc.interactors).toHaveLength(2)
    const m1drag = doc.interactors!.find((i) => i.varX === 'Word1_x')!
    expect(m1drag.enabled).toBe('Word1_placed != 1')
    // 4 drops (2 items × 2 zones), at the pointer
    const drops = doc.interactions!.filter((i) => i.event === 'drop')
    expect(drops).toHaveLength(4)
    expect(drops.every((d) => d.atPointer)).toBe(true)
    // the correct drop of Word1 (on Good) sets placed=1 / ok=1 / zone=1
    const m1bon = drops.find((d) => i_name(doc, d.targetId) === 'Word1' && d.over === 'Good')!
    expect(m1bon.actions).toEqual(expect.arrayContaining([
      { do: 'setVar', name: 'Word1_placed', value: '1' },
      { do: 'setVar', name: 'Word1_ok', value: '1' },
    ]))
    // the incorrect drop of Word1 (on Bad) does NOT lock (retryable) and runs the wrong hook
    const m1bad = drops.find((d) => i_name(doc, d.targetId) === 'Word1' && d.over === 'Bad')!
    expect(m1bad.actions.some((a) => a.do === 'setVar' && a.name === 'Word1_placed')).toBe(false)
    expect(m1bad.actions.some((a) => a.do === 'send' && a.event === 'ko')).toBe(true)
  })

  it('lock on wrong → also locks on the wrong zone', () => {
    const doc = parseProgramFull(prog([
      'match Word1 onto Good, Bad {', '  correct Word1 -> Good', '  lock on wrong', '}',
    ].join('\n')))
    const m1bad = doc.interactions!.find((d) => d.event === 'drop' && d.over === 'Bad')!
    expect(m1bad.actions.some((a) => a.do === 'setVar' && a.name === 'Word1_placed' && a.value === '1')).toBe(true)
  })
})

function i_name(doc: { layers: { items: { id: string; name?: string }[] }[] }, id: string): string | undefined {
  for (const l of doc.layers) for (const it of l.items) if (it.id === id) return it.name
  return undefined
}

describe('flatFormat -- feedback sugar (EDU #10)', () => {
  const findItem = (prog: Program, name: string) => prog.layers[0].items.find((it) => 'name' in it && it.name === name) as Group
  it('feedback <tokens> -> channel bindings (composed, on ONE line) + use "feedback"', () => {
    const src = [
      'size 200 200',
      'scene { layer "L" { group "Btn" at 100,100 { layer "c" { circle 0 0 30 fill #00aaff } } } }',
      'object "Btn" {', '  feedback lift tilt dim shake(wrong)', '}',
    ].join('\n')
    const prog = parseProgramFull(src)
    expect(prog.imports).toContain('feedback') // import auto-injected so lift/tilt/dim/shake resolve
    expect(findItem(prog, 'Btn').expressions).toMatchObject({
      scaleX: 'lift(self.hovered)',
      scaleY: 'lift(self.hovered) * tilt(self.grabbed)', // hover + grab composed on one channel
      opacity: 'dim(self.hovered)',
      rotation: 'shake(wrong, clock)', // monotone: on `time` the wobble skipped on every timeline loop
    })
  })
  it('the sugar is LINE-PRESERVING (one line in, one line out — diagnostics stay on the author\'s lines)', () => {
    const src = ['size 200 200', 'scene { layer "L" { group "Btn" { layer "c" { circle 0 0 30 fill #00aaff } } } }',
      'object "Btn" {', '  feedback lift tilt dim shake(wrong)', '}'].join('\n')
    expect(expandFeedback(src).split('\n')).toHaveLength(src.split('\n').length)
  })
  it('composes only the chosen channels (no clash with x/y position bindings)', () => {
    const src = [
      'size 200 200', 'var px = 0', 'var py = 0',
      'scene { layer "L" { group "P" at 50,50 { layer "c" { circle 0 0 10 fill #000000 } } } }',
      'object "P" {', '  x = px', '  y = py', '  feedback dim', '}',
    ].join('\n')
    const ex = findItem(parseProgramFull(src), 'P').expressions!
    expect(ex.x).toBe('px') // position bindings untouched
    expect(ex.y).toBe('py')
    expect(ex.opacity).toBe('dim(self.hovered)') // only opacity added
    expect(ex.scaleX).toBeUndefined() // no `lift` → no scale channel
  })
  it('no feedback keyword -> source untouched, no import injected', () => {
    const src = ['size 100 100', 'scene { layer "L" { circle 0 0 5 fill #000000 } }'].join('\n')
    expect(parseProgramFull(src).imports).toBeUndefined()
  })
})

describe('flatFormat — pose rotate/scale sugar (degrees, around pivot)', () => {
  const spinner = (): SymbolDef => ({
    id: 'sp', name: 'Spinner',
    timeline: { fps: 24, durationFrames: 8, tracks: [] },
    layers: [{
      id: 'L', name: 'wheel', visible: true, locked: false, opacity: 1,
      items: [{ id: 'w', kind: 'group', name: 'Wheel', transform: T(50, 50), pivot: { x: 10, y: 10 }, layers: [] } as Group],
      cels: [
        { frame: 0, tween: true, poses: [{ id: 'w', rotate: 0, scaleX: 2, scaleY: 2 } as never] },
        { frame: 8, poses: [{ id: 'w', rotate: 90 } as never] },
      ],
    }],
  })

  it('serializes rotate <deg> / scale and round-trips', () => {
    const text = printFlat([spinner()])
    expect(text).toContain('rotate 0 scale 2')
    expect(text).toContain('pose "Wheel" rotate 90') // no `at` → inherits the body position
    expect(printFlat(parseFlat(text))).toBe(text) // stable
  })

  it('parses the decomposed channels back onto the pose', () => {
    const back = parseFlat(printFlat([spinner()]))[0]
    const p0 = back.layers[0].cels![0].poses[0]
    expect([p0.rotate, p0.scaleX, p0.scaleY]).toEqual([0, 2, 2])
    expect(p0.transform).toBeUndefined() // position inherited, not baked into a matrix
    expect(back.layers[0].cels![1].poses[0].rotate).toBe(90)
  })

  it('scaleX/scaleY (non-uniform) serialize separately', () => {
    const text = printFlat([{ ...spinner(), layers: [{ ...spinner().layers[0], cels: [{ frame: 0, poses: [{ id: 'w', scaleX: 2, scaleY: 3 } as never] }] }] }])
    expect(text).toContain('scaleX 2 scaleY 3')
    expect(printFlat(parseFlat(text))).toBe(text)
  })
})

describe('flatFormat — symbol states block (P3)', () => {
  const doorFlat = [
    'symbol "Door" {',
    '  timeline 24 24',
    '  states door { closed at 0  open at 24  initial closed  transition 12 ease easeInOut }',
    '  layer "panel" {',
    '    path "M0 0L20 0L20 40L0 40Z" fill #884422',
    '  }',
    '}',
    '',
  ].join('\n')

  it('parses a states machine onto the symbol', () => {
    const sym = parseFlat(doorFlat)[0]
    expect(sym.states).toHaveLength(1)
    const sm = sym.states![0]
    expect(sm.param).toBe('door')
    expect(sm.states).toEqual([{ name: 'closed', frame: 0 }, { name: 'open', frame: 24 }])
    expect(sm.initial).toBe('closed')
    expect(sm.transition).toBe(12)
    expect(sm.ease).toBe('easeInOut')
  })

  it('round-trips stably', () => {
    expect(printFlat(parseFlat(doorFlat))).toBe(doorFlat)
  })

  it('a minimal states block (no initial/transition) round-trips', () => {
    const t = ['symbol "Light" {', '  timeline 24 2', '  states lit { off at 0  on at 1 }', '  layer "l" {', '    path "M0 0L1 0L1 1Z" fill #ffff00', '  }', '}', ''].join('\n')
    expect(printFlat(parseFlat(t))).toBe(t)
  })
})

describe('flatFormat — symbol params block + fill <param> + call-site (params interface)', () => {
  const boat = [
    'symbol "Boat" {',
    '  params {',
    '    color hull = #c0392b "Hull color"',
    '    color sail = #2980b9',
    '    number wave = 1 range 0 2 "Bob amplitude"',
    '    bool flag = true',
    '  }',
    '  layer "body" {',
    '    path "M0 0L40 0L40 20L0 20Z" fill hull',
    '    instance "Pennant" as "Flag" at 30,0 { tone = warm, size = 1.5 }',
    '  }',
    '}',
    '',
    'symbol "Pennant" {',
    '  layer "l" {',
    '    path "M0 0L8 4L0 8Z" fill #ffffff',
    '  }',
    '}',
    '',
  ].join('\n')

  it('parses params (type/default/range/doc), fill <param>, and call-site values', () => {
    const [boatSym, pennant] = parseFlat(boat)
    expect(boatSym.params).toEqual([
      { name: 'hull', type: 'color', default: '#c0392b', doc: 'Hull color' },
      { name: 'sail', type: 'color', default: '#2980b9' },
      { name: 'wave', type: 'number', default: '1', min: 0, max: 2, doc: 'Bob amplitude' },
      { name: 'flag', type: 'bool', default: 'true' },
    ])
    const region = boatSym.layers[0].items[0] as { fillParam?: string }
    expect(region.fillParam).toBe('hull')
    const inst = boatSym.layers[0].items[1] as { params?: Record<string, string> }
    expect(inst.params).toEqual({ tone: 'warm', size: '1.5' })
    expect(pennant.name).toBe('Pennant')
  })

  it('round-trips stably', () => {
    expect(printFlat(parseFlat(boat))).toBe(boat)
  })
})

describe('flatFormat — states/params reserved-word & range edge cases (review fixes)', () => {
  it('a state named `initial`/`transition` is disambiguated by the `at` lookahead', () => {
    const t = ['symbol "S" {', '  timeline 24 6', '  states s { initial at 0  transition at 3  done at 6  initial done }', '  layer "l" {', '    path "M0 0L1 0L1 1Z" fill #000000', '  }', '}', ''].join('\n')
    const sm = parseFlat(t)[0].states![0]
    expect(sm.states.map((a) => a.name)).toEqual(['initial', 'transition', 'done']) // names, not keywords
    expect(sm.initial).toBe('done')
    expect(printFlat(parseFlat(t))).toBe(t) // stable round-trip
  })

  it('a number param range round-trips (and a min-only range still serializes)', () => {
    const t = ['symbol "P" {', '  params {', '    number wave = 1 range 0 2', '  }', '  layer "l" {', '    path "M0 0L1 0L1 1Z" fill #000000', '  }', '}', ''].join('\n')
    expect(printFlat(parseFlat(t))).toBe(t)
  })
})

describe('flatFormat — stroke <param> (G) + free symbol section order (H)', () => {
  it('G: `stroke <param>` parses to strokeParam and round-trips', () => {
    const t = [
      'symbol "Wave" {',
      '  params {',
      '    color edge = #336699',
      '  }',
      '  layer "l" {',
      '    path "M0 0L20 0" nofill stroke edge 2',
      '  }',
      '}',
      '',
    ].join('\n')
    const reg = parseFlat(t)[0].layers[0].items[0] as { strokeParam?: string; stroke?: { width: number } }
    expect(reg.strokeParam).toBe('edge')
    expect(reg.stroke?.width).toBe(2)
    expect(printFlat(parseFlat(t))).toBe(t) // stable round-trip
  })

  it('H: `params`/`states` before `timeline` parses (order-independent); printer emits a canonical order', () => {
    const scrambled = [
      'symbol "S" {',
      '  params { number wave = 1 }',
      '  timeline 24 8',
      '  states door { closed at 0  open at 8 }',
      '  layer "l" {',
      '    path "M0 0L1 0L1 1Z" fill #000000',
      '  }',
      '}',
      '',
    ].join('\n')
    const sym = parseFlat(scrambled)[0] // no throw despite params-before-timeline
    expect(sym.timeline?.durationFrames).toBe(8)
    expect(sym.params?.[0].name).toBe('wave')
    expect(sym.states?.[0].param).toBe('door')
    // canonical order = timeline → params → states; re-parsing the printed form is stable
    const printed = printFlat([sym])
    expect(printed.indexOf('timeline')).toBeLessThan(printed.indexOf('params {'))
    expect(printFlat(parseFlat(printed))).toBe(printed)
  })
})

describe('flatFormat — clip on a container (D)', () => {
  it('parses `clip x y w h` on a group and round-trips', () => {
    const t = [
      'symbol "Cut" {',
      '  layer "l" {',
      '    group "G" at 50,50 clip -40 -40 80 40 {',
      '      layer "c" {',
      '        path "M-30 -30L30 -30L30 30L-30 30Z" fill #4488cc',
      '      }',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n')
    const g = parseFlat(t)[0].layers[0].items[0] as { clip?: { x: number; y: number; w: number; h: number } }
    expect(g.clip).toEqual({ x: -40, y: -40, w: 80, h: 40 })
    expect(printFlat(parseFlat(t))).toBe(t)
  })
})

describe('flatFormat — `cel … hold {}` carries the previous cel\'s poses (compile-time sugar)', () => {
  const src = [
    'symbol "Pond" {',
    '  timeline 24 60',
    '  layer "l" {',
    '    group "Base" at 0,0 { layer "a" { path "M0 0L10 0L10 10Z" fill #3a6ea5 } }',
    '    group "Ring" at 0,0 pivot 0,0 { layer "a" { path "M0 0L5 0L5 5Z" fill #ffffff } }',
    '    cel 0 tween { pose "Base" at 0,0  pose "Ring" scale 1 }',
    '    cel 30 hold tween { pose "Ring" scale 4 }',
    '    cel 60 hold { pose "Ring" scale 1 }',
    '  }',
    '}',
    '',
  ].join('\n')

  it('carries unmentioned containers forward (chained), and strips the hold flag', () => {
    const sym = parseFlat(src)[0]
    const nameOf = (id: string) => (sym.layers[0].items.find((it) => it.id === id) as { name: string }).name
    const names = (i: number) => sym.layers[0].cels![i].poses.map((p) => nameOf(p.id)).sort()
    expect(names(0)).toEqual(['Base', 'Ring'])
    expect(names(1)).toEqual(['Base', 'Ring']) // Base carried into the hold cel
    expect(names(2)).toEqual(['Base', 'Ring']) // chained: carried from cel 30 (which already had it)
    expect((sym.layers[0].cels![1] as { hold?: boolean }).hold).toBeUndefined() // transient flag stripped
  })

  it('expands to full cels: printed output has no `hold`, and re-parses identically (idempotent)', () => {
    const printed = printFlat(parseFlat(src))
    expect(printed).not.toMatch(/\bhold\b/)
    expect(printFlat(parseFlat(printed))).toBe(printed) // stable once expanded
  })

  it('a carried pose drops spin/turns (it is a HOLD, not a re-stated motion)', () => {
    const t = [
      'symbol "S" {',
      '  timeline 24 20',
      '  layer "l" {',
      '    group "W" pivot 0,0 { layer "a" { path "M0 0L5 0L5 5Z" fill #000000 } }',
      '    group "X" pivot 0,0 { layer "a" { path "M0 0L5 0L5 5Z" fill #111111 } }',
      '    cel 0 tween { pose "W" spin cw turns 1  pose "X" rotate 0 }',
      '    cel 20 hold { pose "X" rotate 90 }',
      '  }',
      '}',
      '',
    ].join('\n')
    const sym = parseFlat(t)[0]
    const wId = sym.layers[0].items.find((it) => (it as { name?: string }).name === 'W')!.id
    const carried = sym.layers[0].cels![1].poses.find((p) => p.id === wId)!
    expect(carried.spin).toBeUndefined()
    expect(carried.turns).toBeUndefined()
  })
})

describe('flatFormat — text on a path (`along`)', () => {
  const scene = (body: string) => ['size 480 200', 'scene {', '  layer "c" {', body, '  }', '}', ''].join('\n')

  // Round-trip is checked print-first (the printer canonicalizes path data / whitespace).
  const roundTrips = (src: string) => {
    const printed = printProgramFull(parseProgramFull(src))
    expect(printProgramFull(parseProgramFull(printed))).toBe(printed)
    return printed
  }

  it('a shape can be named with `as` and round-trips', () => {
    const reg = parseProgramFull(scene('    circle 100 100 40 as "Banner" fill #3366ff')).layers[0].items[0] as Region
    expect(reg.name).toBe('Banner')
    expect(roundTrips(scene('    circle 100 100 40 as "Banner" fill #3366ff'))).toContain(' as "Banner"')
  })

  it('`text … along "<id>" start <f>` parses, bakes the outline + round-trips', () => {
    const src = scene([
      '    circle 240 100 80 as "Ring" fill #222222',
      '    text "SURF CLUB" along "Ring" start 0.25 font "sans-serif" size 24 align center line 1.2 color #ffffff',
    ].join('\n'))
    const txt = parseProgramFull(src).layers[0].items[1] as Text
    expect(txt.kind).toBe('text')
    expect(txt.textPath?.ref).toBe('Ring')
    expect(txt.textPath?.start).toBe(0.25)
    expect(txt.textPath?.path.subpaths[0]?.closed).toBe(true) // closed circle baked + top-anchored
    const printed = roundTrips(src)
    expect(printed).toContain('along "Ring" start 0.25')
    expect(printed).not.toContain(' box ') // box/wrap omitted for a path-laid run
  })

  it('default `start` (0) is not printed', () => {
    const printed = roundTrips(scene([
      '    path "M0 80 C 120 0 360 0 480 80" as "Wave" nofill stroke #000000 2',
      '    text "hi" along "Wave" font "sans-serif" size 24 align left line 1.2 color #ffffff',
    ].join('\n')))
    expect(printed).toContain('along "Wave"')
    expect(printed).not.toContain('start 0')
  })

  it('`along` referencing an unknown shape → error', () => {
    const src = scene('    text "x" along "Nope" font "sans-serif" size 24 align left line 1.2 color #ffffff')
    expect(() => parseProgramFull(src)).toThrow(/along: shape not found: Nope/)
  })

  // ── Phase 2: inline `along path`, side, spacing ──
  it('inline `along path "<d>"` parses (no ref) + round-trips', () => {
    const src = scene('    text "hi" along path "M0 0L300 0" font "sans-serif" size 24 align left line 1.2 color #ffffff')
    const txt = parseProgramFull(src).layers[0].items[0] as Text
    expect(txt.textPath?.ref).toBeUndefined()
    expect(txt.textPath?.path.subpaths[0]?.segments[0]?.anchor).toMatchObject({ x: 0, y: 0 })
    expect(roundTrips(src)).toContain('along path "')
  })

  it('inline closed path is baked LITERALLY (not top-anchored)', () => {
    const src = scene('    text "x" along path "M0 0L100 0L100 100Z" font "sans-serif" size 12 align left line 1.2 color #fff')
    const tpath = (parseProgramFull(src).layers[0].items[0] as Text).textPath!.path
    expect(tpath.subpaths[0]?.closed).toBe(true)
    expect(tpath.subpaths[0]?.segments[0]?.anchor).toMatchObject({ x: 0, y: 0 }) // M start kept, NOT re-anchored to the top
  })

  it('`side under` + `spacing` round-trip; `side over`/`spacing 0` are implicit', () => {
    const src = scene([
      '    circle 240 100 80 as "Ring" fill #222222',
      '    text "DIAL" along "Ring" side under spacing 3 font "sans-serif" size 20 align center line 1.2 color #ffffff',
    ].join('\n'))
    const txt = parseProgramFull(src).layers[0].items[1] as Text
    expect(txt.textPath?.side).toBe('under')
    expect(txt.textPath?.spacing).toBe(3)
    expect(roundTrips(src)).toContain('side under spacing 3')

    const src2 = scene('    text "x" along path "M0 0L99 0" side over spacing 0 font "sans-serif" size 12 align left line 1.2 color #fff')
    const t2 = parseProgramFull(src2).layers[0].items[0] as Text
    expect(t2.textPath?.side).toBeUndefined() // `over` = default → not stored
    expect(t2.textPath?.spacing).toBeUndefined() // `0` = default → not stored
    expect(roundTrips(src2)).not.toContain('side')
  })

  it('negative `spacing` (tightening) round-trips', () => {
    const src = scene('    text "TIGHT" along path "M0 0L300 0" spacing -2 font "sans-serif" size 20 align left line 1.2 color #fff')
    expect((parseProgramFull(src).layers[0].items[0] as Text).textPath?.spacing).toBe(-2)
    expect(roundTrips(src)).toContain('spacing -2')
  })

  it('`side` with a bad value → error', () => {
    const src = scene('    text "x" along path "M0 0L99 0" side sideways font "sans-serif" size 12 align left line 1.2 color #fff')
    expect(() => parseProgramFull(src)).toThrow(/"side" expects over\|under/)
  })

  // ── Phase 3: animated channels (`start "<expr>"` marquee, `spacing "<expr>"` eased tracking) ──
  it('quoted `start`/`spacing` are stored as expressions (not literals) + round-trip', () => {
    const src = scene([
      '    circle 240 100 80 as "Ring" fill #222222',
      '    text "LOOP" along "Ring" start "time * 0.1" spacing "sin(time) * 4" font "sans-serif" size 20 align center line 1.2 color #ffffff',
    ].join('\n'))
    const txt = parseProgramFull(src).layers[0].items[1] as Text
    expect(txt.textPath?.startExpr).toBe('time * 0.1')
    expect(txt.textPath?.spacingExpr).toBe('sin(time) * 4')
    expect(txt.textPath?.start).toBeUndefined() // expression form → no literal start
    expect(txt.textPath?.spacing).toBeUndefined()
    const printed = roundTrips(src)
    expect(printed).toContain('start "time * 0.1"')
    expect(printed).toContain('spacing "sin(time) * 4"')
  })

  it('literal and expression forms of `start` are distinguishable (number vs quoted)', () => {
    const lit = parseProgramFull(scene('    text "x" along path "M0 0L99 0" start 0.4 font "s" size 12 align left line 1.2 color #fff')).layers[0].items[0] as Text
    expect(lit.textPath?.start).toBe(0.4)
    expect(lit.textPath?.startExpr).toBeUndefined()
  })
})

describe('flatFormat — instance playback mode (loop / once / synced)', () => {
  const parse = (attr: string): Instance => {
    const src = `symbol "Clip" { timeline 24 24  layer "c" { circle 0 0 4 fill #000000 } }\n` +
      `symbol "P" { timeline 24 24  layer "c" { instance "Clip" as "s"${attr} } }`
    return parseFlatLib(src).symbols.find((s) => s.name === 'P')!.layers[0].items[0] as Instance
  }

  it('`loop` parses to independent, `once` to once, bare/`synced` to no playback (default)', () => {
    expect(parse(' loop').playback).toEqual({ mode: 'independent' })
    expect(parse(' once').playback).toEqual({ mode: 'once' })
    expect(parse('').playback).toBeUndefined()
    expect(parse(' synced').playback).toBeUndefined() // explicit default is a no-op
  })

  it('the keyword survives alongside other pose attrs, any order', () => {
    expect(parse(' at 10,0 opacity 0.5 loop').playback).toEqual({ mode: 'independent' })
  })

  it('prints ` loop` / ` once` and round-trips idempotently', () => {
    const src = `symbol "Clip" {\n  timeline 24 24\n  layer "c" {\n    circle 0 0 4 fill #000000\n  }\n}\n\n` +
      `symbol "P" {\n  timeline 24 24\n  layer "c" {\n    instance "Clip" as "a" loop\n    instance "Clip" as "b" once\n    instance "Clip" as "c"\n  }\n}\n`
    const printed = printFlat(parseFlatLib(src).symbols)
    expect(printed).toContain('instance "Clip" as "a" loop')
    expect(printed).toContain('instance "Clip" as "b" once')
    expect(printed).toContain('instance "Clip" as "c"\n')
    expect(printFlat(parseFlatLib(printed).symbols)).toBe(printed) // idempotent
  })
})

describe('flatFormat — param colors in gradient stops + tint', () => {
  const halo = (fill: string, tint = '') => `symbol "Halo" {\n  params {\n    color teinte = #ffe9a8\n  }\n  layer "c" {\n    group "g"${tint} {\n      layer "c" {\n        circle 0 0 60 ${fill}\n      }\n    }\n  }\n}`
  const firstRegion = (src: string): Region => {
    const g = parseFlatLib(src).symbols[0].layers[0].items[0] as Group
    return g.layers[0].items[0] as Region
  }

  it('parses `offset:param@alpha` stops into { param, alpha } with the param default as fallback hex', () => {
    const r = firstRegion(halo('fill radial(0.5, 0.5, 0.5, 0:teinte@0.8, 1:teinte@0)'))
    expect(r.paint?.type).toBe('radial')
    expect(r.paint?.type === 'radial' && r.paint.stops).toEqual([
      { offset: 0, color: '#ffe9a8', param: 'teinte', alpha: 0.8 },
      { offset: 1, color: '#ffe9a8', param: 'teinte', alpha: 0 },
    ])
  })

  it('a param stop without alpha, and mixed with literal stops, parse correctly', () => {
    const r = firstRegion(halo('fill linear(90, 0:teinte, 0.5:#3366ffcc, 1:#000000)'))
    expect(r.paint?.type === 'linear' && r.paint.stops).toEqual([
      { offset: 0, color: '#ffe9a8', param: 'teinte' },
      { offset: 0.5, color: '#3366ffcc' },
      { offset: 1, color: '#000000' },
    ])
  })

  it('`tint <param> <amount>` binds the tint hue to a param', () => {
    const g = parseFlatLib(halo('fill #ffe9a8', ' tint teinte 0.6')).symbols[0].layers[0].items[0] as Group
    expect(g.tint).toEqual({ color: '#ffe9a8', param: 'teinte', amount: 0.6 })
  })

  it('round-trips param stops + tint idempotently (param@alpha printed, literal hex untouched)', () => {
    const src = halo('fill radial(0.5, 0.5, 0.5, 0:teinte@0.8, 0.5:#3366ffcc, 1:teinte@0)', ' tint teinte 0.5')
    const printed = printFlat(parseFlatLib(src).symbols)
    expect(printed).toContain('radial(0.5, 0.5, 0.5, 0:teinte@0.8, 0.5:#3366ffcc, 1:teinte@0)')
    expect(printed).toContain('tint teinte 0.5')
    expect(printFlat(parseFlatLib(printed).symbols)).toBe(printed)
  })

  it('a literal hex gradient is unchanged (non-regression)', () => {
    const r = firstRegion(halo('fill radial(0.5, 0.5, 0.5, 0:#ffe9a8, 1:#000000)'))
    expect(r.paint?.type === 'radial' && r.paint.stops).toEqual([
      { offset: 0, color: '#ffe9a8' },
      { offset: 1, color: '#000000' },
    ])
  })
})

// `object "X" { when loaded { … } }` compiles clean and does NOTHING: `unitsToObject` keeps only the
// per-item events, and drops `load`, `enterFrame`, `at frame` and `each` on the floor. Found while
// writing a hidden-state mini-game — drawing the hidden value once at start is the one thing every
// "guess the rule" game needs, and it was silently a no-op. The parser makes it worse: its
// unknown-event message LISTS `loaded` as valid inside an object block.
describe('scene-only constructs inside an object block', () => {
  const scene = 'size 100 100\nscene { layer "a" { group "Box" at 50,50 pivot 0,0 { layer "c" { rect -5 -5 10 10 fill #fff } } } }\n'

  it('flags `when loaded` and names the fix', () => {
    const d = sceneOnlyUnitDiagnostics(scene + 'object "Box" {\n  when loaded { x = 1 }\n}\n')
    expect(d).toHaveLength(1)
    expect(d[0].diag.severity).toBe('error')
    expect(d[0].diag.message).toMatch(/when loaded/)
    expect(d[0].diag.message).toMatch(/top level|outside/i)
    expect(d[0].scope).toBe('object "Box"')
  })

  it('flags `every frame`, `at frame` and `each` too', () => {
    const d = sceneOnlyUnitDiagnostics(scene + 'object "Box" {\n  every frame { x = 1 }\n  at frame 3 { x = 2 }\n}\n')
    expect(d.map((e) => e.diag.message).join(' ')).toMatch(/every frame/)
    expect(d.map((e) => e.diag.message).join(' ')).toMatch(/at frame/)
    expect(d).toHaveLength(2)
  })

  it('says nothing about the same constructs at the top level, where they run', () => {
    expect(sceneOnlyUnitDiagnostics(scene + 'when loaded { }\nevery frame { }\nobject "Box" {\n  x = 1\n}\n')).toEqual([])
  })

  it('points at the offending line, not the block', () => {
    const d = sceneOnlyUnitDiagnostics(scene + 'object "Box" {\n  x = 1\n  when loaded { x = 2 }\n}\n')
    expect(d[0].diag.line).toBe(5) // `when loaded`, not the `object` line
  })
})

// The mirror of the trap above, and worse: a `when clicked`, a channel binding or an interactor written
// at the PROGRAM level (outside any `object`) is dropped just as silently -- `unitsToTimeline` keeps only
// the scene-wide kinds. `--check` passed with nothing but a misleading "never used" warning about the
// variable the dropped handler wrote.
describe('per-item constructs at the program level', () => {
  const scene = 'size 100 100\nscene { layer "a" { group "Box" at 50,50 pivot 0,0 { layer "c" { rect -5 -5 10 10 fill #fff } } } }\n'

  it('flags a top-level `when clicked` and names the fix', () => {
    const d = itemOnlyUnitDiagnostics(scene + 'when clicked {\n  x = 1\n}\n')
    expect(d).toHaveLength(1)
    expect(d[0].diag.severity).toBe('error')
    expect(d[0].diag.message).toMatch(/when clicked/)
    expect(d[0].diag.message).toMatch(/object "/)
    expect(d[0].diag.line).toBe(3)
  })

  it('flags a top-level channel binding and an interactor', () => {
    const msgs = itemOnlyUnitDiagnostics(scene + 'opacity = 0.5\ndrag a, b\n').map((e) => e.diag.message).join(' ')
    expect(msgs).toMatch(/opacity/)
    expect(msgs).toMatch(/drag/)
  })

  it('says nothing about the scene-wide kinds, which run there', () => {
    expect(itemOnlyUnitDiagnostics(scene + 'use "collision"\nlet c = 0\nfn twice(a) = a * 2\nwhen loaded { c = twice(3) }\nevery frame { c = c }\n')).toEqual([])
  })

  it('says nothing about the same constructs inside an object block', () => {
    expect(itemOnlyUnitDiagnostics(scene + 'object "Box" {\n  when clicked { }\n  opacity = 0.5\n  drag a, b\n}\n')).toEqual([])
  })
})

// `at 12 -16` -- a space where the comma goes. The generic `"," expected, "-16" found` is accurate but
// says nothing about `at`, and a model that has seen SVG writes space-separated coordinates by reflex.
describe('`at x,y` takes a comma', () => {
  const parse = (src: string) => { try { parseProgram(src); return '' } catch (e) { return (e as Error).message } }

  it('names the rule and shows both spellings', () => {
    const m = parse('size 200 200\nscene { layer "a" { group "G" at 12 -16 pivot 0,0 { layer "c" { rect 0 0 4 4 fill #ffffff } } } }\n')
    expect(m).toMatch(/at <x>,<y>|at x,y/)
    expect(m).toMatch(/12,-16/)
  })

  it('the correct spelling still parses', () => {
    expect(parse('size 200 200\nscene { layer "a" { group "G" at 12,-16 pivot 0,0 { layer "c" { rect 0 0 4 4 fill #ffffff } } } }\n')).toBe('')
  })
})

describe('flatFormat — continuous `trace` slots (step / both ends / point)', () => {
  const src = [
    'size 600 200', 'scene {', '  layer "c" {',
    '    group "Path" at 0,0 { layer "c" { path "M60 100L540 100" nofill stroke #cccccc 18 } }',
    '  }', '}', '',
    'object "Path" {', '  trace progress along Path {', '    tolerance 30', '    step 40', '    both ends',
    '    point tipX, tipY', '  }', '}', '',
  ].join('\n')

  it('parses every slot, and round-trips in the canonical order', () => {
    const it0 = parseProgramFull(src).interactors!.find((i) => i.axis === 'trace')!
    expect(it0).toMatchObject({ axis: 'trace', varX: 'progress', confine: 'Path', grid: 30, step: 40, bothEnds: true, pointX: 'tipX', pointY: 'tipY' })
    const once = printProgramFull(parseProgramFull(src))
    expect(once).toContain('trace progress along Path {\n    tolerance 30\n    step 40\n    both ends\n    point tipX, tipY\n  }')
    expect(printProgramFull(parseProgramFull(once))).toBe(once) // print∘parse idempotent
  })

  it('a plain `trace` keeps none of them (the historical cursor is untouched)', () => {
    const plain = src.replace('    step 40\n', '').replace('    both ends\n', '').replace('    point tipX, tipY\n', '')
    const it0 = parseProgramFull(plain).interactors!.find((i) => i.axis === 'trace')!
    expect(it0.step).toBeUndefined()
    expect(it0.bothEnds).toBeUndefined()
    expect(it0.pointX).toBeUndefined()
  })

  it('`both` alone and a one-variable `point` are refused, with the shape spelled out', () => {
    const errs = (bad: string) => behaviorDiagnostics(src.replace('    both ends', bad)).map((d) => d.diag.message).join(' ')
    expect(errs('    both')).toMatch(/both ends/)
    expect(errs('    point tipX')).toMatch(/point <x>, <y>/)
  })
})

// Whitespace between a keyword and its literal is not significant: the scene grammar is tokenized, so it
// never saw the space in the first place. `object` was the one exception — its block splitter is a regex
// over the source and demanded one — which made `object"R"` the only spelling in the language that failed
// while `send"win"` sailed through. That asymmetry is invisible until something reads DSL BY PATTERN: a
// consumer's guard against `send\s+"…"` let `send"…"` past, one character from the rule it enforced.
describe('flatFormat — a keyword and its literal need no space (uniformly)', () => {
  const prog = (obj: string) => [
    'size 100 100', 'scene {', '  layer "L" {',
    '    group "R" at 50,50 { layer "c" { circle 0 0 10 fill #333333 } }',
    '  }', '}', '', obj, '',
  ].join('\n')
  const sends = (src: string) => {
    const doc = parseProgramFull(src)
    const acts = (doc.interactions ?? []).flatMap((i) => i.actions)
    return acts.filter((a): a is Extract<typeof a, { do: 'send' }> => a.do === 'send').map((a) => a.event)
  }

  it('`object"R"` binds exactly like `object "R"` (it used to be the only spelling that failed)', () => {
    expect(sends(prog('object"R" { when clicked { send "win" } }'))).toEqual(['win'])
    expect(sends(prog('object "R" { when clicked { send "win" } }'))).toEqual(['win'])
    expect(behaviorDiagnostics(prog('object"R" { when clicked { send "win" } }'))).toEqual([])
  })

  it('…and so does `send"win"`, tabs and multiple spaces included', () => {
    for (const gap of ['', ' ', '  ', '\t']) expect(sends(prog(`object "R" { when clicked { send${gap}"win" } }`))).toEqual(['win'])
  })

  it('every spelling round-trips to the SAME canonical text (one space)', () => {
    const once = printProgramFull(parseProgramFull(prog('object"R" { when clicked { send"win" } }')))
    expect(once).toContain('object "R"')
    expect(once).toContain('send "win"')
    expect(printProgramFull(parseProgramFull(once))).toBe(once)
  })

  it('the scene keywords never needed one either — the tokenizer does not see it', () => {
    const src = 'size 100 100\nscene {\n  layer"L" {\n    text"Hi" at 5,5 font"sans-serif" size 12 align left line 1.2 color #111111 box 40 20\n  }\n}\n'
    expect(parseProgramFull(src).layers[0].items).toHaveLength(1)
  })
})

// A `let` at the top level of a PROGRAM is the header's `var` under another name. It used to parse, lint
// clean and evaporate: the scene scope knew the name, the value never reached `doc.variables`, and a
// binding in an `object` block — another scope — reported `unknown variable` while pointing elsewhere.
describe('flatFormat — `let` at the top level of a program declares a document variable', () => {
  const prog = (decl: string, body = '') => [
    'size 100 100', decl, '', 'scene {', '  layer "L" {',
    '    group "C" at 50,50 { layer "c" { circle 0 0 10 fill #333333 } }',
    '  }', '}', '', body,
  ].join('\n')

  it('reaches `doc.variables`, with its value', () => {
    expect(parseProgramFull(prog('let n = 5')).variables).toEqual({ n: 5 })
    expect(parseProgramFull(prog('var n = 5')).variables).toEqual({ n: 5 })
  })

  it('so a binding in an `object` block can read it (the reported case)', () => {
    const src = prog('let n = 0', 'object "C" {\n  opacity = clamp(n, 0, 1)\n}')
    expect(behaviorDiagnostics(src)).toEqual([])
    // …and the name is in the document's table, which is what every scope's lint context is built from.
    expect(Object.keys(parseProgramFull(src).variables ?? {})).toEqual(['n'])
  })

  it('arrays and `fill(n, v)` come through as well', () => {
    expect(parseProgramFull(prog('let seen = fill(3, 0)')).variables).toEqual({ seen: [0, 0, 0] })
    expect(parseProgramFull(prog('let slots = [1, 2]')).variables).toEqual({ slots: [1, 2] })
  })

  it('the header wins a name declared twice — a host seeds `var`, and a stray `let` must not override it', () => {
    expect(parseProgramFull(prog('var n = 1\nlet n = 2')).variables).toEqual({ n: 1 })
  })

  it('printing emits ONE canonical spelling (`var`), so a round-trip is stable', () => {
    const once = printProgramFull(parseProgramFull(prog('let n = 5')))
    expect(once).toContain('var n = 5')
    expect(once).not.toContain('let n = 5')
    expect(printProgramFull(parseProgramFull(once))).toBe(once)
  })
})

// flatink/flatink#40 — `var z = 10 / 3` kept the first number and dropped the rest of the line in silence.
describe('program header — a `var` initialised with a constant expression', () => {
  it('is evaluated, like a `def`', () => {
    const v = parseProgram(prog0('var z = 10 / 4\nvar d = 2 * 5\nvar t = PI * 2\nvar m = -3 + 1\nvar p = (1 + 2) * 3')).variables
    expect(v).toEqual({ z: 2.5, d: 10, t: Math.PI * 2, m: -2, p: 9 })
  })
  it('plain numbers, arrays, `fill` and a trailing comment keep working', () => {
    const v = parseProgram(prog0('var a = -3.5 // start\nvar k = 2.7e-06\nvar s = [1, 2]\nvar f = fill(2, 7)')).variables
    expect(v).toEqual({ a: -3.5, k: 2.7e-06, s: [1, 2], f: [7, 7] })
  })
  it('an initialiser that is not a constant is refused, with the rule', () => {
    expect(() => parseProgram(prog0('var a = 1\nvar b = a + 1'))).toThrow(/constant/)
  })
})

// flatink/flatink#65 — an array literal read each TOKEN as a number: `[PI / 2, 1]` gave `[NaN, 2, 1]` and
// `[rad(30), deg(1)]` eight cells, in silence. Each cell is a constant expression, like a scalar `var`.
describe('program header — an array literal of constant expressions', () => {
  it('evaluates each cell', () => {
    const v = parseProgram(prog0('var t = [PI / 2, 1]\nvar u = [rad(30), deg(1)]\nvar n = [-1, 2.5e-1, (1 + 2) * 3]\nvar e = []')).variables
    expect(v).toEqual({ t: [Math.PI / 2, 1], u: [Math.PI / 6, 180 / Math.PI], n: [-1, 0.25, 9], e: [] })
  })
  it('a trailing comma is allowed, as it was (review pass)', () => {
    expect(parseProgram(prog0('var t = [1, 2, 3,]\nvar u = [\n  1,\n  2,\n]')).variables).toEqual({ t: [1, 2, 3], u: [1, 2] })
    expect(() => parseProgram(prog0('var t = [1, , 2]'))).toThrow(/constant/)
  })
  it('can span several lines and end on a comment', () => {
    expect(parseProgram(prog0('var t = [1,\n  2, // two\n  3]')).variables).toEqual({ t: [1, 2, 3] })
  })
  it('`fill(n, v)` takes constant expressions too', () => {
    expect(parseProgram(prog0('var f = fill(2, PI / 2)')).variables).toEqual({ f: [Math.PI / 2, Math.PI / 2] })
  })
  it('a cell that is not a constant is refused, with the rule', () => {
    expect(() => parseProgram(prog0('var a = 1\nvar t = [a, 1]'))).toThrow(/constant/)
    expect(() => parseProgram(prog0('var t = [1 2]'))).toThrow(/constant/)
  })
})

// flatink/flatink#7 — `size` written after another header line was skipped as an unknown token: the scene
// silently fell back to 800x600.
describe('program header — `size` is accepted anywhere before the scene', () => {
  it('after an `asset` line', () => {
    const p = parseProgram(['asset "fond" "fond.png" image', 'size 960 540', 'scene {', '  layer "L" {', '    path "M0 0L10 0L10 10Z" fill #000000', '  }', '}', ''].join('\n'))
    expect([p.width, p.height]).toEqual([960, 540])
  })
  it('a variable that happens to be called `size` is not mistaken for it', () => {
    const p = parseProgram(prog0('var size = 3'))
    expect([p.width, p.height, p.variables]).toEqual([100, 100, { size: 3 }])
  })
})

// flatink/flatink#52 — `expr rotationDeg "a"` compiled, passed `--check`, and rotated nothing: the channel
// name was stored as written, and no renderer knows a `rotationDeg` channel.
describe('`.flat` — the channel of an inline `expr`', () => {
  const sym = (attr: string) => `symbol "A" {\n  layer "l" {\n    group "G" at 0,0 ${attr} {\n      layer "x" {\n        path "M0 0L10 0L10 10Z" fill #000000\n      }\n    }\n  }\n}\n`
  const group = (attr: string) => parseFlat(sym(attr))[0].layers[0].items[0] as Group
  it('`rotationDeg` is the degree twin of `rotation`, as in a behavior block', () => {
    expect(group('expr rotationDeg "a"').expressions).toEqual({ rotation: 'rad(a)' })
  })
  it('`rotate` is refused: on this line `rotate 45` is degrees, and the channel would have been radians', () => {
    expect(() => parseFlat(sym('expr rotate "45"'))).toThrow(/`rotate`.*degrees.*`rotation`.*`rotationDeg`/s)
  })
  it('an unknown channel is an error naming the valid ones', () => {
    expect(() => parseFlat(sym('expr rotationn "a"'))).toThrow(/unknown channel "rotationn".*rotation/)
  })
})

// flatink/flatink#9 — a symbol's params were color, number and bool: a reusable button could not carry
// its label, so every program laid a text over it by hand. `text` is the fourth type.
describe('`.flat` — a `text` param', () => {
  const lib = (body: string) => `symbol "Bouton" {\n  params {\n    text libelle = "OK" "label of the button"\n    color fond = #3366cc\n  }\n  layer "l" {\n    ${body}\n  }\n}\n`
  const label = 'text libelle at -40,-10 font "sans-serif" size 20 align center line 1.2 color #ffffff box 80 24'
  it('is declared with a quoted default, and an optional doc string after it', () => {
    expect(parseFlat(lib(label))[0].params![0]).toEqual({ name: 'libelle', type: 'text', default: 'OK', doc: 'label of the button' })
  })
  it('`text <param>` draws the param: the default is its content, the name is kept', () => {
    const t = parseFlat(lib(label))[0].layers[0].items[0] as Text
    expect([t.content, t.contentParam]).toEqual(['OK', 'libelle'])
  })
  it('a bare name that is not a `text` param of the symbol is an error naming the rule', () => {
    expect(() => parseFlat(lib(label.replace('libelle', 'fond')))).toThrow(/"fond" is not a text param/)
    expect(() => parseFlat(lib(label.replace('libelle', 'titre')))).toThrow(/"titre" is not a text param/)
  })
  it('round-trips, default with spaces and quotes included', () => {
    const src = lib(label).replace('"OK"', '"Tout \\"bon\\" ?"')
    const once = printFlat(parseFlat(src))
    expect(once).toContain('text libelle = "Tout \\"bon\\" ?" "label of the button"')
    expect(once).toContain('text libelle at -40,-10')
    expect(printFlat(parseFlat(once))).toBe(once)
  })
  it('an instance gives it a value, which survives a round-trip of the program', () => {
    const p = parseProgram(prog0('').replace('path "M0 0L10 0L10 10Z" fill #000000', 'instance "Bouton" as "B" at 10,10 { libelle = "Check my answer", fond = #33aa55 }'))
    const inst = p.layers[0].items[0] as Instance
    expect(inst.params).toEqual({ libelle: 'Check my answer', fond: '#33aa55' })
    expect((parseProgram(printProgram(p)).layers[0].items[0] as Instance).params).toEqual(inst.params)
  })
})

// flatink/flatink#25 — nothing could be drawn from what the program computes: a trajectory was hundreds
// of small groups shown one by one. `polyline` is a shape whose points are two array variables.
describe('`polyline <xs> <ys>` — a shape built from arrays at runtime', () => {
  const scene = (line: string) => `size 200 200\nvar tx = fill(4, 0)\nvar ty = fill(4, 0)\nvar n = 0\nscene {\n  layer "c" {\n    ${line}\n  }\n}\n`
  const shape = (line: string) => parseProgram(scene(line)).layers[0].items[0] as Region
  it('names its two arrays; the geometry is empty until it is resolved against the variables', () => {
    const r = shape('polyline tx ty nofill stroke #cc3333 2')
    expect(r.poly).toEqual({ xs: 'tx', ys: 'ty' })
    expect(r.path.subpaths).toEqual([])
    expect([r.noFill, r.stroke?.width]).toEqual([true, 2])
  })
  it('`count` (a number or an expression) and `closed`', () => {
    expect(shape('polyline tx ty count "n" nofill stroke #cc3333 2').poly).toEqual({ xs: 'tx', ys: 'ty', count: 'n' })
    expect(shape('polyline tx ty count 3 closed fill #cc3333').poly).toEqual({ xs: 'tx', ys: 'ty', count: '3', closed: true })
  })
  it('round-trips', () => {
    const once = printProgram(parseProgram(scene('polyline tx ty count "n" closed nofill stroke #cc3333 2 cap round')))
    expect(once).toContain('polyline tx ty count "n" closed nofill stroke #cc3333 2 cap round')
    expect(printProgram(parseProgram(once))).toBe(once)
  })
  it('two names are required', () => {
    expect(() => parseProgram(scene('polyline tx nofill stroke #cc3333 2'))).toThrow(/polyline.*two array/)
  })
})

describe('program — `focusable` in an `object` block (flatink/flatink#35)', () => {
  const src = (body: string, top = '') => `size 100 100\nscene {\n  layer "c" {\n    group "B" at 50,50 {\n      layer "a" {\n        circle 0 0 20 fill #3366cc\n      }\n    }\n  }\n}\n${top}object "B" {\n${body}\n}\n`
  it('lands on the item, and survives a round-trip', () => {
    const p = parseProgramFull(src('  focusable order 2\n  when clicked {\n    play\n  }'))
    expect((p.layers[0].items[0] as Group).focusable).toEqual({ order: 2 })
    const again = parseProgramFull(printProgramFull(p))
    expect((again.layers[0].items[0] as Group).focusable).toEqual({ order: 2 })
    expect(printProgramFull(p)).toContain('focusable order 2')
  })
  it('without it the item has no such field', () => {
    expect((parseProgramFull(src('  opacity = 1')).layers[0].items[0] as Group).focusable).toBeUndefined()
  })
  it('written at the program level, outside any object, it is an error', () => {
    expect(itemOnlyUnitDiagnostics(src('  opacity = 1', 'focusable\n')).map((d) => d.diag.message).join(' ')).toMatch(/focusable.*object/)
  })
})

describe('`path "…" smooth` — free-hand material says so (flatink/flatink#8)', () => {
  const TRAPEZOID = 'M20 100L60 40L160 40L200 100Z'
  const shape = (line: string) => parseProgram(prog0('').replace('path "M0 0L10 0L10 10Z" fill #000000', line)).layers[0].items[0] as Region
  const handles = (r: Region) => r.path.subpaths[0].segments.filter((s) => s.inHandle || s.outHandle).length
  it('without the word, the lines are lines; with it, the path is material', () => {
    expect(handles(shape(`path "${TRAPEZOID}" fill #000000`))).toBeGreaterThan(0)
    expect(handles(shape(`path "${TRAPEZOID}" smooth fill #000000`))).toBe(0)
  })
  it('both print back as written', () => {
    for (const line of [`path "${TRAPEZOID}" fill #000000`, `path "${TRAPEZOID}" smooth fill #000000`, `path "${TRAPEZOID}" smooth as "Blob" fill #000000`]) {
      const once = printProgram(parseProgram(prog0('').replace('path "M0 0L10 0L10 10Z" fill #000000', line)))
      expect(once).toContain(line)
      expect(printProgram(parseProgram(once))).toBe(once)
    }
  })
  it('material built by the editor (no handle anywhere, soft vertices) is exported WITH the word', () => {
    const blob: Region = { id: 'b', color: '#000000', path: { subpaths: [{ closed: true, segments: [[20, 100], [60, 40], [160, 40], [200, 100]].map(([x, y]) => ({ anchor: { x, y } })) }] } }
    const text = printFlat([{ id: 's', name: 'S', layers: [layer('l', 'c', [blob])] }])
    expect(text).toContain(`path "${TRAPEZOID}" smooth`)
    const back = parseFlat(text)[0].layers[0].items[0] as Region
    expect(handles(back)).toBe(0) // still material after the round-trip
  })
  it('a shape with sharp corners only is printed as before, without it', () => {
    expect(printProgram(parseProgram(prog0('')))).not.toContain('smooth')
    expect(printProgram(parseProgram(prog0('').replace('path "M0 0L10 0L10 10Z" fill #000000', 'rect 0 0 40 20 fill #000000')))).not.toContain('smooth')
  })
})

// A `var` initialiser that starts with a number used to stop at the number unless an ARITHMETIC operator
// followed: `var a = 3 == 3` gave 3, `var a = 2 > 1 ? 7 : 8` gave 2, `var a = 4 garbage` gave 4 — and
// `--check` passed all three.
describe('a `var` initialiser is read to the end of its line', () => {
  const v = (init: string) => parseProgram(`size 10 10\nvar a = ${init}\nscene { }\n`).variables?.a
  it('a comparison and a ternary are evaluated whole', () => {
    expect(v('3 == 3')).toBe(1)
    expect(v('2 > 1 ? 7 : 8')).toBe(7)
    expect(v('1 && 0')).toBe(0)
  })
  it('a number alone, with or without a comment, is still the fast path', () => {
    expect(v('42')).toBe(42)
    expect(v('-3.5 // the start')).toBe(-3.5)
  })
  it('several `var`s on one line, a common idiom, each get their value', () => {
    const vars = parseProgram('size 10 10\nvar a = 0  var b = 2 > 1 ? 7 : 8   var c = 105\nscene { }\n').variables
    expect(vars).toEqual({ a: 0, b: 7, c: 105 })
  })
  it('a number followed by something that is not an expression is an error', () => {
    expect(() => v('4 garbage')).toThrow(/constant expression/)
  })
})

// `printProgram` wrote a matrix with two decimals: `rotate 45` came back as `matrix(0.71,0.71,-0.71,0.71,…)`,
// 0.4% off — two pixels at 500 units from the pivot, more at every round trip through the editor.
describe('a matrix survives a print and a re-read', () => {
  it('`rotate 45` round-trips to within a millionth', () => {
    const src = 'size 400 400\nscene {\n  layer "c" {\n    group "G" at 200,200 pivot 20,0 rotate 45 scale 1.5 { layer "a" { rect -10 -10 20 20 fill #000000 } }\n  }\n}\n'
    const a = (parseProgram(src).layers[0].items[0] as Group).transform
    const b = (parseProgram(printProgram(parseProgram(src))).layers[0].items[0] as Group).transform
    for (const k of ['a', 'b', 'c', 'd'] as const) expect(Math.abs(a[k] - b[k])).toBeLessThan(1e-6)
    for (const k of ['e', 'f'] as const) expect(Math.abs(a[k] - b[k])).toBeLessThan(1e-3)
  })
})

// flatink/flatink#66 — header and attribute words that were taken on trust: each of these used to compile,
// pass `--check`, and lose content or crash later.
describe('`.flatink` / `.flat` — malformed input is refused where it is written', () => {
  const sceneWith = (item: string) => ['size 100 100', 'scene {', '  layer "L" {', `    ${item}`, '  }', '}', ''].join('\n')
  it('an `asset` with no kind does not swallow the `scene` that follows', () => {
    expect(() => parseProgram(prog0('asset "boom" "boom.mp3"'))).toThrow(/kind/)
    expect(parseProgram(prog0('asset "boom" "boom.mp3" sound')).assets?.[0]?.kind).toBe('sound')
  })
  it('a file-type word stands for its kind (written in real programs: `asset "a" "a.png" png`)', () => {
    const kinds = parseProgram(prog0('asset "a" "a.png" png\nasset "b" "b.mp3" mp3\nasset "c" "c.woff2" woff2\nasset "d" "d.jpg" jpeg')).assets?.map((a) => a.kind)
    expect(kinds).toEqual(['image', 'sound', 'font', 'image'])
  })
  it('a kind named like an Object.prototype member is refused like any unknown word', () => {
    expect(() => parseProgram(prog0('asset "a" "a.png" constructor'))).toThrow(/kind.*"constructor"/)
  })
  it('`timeline` takes two numbers — `timeline 24` lost the duration AND the scene', () => {
    expect(() => parseProgram(prog0('timeline 24'))).toThrow(/number/)
  })
  it('an unknown easing is refused (it crashed the engine at the first tween)', () => {
    const cel = (ease: string) => ['size 100 100', 'scene {', '  layer "L" {', `    cel 0 tween ease ${ease} {`, '      matter { path "M0 0L10 0L10 10Z" fill #000000 }', '    }', '  }', '}', ''].join('\n')
    expect(() => parseProgram(cel('bounce'))).toThrow(/bounce/)
    expect(() => parseProgram(cel('easeInOut'))).not.toThrow()
  })
  it('a `.flat` line that is not a symbol stops the parse instead of dropping every symbol after it', () => {
    const sym = (n: string) => `symbol "${n}" {\n  layer "l" {\n    path "M0 0L10 0L10 10Z" fill #000000\n  }\n}\n`
    expect(() => parseFlat(sym('A') + 'stray words\n' + sym('B'))).toThrow(/symbol/)
    expect(parseFlat(sym('A') + '// a comment\n' + sym('B')).map((s) => s.name)).toEqual(['A', 'B'])
  })
  it('an unknown filter is refused, not read as `adjust`', () => {
    expect(() => parseProgram(sceneWith('path "M0 0L10 0L10 10Z" fill #000000 filter sepia 0.5 1 1 1'))).toThrow(/sepia/)
  })
  it('`glow` is blur THEN colour — the reversed order is refused', () => {
    expect(() => parseProgram(sceneWith('path "M0 0L10 0L10 10Z" fill #000000 filter glow #ffffff 8'))).toThrow(/number/)
  })
  it('a list of numbers cut short by the end of the text says so (it used to leak an internal message)', () => {
    let msg = ''
    try { parseProgram('size 100 100\nscene {\n  layer "L" {\n    path "M0 0L10 0L10 10Z" fill #000000 filter adjust 1 1') } catch (e) { msg = (e as Error).message }
    expect(msg).not.toMatch(/Cannot read|undefined/)
    expect(msg).toMatch(/number|end/)
  })
})

// flatink/flatink#67 — the scene form of the modifiers: a spring with no `stiffness` (a smooth with no `k`)
// defaulted to 0 and never moved, in silence.
describe('`spring` / `smooth` on a scene item — the driving slot is required', () => {
  const g = (attr: string) => ['size 100 100', 'var t = 0', 'scene {', '  layer "L" {', `    group "G" at 0,0 ${attr} {`, '      layer "x" { path "M0 0L10 0L10 10Z" fill #000000 }', '    }', '  }', '}', ''].join('\n')
  it('refused without it', () => {
    expect(() => parseProgram(g('spring rotation "t" damping 0.3'))).toThrow(/stiffness/)
    expect(() => parseProgram(g('smooth opacity "t"'))).toThrow(/\bk\b/)
  })
  it('accepted with it', () => {
    expect(() => parseProgram(g('spring rotation "t" stiffness 0.1'))).not.toThrow()
    expect(() => parseProgram(g('smooth opacity "t" k 0.2'))).not.toThrow()
  })
})

// flatink/flatink#66 — words from a closed set were stored as written, and drew nothing (or the default).
describe('`.flatink` — a closed-set word is checked where it is written', () => {
  const sceneWith = (item: string, head = '') => ['size 100 100', head, 'scene {', '  layer "L" {', `    ${item}`, '  }', '}', ''].join('\n')
  const shape = (attrs: string) => sceneWith(`path "M0 0L10 0L10 10Z" fill #000000 ${attrs}`)
  it('blend, cap, join', () => {
    const grp = (attr: string) => sceneWith(`group "G" at 0,0 ${attr} { layer "x" { path "M0 0L10 0L10 10Z" fill #000000 } }`)
    expect(() => parseProgram(grp('blend sparkle'))).toThrow(/blend.*sparkle|sparkle.*blend/)
    expect(() => parseProgram(grp('blend multiply'))).not.toThrow()
    expect(() => parseProgram(shape('stroke #000000 2 cap pointy'))).toThrow(/pointy/)
    expect(() => parseProgram(shape('stroke #000000 2 join wavy'))).toThrow(/wavy/)
    expect(() => parseProgram(shape('stroke #000000 2 cap square join bevel'))).not.toThrow()
  })
  it('text `align`', () => {
    expect(() => parseProgram(sceneWith('text "Hi" at 10,10 align "middle"'))).toThrow(/middle/)
    expect(() => parseProgram(sceneWith('text "Hi" at 10,10 align "center"'))).not.toThrow()
  })
  it('pose `spin`', () => {
    const cel = (spin: string) => ['size 100 100', 'scene {', '  layer "L" {', '    group "G" at 0,0 { layer "x" { path "M0 0L10 0L10 10Z" fill #000000 } }', '  }', '  layer "A" {',
      '    cel 0 { pose "G" at 0,0 }', `    cel 10 tween { pose "G" at 0,0 ${spin} }`, '  }', '}', ''].join('\n')
    expect(() => parseProgram(cel('spin up'))).toThrow(/up/)
    expect(() => parseProgram(cel('spin cw'))).not.toThrow()
  })
  it('a colour has 3, 4, 6 or 8 hex digits', () => {
    expect(() => parseProgram(shape('stroke #12 2'))).toThrow(/#12/)
    expect(() => parseProgram(sceneWith('path "M0 0L10 0L10 10Z" fill #12345'))).toThrow(/#12345/)
    expect(() => parseProgram(sceneWith('path "M0 0L10 0L10 10Z" fill #abc'))).not.toThrow()
    expect(() => parseProgram(sceneWith('path "M0 0L10 0L10 10Z" fill #aabbcc80'))).not.toThrow()
  })
  it('`fixed` on a TEXT stroke says it is for shapes (review pass: it said "must come directly after stroke")', () => {
    expect(() => parseProgram(sceneWith('text "A" at 10,10 stroke #000000 2 fixed'))).toThrow(/fixed.*shape/)
  })
  it('`clip` on a text or an image is refused (it clipped nothing) — a group clips', () => {
    expect(() => parseProgram(sceneWith('text "Hi" at 10,10 clip 0 0 5 5'))).toThrow(/clip/)
    expect(() => parseProgram(sceneWith('image "a" 10 10 at 0,0 clip 0 0 5 5', 'asset "a" "a.png" image'))).toThrow(/clip/)
  })
  it('`background` is a solid colour', () => {
    expect(() => parseProgram(sceneWith('path "M0 0L10 0L10 10Z" fill #000000', 'background linear(90, 0:#000000, 1:#ffffff)'))).toThrow(/background/)
    expect(parseProgram(sceneWith('path "M0 0L10 0L10 10Z" fill #000000', 'background #102030')).background).toBe('#102030')
  })
})

// flatink/flatink#66 — two items with the name an `object` targets: it attached to the first one only, and
// the second never reacted. Two instances of a symbol without `as` share the symbol's name, same trap.
describe('objectTargetDiagnostics — an object name that matches two items', () => {
  const art = '{ layer "a" { circle 0 0 10 fill #cc3333 } }'
  const prog = (items: string[]) => ['size 200 200', 'var n = 0', 'scene {', '  layer "c" {', ...items.map((i) => `    ${i}`), '  }', '}', 'object "B" {', '  when clicked { n = n + 1 }', '}', ''].join('\n')
  it('is warned, with the count', () => {
    const ds = objectTargetDiagnostics(prog([`group "B" at 10,10 ${art}`, `group "B" at 50,50 ${art}`]))
    expect(ds.map((d) => `${d.diag.severity} ${d.diag.line}: ${d.diag.message}`)).toEqual([expect.stringMatching(/^warning 9: .*2 items are named "B".*first/)])
  })
  it('a single one says nothing', () => {
    expect(objectTargetDiagnostics(prog([`group "B" at 10,10 ${art}`, `group "C" at 50,50 ${art}`]))).toEqual([])
  })
  // Review pass: a text named with `as` answers to THAT name; it was counted under its content, so a group
  // "B" holding `text "B" as "lblB"` read as two items named "B" (9 false warnings on real files).
  it('a text named with `as` is counted under that name, not its content', () => {
    expect(objectTargetDiagnostics(prog([`group "B" at 10,10 { layer "a" { text "B" as "lblB" at 0,0 } }`]))).toEqual([])
  })
})

// Reported by flatink (demos written on 0.40): `flatc: compile error: "join" belongs to stroke …` came with
// no file, no line — eleven parser errors were plain `Error`s. Every one now says where.
describe('parser errors — every one carries its position', () => {
  const at = (src: string): { line: number; col: number; message: string } | null => {
    try { parseProgram(src) } catch (e) { const x = e as { line?: number; col?: number; message: string }; return typeof x.line === 'number' ? { line: x.line, col: x.col ?? 0, message: x.message } : null }
    return null
  }
  it('a stroke option out of place (the reported one)', () => {
    const e = at('size 300 200\nscene {\n  layer "c" {\n    circle 150 100 60 nofill stroke #e33 2 dash 6,8 draw 1 join round\n  }\n}\n')
    expect(e).toMatchObject({ line: 4, col: 60 }) // the `join` itself
    expect(e!.message).toMatch(/"join" belongs to `stroke`/)
  })
  it('the others too: `as` out of place, `fill none`, a cel with neither pose nor matter', () => {
    expect(at('size 300 200\nscene {\n  layer "c" {\n    rect 0 0 10 10 fill #ffffff as "R"\n  }\n}\n')).toMatchObject({ line: 4 })
    expect(at('size 300 200\nscene {\n  layer "c" {\n    rect 0 0 10 10 fill none\n  }\n}\n')).toMatchObject({ line: 4 })
    expect(at('size 300 200\nscene {\n  layer "c" {\n    cel 0 {\n      circle 0 0 5 fill #000000\n    }\n  }\n}\n')).toMatchObject({ line: 5 })
  })
})

// Reported by flatink: `def P = "M20 20 L280 180"` then `path "$(P)"` compiled to a path with NO subpath,
// drawn as nothing, and `--check` passed. The need is the obvious one — the same outline used four times
// (trace guide, ink, halo, dashes). A `def` whose value is a quoted text is inserted as written.
describe('`def` — a text value, inserted where `$(name)` is written', () => {
  const prog = (lines: string[]) => ['size 300 200', ...lines, ''].join('\n')
  const paths = (src: string) => (parseProgram(src).layers[0].items as Region[]).map((r) => r.path.subpaths.length)
  it('the same path data reused, inside a quoted string', () => {
    const src = prog(['def P = "M20 20 L280 180"', 'scene { layer "c" {', '  path "$(P)" nofill stroke #ee3333 4', '  path "$(P)" nofill stroke #333333 1 dash 4,4', '} }'])
    expect(paths(src)).toEqual([1, 1])
    expect((parseProgram(src).layers[0].items[0] as Region).path.subpaths[0].segments.map((s) => s.anchor)).toEqual([{ x: 20, y: 20 }, { x: 280, y: 180 }])
  })
  it('numeric defs keep working, and may sit next to a text one', () => {
    const src = prog(['def W = 40', 'def P = "M0 0 L10 0"', 'scene { layer "c" {', '  path "$(P)" nofill stroke #ee3333 $(W / 10)', '  rect 0 0 $(W) $(W * 2) fill #000000', '} }'])
    expect(paths(src)).toEqual([1, 1])
  })
  it('a text def works inside a `repeat`, and the line numbers below it do not move', () => {
    const src = prog(['def P = "M0 0 L10 10"', 'scene { layer "c" {', '  repeat i from 0 to 2 {', '    path "$(P)" nofill stroke #ee3333 1', '  }', '  rect 0 0 10 10 fill nope', '} }'])
    let line = 0
    try { parseProgram(src.replace('fill nope', 'fill none')) } catch (e) { line = (e as { line: number }).line }
    expect(line).toBe(7)
    expect(paths(src.replace('  rect 0 0 10 10 fill nope\n', ''))).toEqual([1, 1, 1])
  })
})

// …and when path data cannot be read at all, that is said: an empty path used to compile and draw nothing.
describe('`path` — data that yields no subpath is refused', () => {
  const one = (d: string) => () => parseProgram(`size 300 200\nscene { layer "c" { path "${d}" nofill stroke #ee3333 4 } }\n`)
  it('an unresolved `$(…)`, an empty string', () => {
    expect(one('$(Nope)')).toThrow(/path.*\$\(Nope\)/)
    expect(one('')).toThrow(/path/)
    expect(one('12 34')).toThrow(/path/)
    expect(one('M0 0 L10 10')).not.toThrow()
  })
  // Measured on real libraries: two `.flat` files hold a curve short of a number. They compiled and drew;
  // refusing them would break every program beside them. Partly readable data is a `--check` warning.
  it('data that is only partly readable still compiles', () => {
    expect(one('M-5,2 L-4,2 C-5,-59 -5,-54 L-5,2 Z')).not.toThrow()
  })
})

// Reported by flatink: `draw "easeInOut(…)"` drew the whole stroke at once. A package is imported because
// the program CALLS one of its functions — but the call was looked for in the program text with its strings
// removed, and a scene expression (`draw`, `bind`, `expr x`, a spring target) IS a string.
describe('auto-import — a package function called from a scene expression', () => {
  const imports = (item: string) => parseProgramFull(['size 300 200', 'var v = 0', 'scene { layer "c" {', `  ${item}`, '} }', ''].join('\n')).imports ?? []
  it('in `draw`, `bind`, an `expr` attribute, a modifier target', () => {
    expect(imports('path "M20 100 L280 100" nofill stroke #ee3333 6 draw "easeInOut(clamp(frame / 48, 0, 1))"')).toContain('easing')
    expect(imports('text "{}" at 0,0 bind "snap(v, 5)"')).toContain('gesture')
    expect(imports('group "G" at 0,0 expr x "easeOut(v) * 100" { layer "a" { circle 0 0 5 fill #000000 } }')).toContain('easing')
    expect(imports('group "G" at 0,0 smooth x "easeIn(v) * 100" k 0.2 { layer "a" { circle 0 0 5 fill #000000 } }')).toContain('easing')
  })
  it('a quoted text that only LOOKS like a call imports nothing', () => {
    expect(imports('text "easeInOut(x) is a curve" at 0,0')).toEqual([])
  })
})

describe('cel hold — a carried container keeps its place in the stack (flatink/flatink demos, 0.45)', () => {
  it('a `hold` cel moving the front piece leaves the carried one behind it', () => {
    const src = `size 200 100
timeline 30 20
scene {
  layer "L" {
    group "Back" at 60,50 { layer "c" { rect -40 -40 80 80 fill #ff0000 } }
    group "Front" at 100,50 { layer "c" { rect -40 -40 80 80 fill #0000ff } }
    cel 0 { pose "Back" scale 1  pose "Front" scale 1 }
    cel 10 hold { pose "Front" scale 2 }
  }
}`
    const l = parseProgram(src).layers[0]
    const names = (f: number) => resolveLayerAt(l, f).map((i) => (i as { name?: string }).name)
    expect(names(2)).toEqual(['Back', 'Front'])
    expect(names(12)).toEqual(['Back', 'Front'])
  })
})

describe('text — `valign` places the lines in the height of the box (flatink/flatink demos, 0.45)', () => {
  const textOf = (opts: string) => parseProgram(`size 200 100\nscene {\n  layer "L" {\n    text "OK" at 10,10 font "sans-serif" size 22 align center box 120 60 ${opts}\n  }\n}`).layers[0].items[0] as Text
  it('`valign middle` and `valign bottom` are kept on the text', () => {
    expect(textOf('valign middle').valign).toBe('middle')
    expect(textOf('valign bottom').valign).toBe('bottom')
  })
  it('`valign top` is the default: nothing is stored, an existing document is unchanged', () => {
    expect('valign' in textOf('valign top')).toBe(false)
    expect('valign' in textOf('')).toBe(false)
  })
  it('any other word is an error that names the three', () => {
    expect(() => textOf('valign center')).toThrow(/valign.*top.*middle.*bottom/s)
  })
  it('is written back by the printer, after the box it applies to', () => {
    const src = 'size 200 100\nscene {\n  layer "L" {\n    text "OK" at 10,10 font "sans-serif" size 22 align center line 1.2 color #000000 box 120 60 valign middle\n  }\n}'
    const printed = printProgram(parseProgram(src))
    expect(printed).toContain('box 120 60 valign middle')
    expect((parseProgram(printed).layers[0].items[0] as Text).valign).toBe('middle')
    expect(printProgram(parseProgram(src.replace(' valign middle', '')))).not.toContain('valign')
  })
})
