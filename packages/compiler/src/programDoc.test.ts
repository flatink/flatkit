import { describe, it, expect } from 'vitest'
import { scopeProgram, docLintContext, lintDoc, lintDocReport, docStructureWarnings, docHasErrors, docLayoutWarnings } from './programDoc'
import { compileFlatpack } from './compile'
import { IDENTITY, translation } from '@flatkit/engine/transform'
import type { Doc, Group, Image, Instance, Interaction, Layer, Paint, Region, SymbolDef, Text } from '@flatkit/types'

const group = (id: string, name: string): Group => ({ id, kind: 'group', name, transform: IDENTITY, layers: [] })
const layer = (items: Layer['items']): Layer => ({ id: 'L', name: 'L', visible: true, locked: false, opacity: 1, items })
const click = (targetId: string, value: string): Interaction => ({ id: `i_${targetId}`, targetId, event: 'click', actions: [{ do: 'setVar', name: 'x', value }] })

describe('programDoc — scopeProgram', () => {
  it('emits an object block for a named scripted container', () => {
    const d: Doc = { width: 100, height: 100, symbols: [], layers: [layer([group('hero', 'Hero')])], interactions: [click('hero', 'mouse.x')] }
    const text = scopeProgram(d)
    expect(text).toContain('object "Hero" {')
    expect(text).toContain('x = mouse.x')
  })
})

describe('programDoc — package function aliases', () => {
  // A local package inlines each function twice: `tick` + the qualified alias `physics.tick`. The alias has
  // no `fn` syntax → it must stay OUT of the reconstructed text, but stay a KNOWN callable name.
  const d: Doc = {
    width: 100, height: 100, symbols: [], layers: [], imports: ['physics'],
    functions: [{ name: 'tick', params: ['s'], kind: 'value', expr: 's + 1' }, { name: 'physics.tick', params: ['s'], kind: 'value', expr: 's + 1' }],
    interactions: [], variables: {},
  }

  it('the qualified alias is not printed as a `fn` declaration (it would not parse)', () => {
    const text = scopeProgram(d)
    expect(text).toContain('fn tick(s)')
    expect(text).not.toMatch(/fn physics/)
  })

  it('but it stays callable: no phantom lint error, and both call forms are known', () => {
    expect(lintDocReport(d)).toBe('')
    expect([...(docLintContext(d).functions ?? [])]).toEqual(expect.arrayContaining(['tick', 'physics.tick']))
  })
})

describe('programDoc — docLintContext', () => {
  it('gathers variables, functions, objects of the Doc', () => {
    const d: Doc = {
      width: 100, height: 100, symbols: [], layers: [layer([group('hero', 'Hero')])],
      variables: { score: 0 }, functions: [{ name: 'launch', params: [], kind: 'proc', body: [] }], imports: ['collision'],
    }
    const ctx = docLintContext(d)
    expect([...(ctx.variables ?? [])]).toContain('score')
    expect([...(ctx.functions ?? [])]).toEqual(expect.arrayContaining(['launch', 'boxHit'])) // doc + package
    expect([...(ctx.objects ?? [])]).toContain('Hero')
  })
})

describe('programDoc — lintDoc', () => {
  it('detects an unknown variable in the code of an object', () => {
    const d: Doc = { width: 100, height: 100, symbols: [], layers: [layer([group('hero', 'Hero')])], interactions: [click('hero', 'speed + 1')] }
    const report = lintDocReport(d)
    expect(report).toMatch(/\[scene\].*unknown variable "speed"/)
    expect(lintDoc(d).length).toBe(1)
  })
  it('correct Doc -> empty report', () => {
    const d: Doc = { width: 100, height: 100, symbols: [], layers: [layer([group('hero', 'Hero')])], interactions: [click('hero', 'mouse.x')] }
    expect(lintDocReport(d)).toBe('')
  })

  // Stateful channel modifiers: the target is a normal expression → lint it in the symbol's scope.
  const grue = (target: string, damping = 0.86): Doc => ({
    width: 100, height: 100,
    symbols: [{ id: 'sym', name: 'Grue', params: [{ name: 'crochetX', type: 'number', default: '0' }],
      layers: [layer([{ id: 'susp', kind: 'group', name: 'Suspente', transform: IDENTITY, layers: [], modifiers: { rotation: { kind: 'spring', target, stiffness: 0.08, damping } } }])] }],
    layers: [layer([{ id: 'g1', kind: 'instance', name: 'g1', transform: IDENTITY, symbolId: 'sym' }])],
  })

  it('a modifier target referencing a symbol param passes (no diagnostic)', () => {
    expect(lintDocReport(grue('crochetX'))).toBe('')
  })

  it('a typo in a modifier target surfaces as "unknown variable", scoped to the symbol', () => {
    const report = lintDocReport(grue('crochetXX'))
    expect(report).toMatch(/\[Grue\].*spring rotation: unknown variable "crochetXX"/)
  })

  it('out-of-range spring damping is flagged (warning, clamped at runtime)', () => {
    expect(lintDocReport(grue('crochetX', 2))).toMatch(/spring rotation: damping 2 should be in \(0,1\)/)
  })

  it('a SCENE-object modifier target (.flatink form) is linted too: a typo surfaces', () => {
    const d: Doc = { width: 100, height: 100, symbols: [], layers: [layer([{ ...group('hero', 'Hero'), modifiers: { rotation: { kind: 'spring', target: 'nope', stiffness: 0.08, damping: 0.86 } } } as Group])] }
    expect(lintDocReport(d)).toMatch(/\[scene\].*spring rotation: unknown variable "nope"/)
  })

  it('a global used ONLY by a modifier target is not flagged as dead (no false positive)', () => {
    const d: Doc = { width: 100, height: 100, symbols: [], variables: { crochet: 0.6 }, layers: [layer([{ ...group('hero', 'Hero'), modifiers: { rotation: { kind: 'spring', target: 'crochet', stiffness: 0.08, damping: 0.86 } } } as Group])] }
    expect(lintDocReport(d)).toBe('') // crochet IS used (the spring target) → no "never used" warning
  })

  it('velocity() inside a modifier target lints clean (known in that context)', () => {
    expect(lintDocReport(grue('velocity(crochetX)'))).toBe('')
  })

  it('velocity() in a PLAIN expression is flagged as misuse', () => {
    const d: Doc = { width: 100, height: 100, symbols: [], variables: { x: 0 }, layers: [layer([{ ...group('hero', 'Hero'), expressions: { rotation: 'velocity(x)' } } as Group])] }
    expect(lintDocReport(d)).toMatch(/velocity\(\) is only valid inside a spring\/smooth target/)
  })
  it('reference by name (Hero.x) accepted in the Doc', () => {
    const d: Doc = { width: 100, height: 100, symbols: [], layers: [layer([group('hero', 'Hero'), group('target', 'Target')])], interactions: [click('hero', 'Target.x')] }
    expect(lintDocReport(d)).toBe('')
  })
  it('variable written in one scope, read in another -> NO error (global vars)', () => {
    // Hero writes `flag`; Target reads it. FlatInk variables are global -> cross-scope legitimate.
    const d: Doc = {
      width: 100, height: 100, symbols: [], layers: [layer([group('hero', 'Hero'), group('target', 'Target')])],
      interactions: [
        { id: 'i1', targetId: 'hero', event: 'click', actions: [{ do: 'setVar', name: 'flag', value: '1' }] },
        { id: 'i2', targetId: 'target', event: 'click', actions: [{ do: 'setVar', name: 'z', value: 'flag + 1' }] },
      ],
    }
    expect(lintDocReport(d)).toBe('')
  })
})

describe("programDoc — a symbol's params are known in its expr (RFC)", () => {
  const exprGroup = (name: string, expr: Record<string, string>): Group => ({ id: `g_${name}`, kind: 'group', name, transform: IDENTITY, layers: [layer([])], expressions: expr })
  const sym = (name: string, group: Group, extra: Partial<SymbolDef> = {}): SymbolDef =>
    ({ id: `s_${name}`, name, timeline: { fps: 24, durationFrames: 24, tracks: [] }, layers: [layer([group])], ...extra })
  const doc = (symbols: SymbolDef[]): Doc => ({ width: 100, height: 100, symbols, layers: [], timeline: { fps: 24, durationFrames: 24, tracks: [] } })

  it('a param read in the symbol\'s own expr is NOT an unknown variable', () => {
    const d = doc([sym('S', exprGroup('g', { scaleX: 'k' }), { params: [{ name: 'k', type: 'number', default: '1' }] })])
    expect(lintDocReport(d)).toBe('')
  })

  it('a STATE param is known too', () => {
    const d = doc([sym('D', exprGroup('g', { opacity: 'door' }), { states: [{ param: 'door', states: [{ name: 'open', frame: 0 }, { name: 'shut', frame: 12 }], initial: 'shut' }] })])
    expect(lintDocReport(d)).toBe('')
  })

  it('SCOPING: a param of symbol A does not silence an unknown of the same name in symbol B', () => {
    const d = doc([
      sym('A', exprGroup('ga', { rotation: 'roulis' }), { params: [{ name: 'roulis', type: 'number', default: '1' }] }),
      sym('B', exprGroup('gb', { rotation: 'roulis' })), // B declares no `roulis` → must still error
    ])
    const report = lintDocReport(d)
    expect(report).toMatch(/\[B\].*unknown variable "roulis"/)
    expect(report).not.toMatch(/\[A\]/) // A's legitimate use stays clean
  })

  it('a genuinely undeclared id (neither param nor let) is still flagged', () => {
    const d = doc([sym('S', exprGroup('g', { scaleX: 'kk' }), { params: [{ name: 'k', type: 'number', default: '1' }] })])
    expect(lintDocReport(d)).toMatch(/\[S\].*unknown variable "kk"/)
  })
})

describe('programDoc — structural warnings', () => {
  const drop = (targetId: string, over: string): Interaction => ({ id: `d_${targetId}`, targetId, event: 'drop', over, actions: [{ do: 'play' }] })

  it('nonexistent drop zone -> warning (not an error)', () => {
    const d: Doc = { width: 100, height: 100, symbols: [], layers: [layer([group('card', 'Card')])], interactions: [drop('card', 'PhantomZone')] }
    const ws = docStructureWarnings(d)
    expect(ws).toHaveLength(1)
    expect(ws[0].diag.severity).toBe('warning')
    expect(ws[0].diag.message).toMatch(/unknown drop zone "PhantomZone"/)
    expect(docHasErrors(d)).toBe(false) // a warning alone does not block
  })

  it('existing drop zone -> no warning', () => {
    const d: Doc = { width: 100, height: 100, symbols: [], layers: [layer([group('card', 'Card'), group('good', 'GoodZone')])], interactions: [drop('card', 'GoodZone')] }
    expect(docStructureWarnings(d).filter((w) => /drop zone/.test(w.diag.message))).toEqual([])
  })

  it('global variable never used -> warning; used -> nothing', () => {
    const used: Doc = { width: 100, height: 100, symbols: [], variables: { score: 0 }, layers: [layer([group('hero', 'Hero')])], interactions: [click('hero', 'score')] }
    expect(docStructureWarnings(used).filter((w) => /never used/.test(w.diag.message))).toEqual([])
    const dead: Doc = { width: 100, height: 100, symbols: [], variables: { never: 0 }, layers: [layer([group('hero', 'Hero')])], interactions: [click('hero', 'mouse.x')] }
    const ws = docStructureWarnings(dead).filter((w) => /never used/.test(w.diag.message))
    expect(ws).toHaveLength(1)
    expect(ws[0].diag.message).toMatch(/"never"/)
  })

  // An `instance "X"` naming no symbol keeps its unresolved `@X` marker all the way into the .flatpack,
  // draws nothing, and said nothing at `--check`. Measured on a real corpus: 96 such refs across 14 of 58
  // activities passed as `check passed ✓` — a green light on scenes missing most of their artwork.
  it('an instance resolving to no symbol -> warning naming it', () => {
    const ghost: Instance = { id: 'i1', kind: 'instance', name: 'Cloud1', transform: IDENTITY, symbolId: '@Nuage' }
    const d: Doc = { width: 100, height: 100, symbols: [], layers: [layer([ghost])] }
    const ws = docStructureWarnings(d).filter((w) => /resolves to no symbol/.test(w.diag.message))
    expect(ws).toHaveLength(1)
    expect(ws[0].diag.severity).toBe('warning')
    expect(ws[0].diag.message).toContain('"Nuage"')
    // A warning, never an error: compiling a program on its own and supplying the libs later is a
    // legitimate workflow — it must stay exit 0.
    expect(docHasErrors(d)).toBe(false)
  })

  it('a RESOLVED instance says nothing', () => {
    const ok: Instance = { id: 'i1', kind: 'instance', name: 'Cloud1', transform: IDENTITY, symbolId: 's_Nuage' }
    const d: Doc = { width: 100, height: 100, symbols: [{ id: 's_Nuage', name: 'Nuage', layers: [] }], layers: [layer([ok])] }
    expect(docStructureWarnings(d).filter((w) => /resolves to no symbol/.test(w.diag.message))).toEqual([])
  })

  it('finds them inside groups and inside a symbol, and names each missing symbol once', () => {
    const ghost = (id: string, sym: string): Instance => ({ id, kind: 'instance', name: id, transform: IDENTITY, symbolId: sym })
    const nested: Group = { id: 'g', kind: 'group', name: 'Sky', transform: IDENTITY, layers: [layer([ghost('a', '@Nuage'), ghost('b', '@Nuage')])] }
    const d: Doc = {
      width: 100, height: 100,
      symbols: [{ id: 's_Deco', name: 'Deco', layers: [layer([ghost('c', '@Vent')])] }],
      layers: [layer([nested])],
    }
    const ws = docStructureWarnings(d).filter((w) => /resolves to no symbol/.test(w.diag.message))
    expect(ws).toHaveLength(1) // one warning listing the missing symbols, not one per instance
    expect(ws[0].diag.message).toContain('"Nuage"')
    expect(ws[0].diag.message).toContain('"Vent"')
  })

  it('`time` in a channel expr + short looping timeline -> warning; `clock` or a long timeline -> nothing', () => {
    const ambient = (expr: string): Group => ({ ...group('cloud', 'Cloud'), expressions: { x: expr } })
    const mk = (expr: string, dur: number): Doc => ({ width: 100, height: 100, symbols: [], layers: [layer([ambient(expr)])], timeline: { fps: 24, durationFrames: dur, tracks: [] } })
    const hit = (d: Doc) => docStructureWarnings(d).filter((w) => /resets each loop/.test(w.diag.message))
    expect(hit(mk('50 + sin(time * 2) * 10', 60))).toHaveLength(1) // raw time + 2.5 s loop → warn
    expect(hit(mk('50 + sin(clock * 2) * 10', 60))).toEqual([]) // monotone clock → no warn
    expect(hit(mk('50 + sin(time * 2) * 10', 36000))).toEqual([]) // long timeline → never wraps in a session
    expect(docHasErrors(mk('50 + sin(time * 2) * 10', 60))).toBe(false) // warning only, non-blocking
  })

  it('follows `time` THROUGH a function and names it (the channel text holds no `time` at all)', () => {
    const ambient = (expr: string): Group => ({ ...group('cloud', 'Cloud'), expressions: { opacity: expr } })
    const mk = (expr: string, fns: Doc['functions'], dur = 60): Doc => ({
      width: 100, height: 100, symbols: [], layers: [layer([ambient(expr)])],
      ...(fns ? { functions: fns } : {}), timeline: { fps: 24, durationFrames: dur, tracks: [] },
    })
    const hit = (d: Doc) => docStructureWarnings(d).filter((w) => /resets each loop/.test(w.diag.message))
    const wobble = { name: 'wobble', params: ['k'], kind: 'value' as const, expr: 'sin(time * k)' }
    const outer = { name: 'outer', params: ['k'], kind: 'value' as const, expr: 'wobble(k) * 2' } // transitive

    expect(hit(mk('wobble(2)', [wobble]))).toHaveLength(1)
    expect(hit(mk('wobble(2)', [wobble]))[0].diag.message).toContain('`wobble()`')
    expect(hit(mk('outer(2)', [wobble, outer]))[0].diag.message).toContain('`outer()`') // reached through wobble
    // A parameter named `time` shadows the runtime scalar → the body's `time` is just an argument.
    expect(hit(mk('shadow(2)', [{ name: 'shadow', params: ['time'], kind: 'value', expr: 'sin(time)' }]))).toEqual([])
    // `pulse` now rides `clock`, so the case that started all this is clean by construction.
    expect(hit(mk('pulse(0, 0.9)', []))).toEqual([])
  })
})

// The 0.21 → 0.23 migration trap. `pulse`/`shake` moved onto the monotone `clock`, so an instant captured
// with the OLD idiom (`doneAt = time`) is compared against a clock it never shares: `clock - doneAt` grows
// without bound and the ramp NEVER fires. Nothing jumps, nothing blinks — the defect is entirely silent,
// and the `time`-wraps warning above says nothing either (the channel text holds no `time` at all).
describe('programDoc — an instant captured on `time` and read by pulse/shake', () => {
  const box = (expr: string): Group => ({ ...group('box', 'Box'), expressions: { scaleX: expr } })
  const capture = (value: string, name = 'doneAt'): Interaction => ({ id: 'i_box', targetId: 'box', event: 'click', actions: [{ do: 'setVar', name, value }] })
  const mk = (value: string, expr: string, dur = 60): Doc => ({
    width: 100, height: 100, symbols: [], variables: { doneAt: -999 },
    layers: [layer([box(expr)])], interactions: [capture(value)],
    timeline: { fps: 24, durationFrames: dur, tracks: [] },
  })
  const hit = (d: Doc) => docStructureWarnings(d).filter((w) => /captured on `time`/.test(w.diag.message))

  it('flags the silent trap and names both the variable and the reader', () => {
    const ws = hit(mk('time', '1 + pulse(doneAt, 0.6) * 0.2'))
    expect(ws).toHaveLength(1)
    expect(ws[0].diag.severity).toBe('warning')
    expect(ws[0].diag.message).toContain('"doneAt"')
    expect(ws[0].diag.message).toContain('pulse')
    expect(ws[0].diag.message).toMatch(/clock/) // the message must carry the fix
  })

  it('captured with `clock` -> nothing (the correct idiom stays quiet)', () => {
    expect(hit(mk('clock', '1 + pulse(doneAt, 0.6) * 0.2'))).toEqual([])
  })

  it('a LONG timeline does not silence it — unlike the wrap warning, this trap is loop-independent', () => {
    // `time` wrapping is not the point here: `pulse` compares against `clock`, so the two axes never meet
    // however long the timeline is. The wrap warning bails out above 120 frames; this one must not.
    expect(hit(mk('time', '1 + pulse(doneAt, 0.6) * 0.2', 36000))).toHaveLength(1)
  })

  it('captured on `time` but never read by pulse/shake -> nothing (no false positive)', () => {
    expect(hit(mk('time', '1 + sin(doneAt) * 0.2'))).toEqual([])
  })

  it('read by pulse but captured from something else -> nothing', () => {
    expect(hit(mk('42', '1 + pulse(doneAt, 0.6) * 0.2'))).toEqual([])
  })

  it('finds a capture nested inside an `if` branch', () => {
    const d = mk('time', '1 + pulse(doneAt, 0.6) * 0.2')
    d.interactions = [{ id: 'i_box', targetId: 'box', event: 'click', actions: [{ do: 'if', cond: 'lives == 0', then: [{ do: 'setVar', name: 'doneAt', value: 'time' }] }] }]
    expect(hit(d)).toHaveLength(1)
  })

  it('`shake` carries its instant in the SECOND argument', () => {
    expect(hit(mk('time', 'shake(wrong, doneAt)'))).toHaveLength(1)
    expect(hit(mk('time', 'shake(doneAt, clock)'))).toEqual([]) // arg 0 is the flag, not an instant
  })

  it('a nested call does not confuse the argument split', () => {
    expect(hit(mk('time', 'pulse(max(doneAt, 0), 0.6)'))).toHaveLength(1) // reached through the arg expression
    expect(hit(mk('time', 'clamp(pulse(0, 1), 0, doneAt)'))).toEqual([]) // doneAt is NOT pulse's instant
  })

  it('a capture on the timeline (`every frame`) and a read inside an action are both seen', () => {
    const d: Doc = {
      width: 100, height: 100, symbols: [], variables: { doneAt: -999, flash: 0 },
      layers: [layer([group('box', 'Box')])],
      interactions: [{ id: 'i_box', targetId: 'box', event: 'click', actions: [{ do: 'setVar', name: 'flash', value: 'pulse(doneAt, 1)' }] }],
      timeline: { fps: 24, durationFrames: 60, tracks: [], onEnterFrame: [{ do: 'setVar', name: 'doneAt', value: 'time' }] },
    }
    expect(hit(d)).toHaveLength(1)
  })

  it('the same variable read by two channels is reported once, not once per reader', () => {
    const d = mk('time', '1 + pulse(doneAt, 0.6) * 0.2')
    d.layers = [layer([{ ...group('box', 'Box'), expressions: { scaleX: 'pulse(doneAt, 1)', scaleY: 'pulse(doneAt, 1)' } }])]
    expect(hit(d)).toHaveLength(1)
  })
})

describe('programDoc — cel-layer warnings (silent drops)', () => {
  const shape = (id: string): Region => ({ id, color: '#000', path: { subpaths: [] } })
  const celLayer = (items: Layer['items'], cels: Layer['cels']): Layer => ({ id: 'L', name: 'draw', visible: true, locked: false, opacity: 1, items, cels })
  const doc = (l: Layer): Doc => ({ width: 100, height: 100, symbols: [], layers: [l], timeline: { fps: 24, durationFrames: 24, tracks: [] } })
  const hit = (d: Doc, re: RegExp) => docStructureWarnings(d).filter((w) => re.test(w.diag.message))

  it('a bare shape in a layer WITH cels -> warning (it is never drawn)', () => {
    const d = doc(celLayer([shape('r'), group('a', 'A')], [{ frame: 0, poses: [{ id: 'a' }] }]))
    const ws = hit(d, /bare shape/)
    expect(ws).toHaveLength(1)
    expect(ws[0].diag.message).toMatch(/matter \{ … \}/)
    expect(docHasErrors(d)).toBe(false) // non-blocking
  })

  it('frame-by-frame via `matter` -> no warning; a bare shape on a CEL-LESS layer -> no warning', () => {
    const fbf = doc(celLayer([], [{ frame: 0, poses: [], matter: [shape('r0')] }, { frame: 1, poses: [], matter: [shape('r1')] }]))
    expect(hit(fbf, /never drawn|never posed|matches no item/)).toEqual([])
    const staticLayer: Doc = { width: 100, height: 100, symbols: [], layers: [layer([shape('r')])] }
    expect(hit(staticLayer, /never drawn|never posed|matches no item/)).toEqual([])
  })

  it('a pose naming no roster item (unresolved `@Name`) -> warning', () => {
    const ws = hit(doc(celLayer([group('a', 'A')], [{ frame: 0, poses: [{ id: 'a' }] }, { frame: 1, poses: [{ id: '@Typo' }] }])), /matches no item/)
    expect(ws).toHaveLength(1)
    expect(ws[0].diag.message).toMatch(/pose "Typo"/)
  })

  it('a roster container no cel ever poses -> warning', () => {
    const ws = hit(doc(celLayer([group('a', 'A'), group('g', 'Ghost')], [{ frame: 0, poses: [{ id: 'a' }] }])), /never posed/)
    expect(ws).toHaveLength(1)
    expect(ws[0].diag.message).toMatch(/"Ghost"/)
  })

  it('scoped to the owning symbol, and nested group layers are visited', () => {
    const inner = celLayer([shape('r')], [{ frame: 0, poses: [] }])
    const outer: Group = { id: 'g', kind: 'group', name: 'G', transform: IDENTITY, layers: [inner] }
    const d: Doc = {
      width: 100, height: 100, layers: [], timeline: { fps: 24, durationFrames: 24, tracks: [] },
      symbols: [{ id: 's', name: 'Sym', timeline: { fps: 24, durationFrames: 24, tracks: [] }, layers: [layer([outer])] }],
    }
    const ws = hit(d, /bare shape/)
    expect(ws).toHaveLength(1)
    expect(ws[0].scope).toBe('Sym')
  })
})

describe('programDoc — layout warnings', () => {
  const mkText = (content: string, x: number, boxW: number, wrap?: boolean): Text => ({
    id: 't', kind: 'text', name: content, transform: translation(x, 20), content,
    font: 'sans-serif', size: 24, align: 'left', lineHeight: 1.2, color: '#000', box: { w: boxW, h: 40 }, ...(wrap ? { wrap: true } : {}),
  })
  const doc = (items: Layer['items']): Doc => ({ width: 800, height: 600, symbols: [], layers: [{ id: 'L', name: 'L', visible: true, locked: false, opacity: 1, items }] })

  it('item placed outside the canvas -> warning', () => {
    const img: Image = { id: 'im', kind: 'image', name: 'Misplaced', transform: translation(700, -150), assetId: 'x', w: 200, h: 200 }
    const ws = docLayoutWarnings(doc([img]))
    expect(ws.some((w) => /Misplaced.*clipped at the canvas edge/.test(w.diag.message))).toBe(true)
  })
  it('text that overflows the canvas (without wrap) -> warning; with wrap -> nothing', () => {
    const long = 'This instruction is far too long for its little box truly and even more'
    expect(docLayoutWarnings(doc([mkText(long, 40, 300)])).some((w) => /overflows the canvas/.test(w.diag.message))).toBe(true)
    expect(docLayoutWarnings(doc([mkText(long, 40, 300, true)])).filter((w) => /overflows the canvas/.test(w.diag.message))).toEqual([])
  })
  it('overlapping hitboxes -> warning', () => {
    const z = (id: string, x: number): Group => ({ id, kind: 'group', name: id, transform: translation(x, 100), hitbox: { w: 120, h: 120 }, layers: [] })
    const ws = docLayoutWarnings(doc([z('ZoneA', 100), z('ZoneB', 160)]))
    expect(ws.some((w) => /overlapping hitboxes.*ZoneA.*ZoneB/.test(w.diag.message))).toBe(true)
  })
  it('clean scene -> no layout warning', () => {
    const ok: Text = mkText('short', 40, 300, true)
    expect(docLayoutWarnings(doc([ok]))).toEqual([])
  })
  it('an item driven by an additive dx offset is treated as dynamic (no spurious clip warning)', () => {
    const img: Image = { id: 'im', kind: 'image', name: 'Slider', transform: translation(700, -150), assetId: 'x', w: 200, h: 200, expressions: { dx: '200*sin(time)' } }
    expect(docLayoutWarnings(doc([img])).filter((w) => /clipped at the canvas edge/.test(w.diag.message))).toEqual([]) // dx moves it -> static bbox is misleading, skip
  })

  // Text laid along a path: overflow is measured against the PATH length, not the canvas/box.
  const line = (len: number) => ({ subpaths: [{ closed: false, segments: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: len, y: 0 } }] }] })
  const onPath = (content: string, lineLen: number): Text => ({ ...mkText(content, 0, 0), textPath: { path: line(lineLen) } })

  it('text-on-path longer than its path -> "overflows its path" warning; fitting -> none', () => {
    expect(docLayoutWarnings(doc([onPath('OVERFLOWING LABEL', 20)])).some((w) => /overflows its path/.test(w.diag.message))).toBe(true)
    expect(docLayoutWarnings(doc([onPath('Hi', 300)])).filter((w) => /overflows its path/.test(w.diag.message))).toEqual([])
  })

  it('text-on-path never triggers the CANVAS-overflow / clipped warnings (box is irrelevant)', () => {
    const ws = docLayoutWarnings(doc([onPath('OVERFLOWING LABEL', 20)]))
    expect(ws.filter((w) => /overflows the canvas|clipped at the canvas edge/.test(w.diag.message))).toEqual([])
  })

  // Both passes used to read `doc.layers` top-level only, so anything drawn inside a group — which is
  // MOST of a real scene, since a group is the only thing a behavior block can animate — was never
  // measured at all. A text spilling out of its frame is the first defect an eye catches.
  describe('inside groups', () => {
    const wrapper = (items: Layer['items'], x: number, y: number): Group => ({
      id: 'g', kind: 'group', name: 'Card', transform: translation(x, y),
      layers: [{ id: 'GL', name: 'c', visible: true, locked: false, opacity: 1, items }],
    })

    it('a NESTED item pushed off the canvas is flagged, in world coordinates', () => {
      const img: Image = { id: 'im', kind: 'image', name: 'Badge', transform: translation(40, 40), assetId: 'x', w: 200, h: 200 }
      // Group at 700,-190 + item at 40,40 → world 740,-150: off the top edge and past the right one.
      expect(docLayoutWarnings(doc([wrapper([img], 700, -190)])).some((w) => /Badge.*clipped at the canvas edge/.test(w.diag.message))).toBe(true)
      // The very same item, inside a group that sits in the canvas, is fine.
      expect(docLayoutWarnings(doc([wrapper([img], 100, 100)])).filter((w) => /clipped at the canvas edge/.test(w.diag.message))).toEqual([])
    })

    it('a nested text overflowing the canvas is flagged', () => {
      const long = 'This instruction is far too long for its little box truly and even more'
      expect(docLayoutWarnings(doc([wrapper([mkText(long, 40, 300)], 300, 0)])).some((w) => /overflows the canvas/.test(w.diag.message))).toBe(true)
    })

    it('a group transform is composed, not ignored (an offset parent moves its child)', () => {
      const img: Image = { id: 'im', kind: 'image', name: 'Badge', transform: translation(40, 40), assetId: 'x', w: 100, h: 100 }
      const inside = docLayoutWarnings(doc([wrapper([img], 0, 0)])).filter((w) => /clipped/.test(w.diag.message))
      const straddling = docLayoutWarnings(doc([wrapper([img], 750, 0)])).filter((w) => /clipped/.test(w.diag.message))
      expect(inside).toEqual([]) // parent at origin → child at 40,40, on canvas
      expect(straddling).toHaveLength(1) // same child, parent shifted until it crosses the right edge
      // Parked ENTIRELY off-canvas stays silent, as it already did at the top level — that is the
      // deliberate "hidden" pattern, not a mistake.
      expect(docLayoutWarnings(doc([wrapper([img], 1200, 0)])).filter((w) => /clipped/.test(w.diag.message))).toEqual([])
    })
  })

  // `wrap` was skipped entirely by the width pass — reasonably, since a wrapped line cannot overflow the
  // box HORIZONTALLY. What it does overflow is the box's HEIGHT, and that is the same visible defect.
  describe('wrapped text', () => {
    const wrapped = (content: string, boxW: number, boxH: number): Text => ({
      id: 't', kind: 'text', name: 'Label', transform: translation(40, 40), content, wrap: true,
      font: 'sans-serif', size: 24, align: 'left', lineHeight: 1.2, color: '#000', box: { w: boxW, h: boxH },
    })
    const hit = (t: Text) => docLayoutWarnings(doc([t])).filter((w) => /overflows its box/.test(w.diag.message))

    it('more wrapped lines than the box is tall -> warning naming both heights', () => {
      const ws = hit(wrapped('one two three four five six seven eight nine ten eleven twelve', 200, 40))
      expect(ws).toHaveLength(1)
      expect(ws[0].diag.severity).toBe('warning')
      expect(ws[0].diag.message).toMatch(/line/)
    })

    it('text that fits its box -> nothing', () => {
      expect(hit(wrapped('two words', 400, 120))).toEqual([])
    })

    it('a taller box absorbs the same text -> nothing', () => {
      const content = 'one two three four five six seven eight nine ten eleven twelve'
      expect(hit(wrapped(content, 200, 40))).toHaveLength(1)
      expect(hit(wrapped(content, 200, 600))).toEqual([])
    })

    it('explicit newlines count as line breaks even in a narrow box', () => {
      expect(hit(wrapped('a\nb\nc\nd\ne\nf\ng\nh', 400, 40))).toHaveLength(1)
    })

    it('a single word wider than the box is flagged (it cannot be broken)', () => {
      const ws = docLayoutWarnings(doc([wrapped('Supercalifragilisticexpialidocious', 80, 400)]))
      expect(ws.some((w) => /cannot be broken|too wide/.test(w.diag.message))).toBe(true)
    })

    it('a text WITHOUT wrap is not measured against its box (it may overflow it harmlessly)', () => {
      expect(hit(mkText('one two three four five six seven eight', 40, 60))).toEqual([])
    })

    it('wrapped text inside a group is measured too', () => {
      const g: Group = {
        id: 'g', kind: 'group', name: 'Card', transform: translation(100, 100),
        layers: [{ id: 'GL', name: 'c', visible: true, locked: false, opacity: 1, items: [wrapped('one two three four five six seven eight nine ten eleven twelve', 200, 40)] }],
      }
      expect(docLayoutWarnings(doc([g])).filter((w) => /overflows its box/.test(w.diag.message))).toHaveLength(1)
    })
  })
})

describe('programDoc — a color param used as a paint must be declared (RFC follow-up)', () => {
  const radial = (param: string): Paint => ({ type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: [{ offset: 0, color: '#ffe9a8', param, alpha: 0.8 }, { offset: 1, color: '#000000' }] })
  const region = (extra: Partial<Region>): Region => ({ id: 'r', color: '#ffffff', path: { subpaths: [] }, ...extra })
  const haloSym = (item: Layer['items'][number], declare = true): SymbolDef =>
    ({ id: 's_Halo', name: 'Halo', layers: [layer([item])], ...(declare ? { params: [{ name: 'teinte', type: 'color', default: '#ffe9a8' }] } : {}) })
  const doc1 = (item: Layer['items'][number], declare = true): Doc => ({ width: 100, height: 100, symbols: [haloSym(item, declare)], layers: [] })
  const paintWarn = (d: Doc) => lintDoc(d).filter((w) => /unknown color param/.test(w.diag.message)).map((w) => `[${w.scope}] ${w.diag.message}`)

  it('a declared `color` param in a stop / tint / fill is clean', () => {
    expect(paintWarn(doc1(region({ paint: radial('teinte') })))).toEqual([])
    expect(paintWarn(doc1({ id: 'g', kind: 'group', name: 'g', transform: IDENTITY, layers: [layer([])], tint: { color: '#fff', param: 'teinte', amount: 0.5 } }))).toEqual([])
    expect(paintWarn(doc1(region({ fillParam: 'teinte' })))).toEqual([])
  })

  it('a typo in a stop / tint / fill / stroke is flagged (warning, scoped to the symbol)', () => {
    expect(paintWarn(doc1(region({ paint: radial('teint') })))[0]).toMatch(/\[Halo\].*unknown color param "teint" in a gradient stop/)
    expect(paintWarn(doc1({ id: 'g', kind: 'group', name: 'g', transform: IDENTITY, layers: [layer([])], tint: { color: '#fff', param: 'tinte', amount: 0.5 } }))[0]).toMatch(/in a tint/)
    expect(paintWarn(doc1(region({ fillParam: 'teinet' })))[0]).toMatch(/in a fill/)
    expect(paintWarn(doc1(region({ strokeParam: 'teim' })))[0]).toMatch(/in a stroke/)
  })

  it('it is a WARNING, not an error (does not block a build)', () => {
    expect(docHasErrors(doc1(region({ paint: radial('teint') })))).toBe(false)
  })

  it('SCOPING: `teinte` declared in symbol A does not silence the same name in symbol B', () => {
    const d: Doc = { width: 100, height: 100, layers: [], symbols: [
      haloSym(region({ paint: radial('teinte') })), // A: declares teinte → clean
      { id: 's_B', name: 'B', layers: [layer([region({ paint: radial('teinte') })])] }, // B: no params → must warn
    ] }
    const w = paintWarn(d)
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/\[B\].*unknown color param "teinte"/)
  })
})

describe('programDoc — lint positions point into the SOURCE, not a rebuilt program', () => {
  // `scopeProgram` rebuilds a text WITHOUT the `scene { … }` block. Linting that and reporting its line
  // numbers against the author's file sent them to a line that had nothing to do with the error — the
  // offset being exactly the height of the scene block. Passing the source fixes both line and scope.
  const src = [
    'var wrong = 0',                                   // 1
    'scene {',                                         // 2
    '  layer "Fond" {',                                // 3
    '    rect 0 0 960 540 fill #ebf2fe',               // 4
    '  }',                                             // 5
    '  layer "Jeu" {',                                 // 6
    '    group "A" {',                                 // 7
    '      layer "i" { circle 0 0 40 fill #ff0000 }',  // 8
    '    }',                                           // 9
    '  }',                                             // 10
    '}',                                               // 11
    'object "A" {',                                    // 12
    '  feedback lift tilt dim shake(wrong)',           // 13 — sugar: must not shift what follows
    '  opacity = 1 - doneAtt',                         // 14 — the typo
    '}',                                               // 15
    '',
  ].join('\n')

  it('reports the real line and the real scope', () => {
    const doc = compileFlatpack(src)
    const diags = lintDoc(doc, src).filter(({ diag }) => /doneAtt/.test(diag.message))
    expect(diags).toHaveLength(1)
    expect(diags[0].scope).toBe('object "A"') // not the catch-all `scene`
    expect(diags[0].diag.line).toBe(14)       // the line the author can actually go and read
  })

  it('without the source, the position is the rebuilt program\'s (kept for the editor, where it IS the file)', () => {
    const doc = compileFlatpack(src)
    const diags = lintDoc(doc).filter(({ diag }) => /doneAtt/.test(diag.message))
    expect(diags).toHaveLength(1)
    expect(diags[0].diag.line).not.toBe(14)
  })
})
