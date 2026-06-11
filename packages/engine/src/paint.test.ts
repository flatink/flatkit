import { describe, it, expect } from 'vitest'
import { defaultGradient, lerpPaint, lerpTint, paintEquals, paintKey, solid, type Paint } from './paint'
import { hexToHsv, hsvToHex, normalizeHex } from './color'

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
