import { describe, it, expect } from 'vitest'
import { hasPackage, PACKAGES, resolvePackage, importedFunctions, packageFunctionNames } from './stdlib'
import { compileExpr, evalExpr, MATH_CTX, type ExprContext } from './expr'

// Smoke coverage for the embedded packages. The full round-trip test (sources → AST) needs the DSL
// parser, which is not ported yet; this checks the pre-compiled package surface.
describe('stdlib — embedded packages', () => {
  it('lists the embedded packages', () => {
    expect(PACKAGES).toEqual(expect.arrayContaining(['collision', 'easing', 'gesture']))
    expect(hasPackage('gesture')).toBe(true)
    expect(hasPackage('nope')).toBe(false)
  })

  it('resolvePackage returns value functions (empty for unknown)', () => {
    const fns = resolvePackage('gesture')
    expect(fns.some((f) => f.name === 'snap' && f.kind === 'value')).toBe(true)
    expect(resolvePackage('nope')).toEqual([])
  })

  it('importedFunctions exposes bare AND qualified names', () => {
    const names = importedFunctions(['collision']).map((f) => f.name)
    expect(names).toContain('boxHit')
    expect(names).toContain('collision.boxHit')
  })

  it('packageFunctionNames lists bare + qualified', () => {
    expect(packageFunctionNames('easing')).toEqual(expect.arrayContaining(['smooth', 'easing.smooth']))
  })

  it('feedback package: exposes the stateless reactions and they compute', () => {
    expect(hasPackage('feedback')).toBe(true)
    const fns = resolvePackage('feedback')
    expect(fns.map((f) => f.name).sort()).toEqual(['dim', 'lift', 'pulse', 'shake', 'sink', 'tilt'])
    // Evaluate each fn's expression directly (h/g/bad = 0/1) to lock the resting vs active values.
    const evalFn = (name: string, args: ExprContext): number => {
      const f = fns.find((x) => x.name === name)!
      const c = compileExpr(f.kind === 'value' ? f.expr : '0')
      return c.ok ? evalExpr(c.node, { ...MATH_CTX, ...args }) : NaN
    }
    expect(evalFn('lift', { h: 1 })).toBeCloseTo(1.06, 5)
    expect(evalFn('lift', { h: 0 })).toBe(1) // resting
    expect(evalFn('tilt', { g: 1 })).toBeCloseTo(0.94, 5)
    expect(evalFn('sink', { g: 0 })).toBe(0)
    expect(evalFn('shake', { bad: 0, t: 3 })).toBe(0) // no shake when not wrong
    expect(evalFn('shake', { bad: 1, t: 0 })).toBe(0) // sin(0) = 0
    // pulse(since, dur): linear 1→0 ramp over `dur` s since `since` (uses ambient `time`), clamped 0..1.
    expect(evalFn('pulse', { time: 0, since: 0, dur: 4 })).toBe(1) // just triggered
    expect(evalFn('pulse', { time: 2, since: 0, dur: 4 })).toBeCloseTo(0.5, 5) // halfway
    expect(evalFn('pulse', { time: 10, since: 0, dur: 4 })).toBe(0) // expired → clamped
  })
})
