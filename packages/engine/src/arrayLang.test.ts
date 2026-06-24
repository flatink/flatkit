import { describe, it, expect } from 'vitest'
import { compileExpr, evalExpr, type ExprContext } from './expr'
import { parseUnits, printUnits } from './dsl'
import { runActions, type ActionHost } from './actions'
import { applyInstanceBinds } from './instanceBind'
import { timelineToUnits } from './scriptDoc'
import { isInstance } from './layers'
import type { Doc } from '@flatkit/types'

const ev = (src: string, ctx: ExprContext) => { const c = compileExpr(src); return c.ok ? evalExpr(c.node, ctx, -1) : NaN }

describe('language — arrays + indexed loop', () => {
  it('expr: indexing arr[i] (+ OOB → fallback)', () => {
    expect(ev('a[2]', { a: [10, 20, 30] })).toBe(30)
    expect(ev('a[i]', { a: [10, 20, 30], i: 1 })).toBe(20)
    expect(ev('a[0] + a[1]', { a: [3, 4] })).toBe(7)
    expect(ev('a[9]', { a: [1, 2] })).toBe(-1) // out of bounds → NaN → fallback
  })

  it('dsl: let fill / literal model round-trip', () => {
    const u = parseUnits('let bricks = fill(32, 1)\n').units
    expect(u[0]).toEqual({ kind: 'declare', name: 'bricks', value: Array<number>(32).fill(1) })
    expect(printUnits(u)).toBe('let bricks = fill(32, 1)\n')
    const lit = parseUnits('let g = [1, 0, 2]\n').units
    expect(lit[0]).toEqual({ kind: 'declare', name: 'g', value: [1, 0, 2] })
    expect(parseUnits(printUnits(lit)).units).toEqual(lit)
  })

  it('dsl: repeat i from 0 to N + set arr[i] model round-trip', () => {
    const src = 'every frame {\n  repeat i from 0 to 3 {\n    set arr[i] = i * 2\n  }\n}\n'
    const u = parseUnits(src).units
    expect(parseUnits(printUnits(u)).units).toEqual(u)
  })

  it('actions: repeatRange iterates and setIndex writes the array', () => {
    const vars = new Map<string, number | number[]>([['arr', [0, 0, 0, 0]]])
    const host: ActionHost = {
      play() {}, pause() {}, seek() {}, labelFrame: () => undefined,
      setVar: (n, v) => { vars.set(n, v) },
      setIndex: (n, i, v) => { const a = vars.get(n); if (Array.isArray(a)) a[i] = v },
      setParam: () => {},
      callProc: () => {},
      emit: () => {}, textContent: () => '', playSound: () => {},
      evalNumber: (s) => { const c = compileExpr(s); if (!c.ok) return 0; const ctx: ExprContext = {}; for (const [k, v] of vars) ctx[k] = v; return evalExpr(c.node, ctx, 0) },
    }
    const { units } = parseUnits('every frame {\n  repeat i from 0 to 3 {\n    set arr[i] = i * 2\n  }\n}\n')
    const u0 = units[0]
    if (u0.kind !== 'event') throw new Error('expected event')
    runActions(u0.body, host)
    expect(vars.get('arr')).toEqual([0, 2, 4, 6])
  })

  it('regression: NESTED index as target (`occ[sl[i + 1]] = 0`) — balanced scan, not truncated', () => {
    // EDU feedback bug: the index was captured up to the FIRST "]" → truncated target → SILENT miscompile
    // (occ never written, no error or warning). The balanced scan captures the whole nested index.
    const { units, diagnostics } = parseUnits('every frame {\n  occ[sl[i + 1]] = 0\n}\n')
    expect(diagnostics).toEqual([])
    const u0 = units[0]
    if (u0.kind !== 'event') throw new Error('expected event')
    expect(u0.body[0]).toEqual({ do: 'setIndex', name: 'occ', index: 'sl[i + 1]', value: '0' })

    // runtime: the write reaches occ[sl[i + 1]] (sl[1] = 2 → occ[2] = 0)
    const vars = new Map<string, number | number[]>([['occ', [9, 9, 9, 9]], ['sl', [0, 2, 0]], ['i', 0]])
    const host: ActionHost = {
      play() {}, pause() {}, seek() {}, labelFrame: () => undefined,
      setVar: (n, v) => { vars.set(n, v) },
      setIndex: (n, i, v) => { const a = vars.get(n); if (Array.isArray(a)) a[i] = v },
      setParam: () => {},
      callProc: () => {},
      emit: () => {}, textContent: () => '', playSound: () => {},
      evalNumber: (s) => { const c = compileExpr(s); if (!c.ok) return 0; const ctx: ExprContext = {}; for (const [k, v] of vars) ctx[k] = v; return evalExpr(c.node, ctx, 0) },
    }
    runActions(u0.body, host)
    expect(vars.get('occ')).toEqual([9, 9, 0, 9])
  })

  it('each "Sym" as i: model round-trip + per-instance expansion (index substituted)', () => {
    const src = 'each "Brick" as i {\n  opacity = bricks[i]\n  scaleX = bricks[i] * 2\n}\n'
    const u = parseUnits(src).units
    expect(u[0]).toMatchObject({ kind: 'each', symbol: 'Brick', as: 'i' })
    expect(parseUnits(printUnits(u)).units).toEqual(u) // model round-trip

    // expansion: 3 instances of "Brick" → opacity = bricks[0|1|2]
    const layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items:
      [0, 1, 2].map((k) => ({ id: 'b' + k, kind: 'instance' as const, name: 'Brick ' + k, symbolId: 'sym', transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } })) }
    const doc: Doc = {
      width: 100, height: 100,
      symbols: [{ id: 'sym', name: 'Brick', layers: [{ id: 's', name: 'c', visible: true, locked: false, opacity: 1, items: [] }] }],
      layers: [layer],
      timeline: { fps: 24, durationFrames: 1, tracks: [], binds: [{ symbol: 'Brick', as: 'i', expr: { opacity: 'bricks[i]', scaleX: 'bricks[i] * 2' } }] },
    }
    const out = applyInstanceBinds(doc)
    const got = out.layers[0].items.map((it) => (isInstance(it) ? it.expressions?.opacity : null))
    expect(got).toEqual(['bricks[0]', 'bricks[1]', 'bricks[2]'])
    expect(doc.layers[0].items.every((it) => isInstance(it) && !it.expressions)).toBe(true) // source intact

    // the binds come back as `each` via the timeline
    expect(printUnits(timelineToUnits(doc.timeline)).startsWith('each "Brick" as i')).toBe(true)
  })

  it('each "Sym" as i: additive dx offset binding expands per-instance too', () => {
    const layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items:
      [0, 1, 2].map((k) => ({ id: 'b' + k, kind: 'instance' as const, name: 'Dot ' + k, symbolId: 'sym', transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } })) }
    const doc: Doc = {
      width: 100, height: 100,
      symbols: [{ id: 'sym', name: 'Dot', layers: [{ id: 's', name: 'c', visible: true, locked: false, opacity: 1, items: [] }] }],
      layers: [layer],
      timeline: { fps: 24, durationFrames: 1, tracks: [], binds: [{ symbol: 'Dot', as: 'i', expr: { dx: 'wobble[i] * 4' } }] },
    }
    const out = applyInstanceBinds(doc)
    expect(out.layers[0].items.map((it) => (isInstance(it) ? it.expressions?.dx : null)))
      .toEqual(['wobble[0] * 4', 'wobble[1] * 4', 'wobble[2] * 4'])
  })
})
