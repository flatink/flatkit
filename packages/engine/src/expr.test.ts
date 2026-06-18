import { describe, it, expect } from 'vitest'
import { compileExpr, evalExpr, exprScope, MATH_CTX, type ExprContext } from './expr'

const run = (src: string, ctx: ExprContext = {}, fb = 0): number => {
  const c = compileExpr(src)
  if (!c.ok) throw new Error(`compile: ${c.error}`)
  return evalExpr(c.node, { ...MATH_CTX, ...ctx }, fb)
}

describe('expr — helpers', () => {
  it('between(x, lo, hi) → 1/0 (bounds included)', () => {
    expect(run('between(5, 0, 10)')).toBe(1)
    expect(run('between(0, 0, 10)')).toBe(1)
    expect(run('between(10, 0, 10)')).toBe(1)
    expect(run('between(15, 0, 10)')).toBe(0)
    expect(run('between(-1, 0, 10)')).toBe(0)
  })
})

describe('expr — arithmetic & precedence', () => {
  it('operations and priorities', () => {
    expect(run('1+2*3')).toBe(7)
    expect(run('(1+2)*3')).toBe(9)
    expect(run('10/4')).toBe(2.5)
    expect(run('7%3')).toBe(1)
    expect(run('2*3+4*5')).toBe(26)
  })
  it('unary - and !', () => {
    expect(run('-5')).toBe(-5)
    expect(run('- -3')).toBe(3)
    expect(run('!0')).toBe(1)
    expect(run('!5')).toBe(0)
  })
})

describe('expr — comparisons, logic, ternary', () => {
  it('comparisons → 1/0', () => {
    expect(run('5>3')).toBe(1)
    expect(run('2>3')).toBe(0)
    expect(run('4<=4')).toBe(1)
    expect(run('3==3')).toBe(1)
    expect(run('3!=3')).toBe(0)
  })
  it('&& || numeric short-circuit', () => {
    expect(run('1&&0')).toBe(0)
    expect(run('1||0')).toBe(1)
    expect(run('3>2 && 1<2')).toBe(1)
  })
  it('ternary', () => {
    expect(run('t<2?10:20', { t: 1 })).toBe(10)
    expect(run('t<2?10:20', { t: 3 })).toBe(20)
  })
})

describe('expr — functions, constants, members, variables', () => {
  it('math functions', () => {
    expect(run('sin(0)')).toBeCloseTo(0)
    expect(run('max(3,7,2)')).toBe(7)
    expect(run('clamp(15,0,10)')).toBe(10)
    expect(run('abs(-4)')).toBe(4)
    expect(run('round(2.6)')).toBe(3)
    expect(run('lerp(0,100,0.5)')).toBe(50)
  })
  it('constants', () => {
    expect(run('PI')).toBeCloseTo(Math.PI)
    expect(run('TAU')).toBeCloseTo(Math.PI * 2)
  })
  it('member access (mouse.x)', () => {
    expect(run('mouse.x + mouse.y', { mouse: { x: 3, y: 4 } })).toBe(7)
  })
  it('context variables (value, time)', () => {
    expect(run('value + sin(time)*20', { value: 100, time: Math.PI / 2 })).toBeCloseTo(120)
  })
  it('realistic case: oscillation around the value', () => {
    // wiggle of ±20 around 100
    expect(run('value + sin(time)*20', { value: 100, time: 0 })).toBeCloseTo(100)
  })
})

describe('expr — compile errors', () => {
  it('rejects invalid syntax', () => {
    expect(compileExpr('1 +').ok).toBe(false)
    expect(compileExpr('(1+2').ok).toBe(false)
    expect(compileExpr(')').ok).toBe(false)
    expect(compileExpr('1 2').ok).toBe(false)
    expect(compileExpr('sin(').ok).toBe(false)
    expect(compileExpr('@').ok).toBe(false)
  })
  it('accepts valid expressions', () => {
    expect(compileExpr('sin(time)*20').ok).toBe(true)
    expect(compileExpr('a.b > 0 ? 1 : -1').ok).toBe(true)
  })
})

describe('exprScope — context order (sandbox)', () => {
  it('math & reserved names take priority over extra; value/time/frame set', () => {
    const ctx = exprScope({ sin: 999, time: 999, x: 5 } as ExprContext, 2, 10, 42)
    expect(ctx.time).toBe(2)
    expect(ctx.frame).toBe(10)
    expect(ctx.value).toBe(42)
    expect(ctx.x).toBe(5) // variable kept
    // `sin` resolves to the MATH function, not the same-named variable — verified through EVALUATION
    // (exprScope no longer copies MATH_CTX into the context; evalNode falls back to it, math-first).
    expect(run('sin(0)', { sin: 999 } as ExprContext)).toBe(0) // Math.sin(0), not 999
    expect(run('sin(0)', ctx)).toBe(0) // same through a real exprScope ctx (its `sin` var is shadowed by math)
  })
  it('value absent → no value key', () => {
    expect('value' in exprScope({}, 0, 0)).toBe(false)
  })
  it('clock defaults to time (static eval), explicit arg wins, ctx-carried clock survives', () => {
    expect(exprScope({}, 3, 72).clock).toBe(3) // no clock → coincides with time
    expect(exprScope({}, 3, 72, undefined, 9).clock).toBe(9) // explicit monotone clock
    expect(exprScope({ clock: 9 } as ExprContext, 3, 72).clock).toBe(9) // clock riding inside `extra` (player path)
  })
})

describe('expr — robustness & sandbox', () => {
  it('unknown identifier → NaN → fallback', () => {
    expect(run('foo', {}, 99)).toBe(99)
    expect(run('foo + 1', {}, 7)).toBe(7)
  })
  it('division by zero / NaN → fallback', () => {
    expect(run('1/0', {}, 42)).toBe(42)
    expect(run('0/0', {}, 42)).toBe(42)
  })
  it('no escape: member access on a function → NaN', () => {
    // `sin` is a function, not an object → no access to .constructor etc.
    expect(run('sin.constructor', {}, -1)).toBe(-1)
    expect(run('constructor', {}, -1)).toBe(-1)
  })
  it('calling a non-function → NaN', () => {
    expect(run('value(1)', { value: 3 }, -1)).toBe(-1)
  })
})

describe('expr — prototype safety', () => {
  it('never invokes an inherited function (own props only)', () => {
    // `toString` is on Object.prototype, NOT an own prop of the context → must resolve to fallback,
    // and crucially must not be CALLED (a malicious inherited getter/fn would otherwise run).
    const c = compileExpr('toString(0)')
    expect(c.ok).toBe(true)
    if (c.ok) expect(evalExpr(c.node, { x: 1 }, -1)).toBe(-1)
  })
  it('inherited members → fallback, own nested members still resolve', () => {
    const cc = compileExpr('constructor')
    const pp = compileExpr('p.x')
    expect(cc.ok && pp.ok).toBe(true)
    if (cc.ok) expect(evalExpr(cc.node, { v: 5 }, -1)).toBe(-1) // inherited → fallback
    if (pp.ok) expect(evalExpr(pp.node, { p: { x: 9 } }, -1)).toBe(9) // own member → value
  })
})
