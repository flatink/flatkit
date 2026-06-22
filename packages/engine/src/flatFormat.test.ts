import { describe, it, expect } from 'vitest'
import { printFlat, parseFlat, parseFlatLib, pathToData, printProgram, parseProgram, printProgramFull, parseProgramFull, behaviorDiagnostics, type Program } from './flatFormat'
import { parsePathData, circlePath, ellipsePath, rectPath } from './svgPath'
import { folderPath } from './layers'
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
    expect((parseProgram(out).layers[0].items[0] as Text).id).toBe(id) // id preserved → text("…") resolves on the Moiki side
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

  it('authoring sugar: `rotate` aliases `rotation`; `rotationDeg` wraps the target in rad()', () => {
    const text = [
      'symbol "S" {',
      '  layer "c" {',
      '    group "A" spring rotate "crochetX" stiffness 0.08 damping 0.86 {',
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

describe('flatFormat — reveal / link gestures (object → model → text)', () => {
  const src = [
    'size 200 200', 'scene {', '  layer "c" {',
    '    group "Card" at 10,10 { layer "c" { path "M0 0L1 0L1 1Z" fill #000000 } }',
    '    group "Capital" at 50,50 { layer "c" { path "M0 0L1 0L1 1Z" fill #000000 } }',
    '    group "Country" at 100,100 { layer "c" { path "M0 0L1 0L1 1Z" fill #000000 } }',
    '  }', '}', '',
    'object "Card" {', '  reveal seen {', '    brush 30', '  }', '}', '',
    'object "Capital" {', '  link ex, ey, target to Country', '}', '',
  ].join('\n')

  it('parse the reveal/link interactors with their fields', () => {
    const doc = parseProgramFull(src)
    const reveal = doc.interactors!.find((i) => i.axis === 'reveal')!
    expect(reveal).toMatchObject({ axis: 'reveal', varX: 'seen', grid: 30 })
    const link = doc.interactors!.find((i) => i.axis === 'link')!
    expect(link).toMatchObject({ axis: 'link', varX: 'ex', varY: 'ey', varT: 'target', confine: 'Country' })
  })

  it('stable round-trip (idempotent) + canonical gesture lines', () => {
    const once = printProgramFull(parseProgramFull(src))
    expect(printProgramFull(parseProgramFull(once))).toBe(once) // print∘parse idempotent
    expect(once).toContain('reveal seen {\n    brush 30\n  }')
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
  it('feedback <tokens> -> channel bindings (composed) + use "feedback"', () => {
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
      rotation: 'shake(wrong, time)',
    })
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
