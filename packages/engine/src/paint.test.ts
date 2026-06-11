import { describe, it, expect } from 'vitest'
import {
  bakePaint,
  cssPreview,
  defaultGradient,
  lerpPaint,
  lerpTint,
  paintEquals,
  paintKey,
  primaryColor,
  solid,
  translatePaintBox,
  type Paint,
} from './paint'
import { hexToHsv, hsvToHex, normalizeHex } from './color'

const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 }

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

  it('primaryColor returns the fallback color', () => {
    expect(primaryColor(solid('#abcdef'))).toBe('#abcdef')
    expect(primaryColor(defaultGradient('radial', '#111111', '#222222'))).toBe('#111111')
  })

  it('cssPreview produces a valid CSS gradient', () => {
    expect(cssPreview(solid('#fff'))).toBe('#fff')
    expect(cssPreview(defaultGradient('linear'))).toMatch(/^linear-gradient\(90deg,/)
    expect(cssPreview(defaultGradient('radial'))).toMatch(/^radial-gradient\(circle/)
  })

  it('bakePaint anchors the box (and does not affect a solid)', () => {
    const baked = bakePaint(defaultGradient('linear'), box)
    expect(baked.type === 'linear' && baked.box).toEqual(box)
    expect(bakePaint(solid('#fff'), box)).toEqual(solid('#fff'))
  })

  it('the box is part of the key: two pieces anchored the same are continuous', () => {
    const a = bakePaint(defaultGradient('linear'), box)
    const b = bakePaint(defaultGradient('linear'), box)
    expect(paintEquals(a, b)).toBe(true) // same box -> continuous gradient
    const c = bakePaint(defaultGradient('linear'), { ...box, maxX: 200 })
    expect(paintEquals(a, c)).toBe(false)
  })

  it('translatePaintBox offsets the box', () => {
    const baked = bakePaint(defaultGradient('radial'), box)
    const moved = translatePaintBox(baked, 10, 5)
    expect(moved.type === 'radial' && moved.box).toEqual({ minX: 10, minY: 5, maxX: 110, maxY: 105 })
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
