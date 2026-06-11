import { describe, it, expect } from 'vitest'
import {
  IDENTITY,
  isIdentity,
  apply,
  invert,
  compose,
  translate,
  translation,
  rotationOf,
  decompose,
  recompose,
  toSvg,
} from './transform'

describe('transform', () => {
  it('IDENTITY leaves points unchanged', () => {
    expect(apply(IDENTITY, { x: 5, y: 7 })).toEqual({ x: 5, y: 7 })
    expect(isIdentity(IDENTITY)).toBe(true)
    expect(isIdentity(translation(1, 0))).toBe(false)
  })

  it('apply(invert(t), apply(t, p)) === p (round-trip)', () => {
    const t = compose(translation(30, -10), { a: 2, b: 0.5, c: -0.3, d: 1.5, e: 0, f: 0 })
    const p = { x: 12, y: -8 }
    const back = apply(invert(t), apply(t, p))
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  })

  it('translation / translate add an offset', () => {
    expect(apply(translation(10, 20), { x: 0, y: 0 })).toEqual({ x: 10, y: 20 })
    expect(apply(translate(translation(5, 5), 3, 4), { x: 0, y: 0 })).toEqual({ x: 8, y: 9 })
  })

  it('compose chains parent then child', () => {
    const m = compose(translation(100, 0), translation(0, 50))
    expect(apply(m, { x: 0, y: 0 })).toEqual({ x: 100, y: 50 })
  })

  it('decompose / recompose: round-trip position/scale/rotation', () => {
    const d = { x: 40, y: -20, scaleX: 1.5, scaleY: 0.8, rotation: Math.PI / 5 }
    const back = decompose(recompose(d))
    expect(back.x).toBeCloseTo(d.x)
    expect(back.y).toBeCloseTo(d.y)
    expect(back.scaleX).toBeCloseTo(d.scaleX)
    expect(back.scaleY).toBeCloseTo(d.scaleY)
    expect(back.rotation).toBeCloseTo(d.rotation)
  })

  it('decompose: scaleX = 0 does NOT crush scaleY (shutter/mask starting at width 0)', () => {
    // matrix(0,0,0,1) = scaleX 0, scaleY 1 (vertical line) — not a point.
    const d = decompose({ a: 0, b: 0, c: 0, d: 1, e: 12, f: 34 })
    expect(d.scaleX).toBeCloseTo(0)
    expect(d.scaleY).toBeCloseTo(1)
    expect(d.rotation).toBeCloseTo(0)
    expect(d.x).toBeCloseTo(12)
    expect(d.y).toBeCloseTo(34)
    // round-trip: scaleX=0, scaleY=1.6
    const back = decompose(recompose({ x: 0, y: 0, scaleX: 0, scaleY: 1.6, rotation: 0 }))
    expect(back.scaleX).toBeCloseTo(0)
    expect(back.scaleY).toBeCloseTo(1.6)
  })

  it('rotationOf reads the X axis angle', () => {
    const t = recompose({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: Math.PI / 3 })
    expect(rotationOf(t)).toBeCloseTo(Math.PI / 3)
  })

  it('toSvg: empty for identity, otherwise matrix(...)', () => {
    expect(toSvg(IDENTITY)).toBe('')
    expect(toSvg(translation(3, 4))).toBe('matrix(1 0 0 1 3 4)')
  })
})
