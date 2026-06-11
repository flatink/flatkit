import { describe, it, expect } from 'vitest'
import { resolvePackage, importedFunctions, hasPackage, PACKAGES } from './stdlib'
import { parseUnits, printUnits } from './dsl'
import { compileExpr, evalExpr, exprScope, type ExprContext } from './expr'

// Wire the package functions like the player (closures sharing the same ctx → inter-fn calls), then
// evaluate an expression. Shared `ctx` = one package fn can call another (e.g. railX → railT).
function evalWith(pkgs: string[], src: string): number {
  const ctx: ExprContext = {}
  for (const f of importedFunctions(pkgs)) {
    if (f.kind !== 'value') continue
    const fc = compileExpr(f.expr)
    ctx[f.name] = (...args: number[]) => {
      const local = exprScope(ctx, 0, 0)
      f.params.forEach((p: string, i: number) => { local[p] = args[i] ?? 0 })
      return fc.ok ? evalExpr(fc.node, local, Number.NaN) : Number.NaN
    }
  }
  const c = compileExpr(src)
  return c.ok ? evalExpr(c.node, exprScope(ctx, 0, 0), Number.NaN) : Number.NaN
}

describe('packages — bundled stdlib + use', () => {
  it('resolvePackage: "collision" provides boxHit/dist/near', () => {
    expect(hasPackage('collision')).toBe(true)
    expect(hasPackage('missing')).toBe(false)
    const names = resolvePackage('collision').map((f) => f.name)
    expect(names).toEqual(['boxHit', 'dist', 'near'])
    expect(PACKAGES).toContain('easing')
    expect(resolvePackage('missing')).toEqual([]) // unknown → empty
  })

  it('use "…": model round-trip', () => {
    const u = parseUnits('use "collision"\nuse "easing"\n').units
    expect(u).toEqual([{ kind: 'use', name: 'collision' }, { kind: 'use', name: 'easing' }])
    expect(parseUnits(printUnits(u)).units).toEqual(u)
  })

  it('importedFunctions exposes the BARE and QUALIFIED name; callable both ways', () => {
    const funcs = importedFunctions(['collision'])
    expect(funcs.map((f) => f.name)).toContain('boxHit')
    expect(funcs.map((f) => f.name)).toContain('collision.boxHit') // namespacing
    // wire all functions like the player (closures), then call bare AND qualified
    const ctx: ExprContext = {}
    for (const f of funcs) {
      if (f.kind !== 'value') continue
      const fc = compileExpr(f.expr)
      ctx[f.name] = (...args: number[]) => {
        const local = exprScope(ctx, 0, 0)
        f.params.forEach((p: string, i: number) => { local[p] = args[i] ?? 0 })
        return fc.ok ? evalExpr(fc.node, local, Number.NaN) : Number.NaN
      }
    }
    const bare = compileExpr('boxHit(100, 100, 110, 105, 62, 29)')
    const qual = compileExpr('collision.boxHit(100, 100, 110, 105, 62, 29)')
    const miss = compileExpr('collision.boxHit(100, 100, 400, 100, 62, 29)')
    expect(bare.ok && evalExpr(bare.node, exprScope(ctx, 0, 0), -1)).toBe(1)
    expect(qual.ok && evalExpr(qual.node, exprScope(ctx, 0, 0), -1)).toBe(1) // qualified works
    expect(miss.ok && evalExpr(miss.node, exprScope(ctx, 0, 0), -1)).toBe(0)
  })
})

describe('packages — gesture (drag constraints)', () => {
  it('exposes snap/snapTo/railT/railX/railY/angle/inZone', () => {
    expect(resolvePackage('gesture').map((f) => f.name)).toEqual(['snap', 'snapTo', 'railT', 'railX', 'railY', 'angle', 'inZone'])
  })

  it('snap: snaps to the grid', () => {
    expect(evalWith(['gesture'], 'snap(43, 10)')).toBe(40)
    expect(evalWith(['gesture'], 'snap(46, 10)')).toBe(50)
  })

  it('snapTo: snaps to a value if within the radius', () => {
    expect(evalWith(['gesture'], 'snapTo(398, 400, 5)')).toBe(400)
    expect(evalWith(['gesture'], 'snapTo(390, 400, 5)')).toBe(390)
  })

  it('rail: projects onto the segment AB (railX calls railT — inter-fn of a package)', () => {
    // horizontal segment (200,500)-(600,500); pointer (400,800) → projection at the middle
    expect(evalWith(['gesture'], 'railX(400, 800, 200, 500, 600, 500)')).toBe(400)
    expect(evalWith(['gesture'], 'railY(400, 800, 200, 500, 600, 500)')).toBe(500)
    // pointer far to the right → clamped to endpoint B
    expect(evalWith(['gesture'], 'railX(9000, 500, 200, 500, 600, 500)')).toBe(600)
  })

  it('angle: RADIANS around a center (= unit of the rotation channel)', () => {
    expect(evalWith(['gesture'], 'angle(0, 0, 1, 0)')).toBeCloseTo(0)
    expect(evalWith(['gesture'], 'angle(0, 0, 0, 1)')).toBeCloseTo(Math.PI / 2)
    expect(evalWith(['gesture'], 'angle(0, 0, -1, 0)')).toBeCloseTo(Math.PI)
  })

  it('inZone: drop-zone test (corner + size)', () => {
    expect(evalWith(['gesture'], 'inZone(50, 50, 0, 0, 100, 100)')).toBe(1)
    expect(evalWith(['gesture'], 'inZone(150, 50, 0, 0, 100, 100)')).toBe(0)
  })
})
