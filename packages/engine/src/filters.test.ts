import { describe, it, expect } from 'vitest'
import { cssFilterString, lerpFilters, defaultFilter, type Filter } from './filters'
import { splitAlpha } from './color'

const splitAlphaLocal = (c: string) => splitAlpha(c).alpha

describe('filters — cssFilterString', () => {
  it('empty → empty string', () => {
    expect(cssFilterString(undefined)).toBe('')
    expect(cssFilterString([])).toBe('')
  })

  it('maps each type to a CSS function', () => {
    expect(cssFilterString([{ type: 'blur', radius: 5 }])).toBe('blur(5px)')
    expect(cssFilterString([{ type: 'shadow', dx: 2, dy: 3, blur: 4, color: '#000' }])).toBe('drop-shadow(2px 3px 4px #000)')
    expect(cssFilterString([{ type: 'glow', blur: 6, color: '#fff' }])).toBe('drop-shadow(0 0 6px #fff)')
  })

  it('adjust: only emits the non-neutral components', () => {
    expect(cssFilterString([{ type: 'adjust', brightness: 1, contrast: 1, saturate: 1, hue: 0 }])).toBe('')
    expect(cssFilterString([{ type: 'adjust', saturate: 2 }])).toBe('saturate(2)')
    expect(cssFilterString([{ type: 'adjust', brightness: 1.2, hue: 90 }])).toBe('brightness(1.2) hue-rotate(90deg)')
  })

  it('stack = composition in order', () => {
    const fs: Filter[] = [{ type: 'blur', radius: 2 }, { type: 'adjust', saturate: 0.5 }]
    expect(cssFilterString(fs)).toBe('blur(2px) saturate(0.5)')
  })

  it('clamps negative radii to 0', () => {
    expect(cssFilterString([{ type: 'blur', radius: -3 }])).toBe('blur(0px)')
  })
})

describe('filters — lerpFilters', () => {
  it('interpolates params of matched stacks (same type/index)', () => {
    const a: Filter[] = [{ type: 'blur', radius: 0 }]
    const b: Filter[] = [{ type: 'blur', radius: 10 }]
    expect(lerpFilters(a, b, 0.5)).toEqual([{ type: 'blur', radius: 5 }])
  })

  it('interpolates a shadow (offsets + color)', () => {
    const a: Filter[] = [{ type: 'shadow', dx: 0, dy: 0, blur: 0, color: '#000000' }]
    const b: Filter[] = [{ type: 'shadow', dx: 10, dy: 20, blur: 4, color: '#ffffff' }]
    const m = lerpFilters(a, b, 0.5)![0] as Extract<Filter, { type: 'shadow' }>
    expect(m.dx).toBeCloseTo(5)
    expect(m.dy).toBeCloseTo(10)
    expect(m.blur).toBeCloseTo(2)
    expect(m.color.toLowerCase()).toBe('#808080')
  })

  it('filter present on one side only (extra index) → fade to/from neutral', () => {
    const a: Filter[] = [{ type: 'blur', radius: 4 }]
    const b: Filter[] = [{ type: 'blur', radius: 4 }, { type: 'glow', blur: 8, color: '#ffffff' }]
    const m = lerpFilters(a, b, 0.5)!
    expect(m).toHaveLength(2)
    expect(m[0]).toEqual({ type: 'blur', radius: 4 }) // unchanged (present on both sides)
    const glow = m[1] as Extract<Filter, { type: 'glow' }>
    expect(glow.type).toBe('glow') // glow fading in (alpha ~0.5)
    expect(splitAlphaLocal(glow.color)).toBeCloseTo(0.5, 1)
  })

  it('one empty side → the blur fades (radius → 0), not an abrupt disappearance', () => {
    const b: Filter[] = [{ type: 'blur', radius: 4 }]
    const mIn = lerpFilters(undefined, b, 0.25)!
    expect((mIn[0] as Extract<Filter, { type: 'blur' }>).radius).toBeCloseTo(1) // fade in: 0→4 at t=0.25
    const mOut = lerpFilters(b, undefined, 0.75)!
    expect((mOut[0] as Extract<Filter, { type: 'blur' }>).radius).toBeCloseTo(1) // fade out: 4→0 at t=0.75
  })
})

describe('filters — defaultFilter', () => {
  it('provides a neutral/soft filter per type', () => {
    expect(defaultFilter('blur').type).toBe('blur')
    expect(defaultFilter('adjust')).toEqual({ type: 'adjust', brightness: 1, contrast: 1, saturate: 1, hue: 0 })
  })
})
