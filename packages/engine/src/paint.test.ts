import { describe, it, expect } from 'vitest'
import { defaultGradient, lerpPaint, lerpTint, paintEquals, paintKey, resolveColorRef, resolveStopColor, resolveTintColor, solid, type Paint } from './paint'
import { hexToHsv, hsvToHex, normalizeHex } from './color'
import type { Stop } from '@flatkit/types'

describe('paint', () => {
  it('equality by key: same solids merge, different paints do not', () => {
    expect(paintEquals(solid('#FF0000'), solid('#ff0000'))).toBe(true)
    expect(paintEquals(solid('#ff0000'), solid('#0000ff'))).toBe(false)
    const g = defaultGradient('linear')
    if (g.type === 'linear') {
      expect(paintEquals(g, { ...g, angle: 45 })).toBe(false)
    }
    expect(paintEquals(g, JSON.parse(JSON.stringify(g)))).toBe(true)
  })

  it('a gradient and a solid never share the same key', () => {
    expect(paintKey(solid('#e63946'))).not.toBe(paintKey(defaultGradient('linear')))
  })
})

describe('lerpPaint / lerpTint', () => {
  it('solid → solid: interpolated color', () => {
    const r = lerpPaint(solid('#000000'), solid('#ffffff'), 0.5)
    expect(r).toEqual({ type: 'solid', color: '#808080' })
  })

  it('linear → linear: angle + stops interpolated', () => {
    const a: Paint = { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ff0000' }] }
    const b: Paint = { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#0000ff' }] }
    const r = lerpPaint(a, b, 0.5)
    expect(r.type).toBe('linear')
    if (r.type === 'linear') {
      expect(r.angle).toBe(45)
      expect(r.stops[0].color).toBe('#808080')
      expect(r.stops[1].color).toBe('#800080')
    }
  })

  it('different types → switch at mid-course (no morph)', () => {
    const a = solid('#ff0000')
    const b = defaultGradient('linear')
    expect(lerpPaint(a, b, 0.25)).toBe(a)
    expect(lerpPaint(a, b, 0.75)).toBe(b)
  })

  it('stops of different sizes → keep `a`', () => {
    const a: Paint = { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }] }
    const b: Paint = { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000' }, { offset: 0.5, color: '#888' }, { offset: 1, color: '#fff' }] }
    const r = lerpPaint(a, b, 0.5)
    expect(r.type === 'linear' && r.stops.length).toBe(2)
  })

  it('lerpTint interpolates color + amount', () => {
    expect(lerpTint({ color: '#000000', amount: 0 }, { color: '#ffffff', amount: 1 }, 0.5)).toEqual({ color: '#808080', amount: 0.5 })
  })
})

describe('color', () => {
  it('normalizeHex handles #abc and case', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('ff8800')).toBe('#ff8800')
    expect(normalizeHex('xyz')).toBeNull()
  })

  it('hexToHsv and hsvToHex are (almost) inverses', () => {
    for (const hex of ['#e63946', '#1d3557', '#2a9d8f', '#000000', '#ffffff']) {
      const { h, s, v } = hexToHsv(hex)
      expect(hsvToHex(h, s, v)).toBe(hex)
    }
  })
})

describe('color refs (param + alpha) — fill/stop/tint unification', () => {
  const scope = { teinte: '#7ec8ff' }

  it('a plain hex (no param/no alpha) passes through untouched', () => {
    expect(resolveColorRef('#ffe9a8', undefined, undefined, scope)).toBe('#ffe9a8')
    expect(resolveColorRef('#ffe9a8', undefined, undefined, undefined)).toBe('#ffe9a8')
  })

  it('a param resolves against the scope, falling back to the literal hex when unbound', () => {
    expect(resolveColorRef('#ffe9a8', 'teinte', undefined, scope)).toBe('#7ec8ff')
    expect(resolveColorRef('#ffe9a8', 'teinte', undefined, {})).toBe('#ffe9a8') // unresolved → fallback
    expect(resolveColorRef('#ffe9a8', 'teinte', undefined, undefined)).toBe('#ffe9a8')
  })

  it('alpha OVERRIDES the channel (a 6-digit param hue gains the stop alpha)', () => {
    expect(resolveColorRef('#ffe9a8', 'teinte', 0.8, scope)).toBe('#7ec8ffcc') // 0.8*255 ≈ 0xcc
    expect(resolveColorRef('#ffe9a8', 'teinte', 0, scope)).toBe('#7ec8ff00')
    expect(resolveColorRef('#112233', undefined, 0.5, scope)).toBe('#11223380') // alpha on a literal too
  })

  it('resolveStopColor / resolveTintColor wrap the same primitive', () => {
    const s: Stop = { offset: 0, color: '#ffe9a8', param: 'teinte', alpha: 0.8 }
    expect(resolveStopColor(s, scope)).toBe('#7ec8ffcc')
    expect(resolveTintColor({ color: '#ffe9a8', param: 'teinte', amount: 0.5 }, scope)).toBe('#7ec8ff')
  })

  it('a param stop does NOT merge with a literal stop or a different param (paintKey distinguishes)', () => {
    const base = defaultGradient('radial')
    if (base.type !== 'radial') throw new Error('radial')
    const litA: Paint = { ...base, stops: [{ offset: 0, color: '#ffe9a8' }, { offset: 1, color: '#000000' }] }
    const paramA: Paint = { ...base, stops: [{ offset: 0, color: '#ffe9a8', param: 'teinte', alpha: 0.8 }, { offset: 1, color: '#000000' }] }
    const paramB: Paint = { ...base, stops: [{ offset: 0, color: '#ffe9a8', param: 'autre', alpha: 0.8 }, { offset: 1, color: '#000000' }] }
    expect(paintEquals(litA, paramA)).toBe(false)
    expect(paintEquals(paramA, paramB)).toBe(false)
    expect(paintKey(paramA)).toBe(paintKey({ ...paramA })) // same param/alpha → mergeable
  })

  it('lerpStops / lerpTint carry the param binding (resolution stays at render)', () => {
    const a: Paint = { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#ffe9a8', param: 'teinte', alpha: 0.8 }] }
    const b: Paint = { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#000000', param: 'teinte', alpha: 0 }] }
    const mid = lerpPaint(a, b, 0.5)
    if (mid.type !== 'linear') throw new Error('linear')
    expect(mid.stops[0].param).toBe('teinte')
    expect(mid.stops[0].alpha).toBeCloseTo(0.4)
    expect(lerpTint({ color: '#000', param: 'teinte', amount: 0 }, { color: '#fff', param: 'teinte', amount: 1 }, 0.5).param).toBe('teinte')
  })
})
