import { describe, it, expect } from 'vitest'
import { parseUnits, printUnits } from './dsl'
import { runActions, type Action, type ActionHost, type FuncDef } from './actions'
import { compileExpr, evalExpr, exprScope, type ExprContext } from './expr'

const funcOf = (src: string): FuncDef => {
  const u = parseUnits(src).units[0]
  if (u.kind !== 'func') throw new Error('expected fn')
  return u.func
}

describe('language — functions', () => {
  it('round-trip: value fn + procedure fn + call', () => {
    const src = 'fn dist(a, b) = a + b\n\nfn launch() {\n  x = 1\n}\n\nevery frame {\n  launch()\n}\n'
    const u = parseUnits(src).units
    expect(parseUnits(printUnits(u)).units).toEqual(u) // model round-trip
    expect(u[0]).toMatchObject({ kind: 'func', func: { name: 'dist', params: ['a', 'b'], kind: 'value', expr: 'a + b' } })
    expect(u[1]).toMatchObject({ kind: 'func', func: { name: 'launch', params: [], kind: 'proc' } })
  })

  it('procedure: params bound, executed, and restored (no global leak)', () => {
    const proc = funcOf('fn addTo(a, b) {\n  out = a + b\n}\n')
    if (proc.kind !== 'proc') throw new Error('proc')
    const vars = new Map<string, number | number[]>([['out', -1], ['a', 999]]) // 'a' global to test restoration
    let depth = 0
    const host: ActionHost = {
      play() {}, pause() {}, seek() {}, labelFrame: () => undefined, setIndex() {}, setParam() {},
      emit() {}, textContent: () => '', playSound() {},
      setVar: (n, v) => { vars.set(n, v) },
      callProc: (name, args) => {
        if (name !== proc.name || depth > 64) return
        const saved = proc.params.map((p) => [p, vars.get(p)] as const)
        proc.params.forEach((p, i) => vars.set(p, args[i] ?? 0))
        depth++; runActions(proc.body, host); depth--
        for (const [p, v] of saved) { if (v === undefined) vars.delete(p); else vars.set(p, v) }
      },
      evalNumber: (s) => { const c = compileExpr(s); if (!c.ok) return 0; const ctx: ExprContext = {}; for (const [k, v] of vars) ctx[k] = v; return evalExpr(c.node, ctx, 0) },
    }
    const call: Action = { do: 'call', name: 'addTo', args: ['10', '5'] }
    runActions([call], host)
    expect(vars.get('out')).toBe(15) // addTo(10, 5) executed
    expect(vars.get('a')).toBe(999) // the global 'a' restored (the param did not leak)
  })

  it('value function: callable inside an expression', () => {
    const f = funcOf('fn hyp(a, b) = sqrt(a*a + b*b)\n')
    if (f.kind !== 'value') throw new Error('value')
    const fc = compileExpr(f.expr)
    const ctx: ExprContext = {}
    ctx[f.name] = (...args: number[]) => {
      const local = exprScope(ctx, 0, 0)
      f.params.forEach((p, i) => { local[p] = args[i] ?? 0 })
      return fc.ok ? evalExpr(fc.node, local, Number.NaN) : Number.NaN
    }
    const call = compileExpr('hyp(3, 4)')
    expect(call.ok && evalExpr(call.node, exprScope(ctx, 0, 0), -1)).toBe(5)
  })
})
