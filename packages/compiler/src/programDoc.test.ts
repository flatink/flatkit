import { describe, it, expect } from 'vitest'
import { scopeProgram, docLintContext, lintDoc, lintDocReport, docStructureWarnings, docHasErrors, docLayoutWarnings } from './programDoc'
import { IDENTITY, translation } from '@flatkit/engine/transform'
import type { Doc, Group, Image, Interaction, Layer, SymbolDef, Text } from '@flatkit/types'

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

  it('`time` in a channel expr + short looping timeline -> warning; `clock` or a long timeline -> nothing', () => {
    const ambient = (expr: string): Group => ({ ...group('cloud', 'Cloud'), expressions: { x: expr } })
    const mk = (expr: string, dur: number): Doc => ({ width: 100, height: 100, symbols: [], layers: [layer([ambient(expr)])], timeline: { fps: 24, durationFrames: dur, tracks: [] } })
    const hit = (d: Doc) => docStructureWarnings(d).filter((w) => /resets each loop/.test(w.diag.message))
    expect(hit(mk('50 + sin(time * 2) * 10', 60))).toHaveLength(1) // raw time + 2.5 s loop → warn
    expect(hit(mk('50 + sin(clock * 2) * 10', 60))).toEqual([]) // monotone clock → no warn
    expect(hit(mk('50 + sin(time * 2) * 10', 36000))).toEqual([]) // long timeline → never wraps in a session
    expect(docHasErrors(mk('50 + sin(time * 2) * 10', 60))).toBe(false) // warning only, non-blocking
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
})
