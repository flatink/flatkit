import { describe, it, expect } from 'vitest'
import { normalizeHex, splitAlpha, withAlpha, hexToRgb, rgbToHex, compositeOver, hexToHsv, hsvToHex, lerpColor } from './color'

describe('color', () => {
  it('normalizeHex expands short forms and rejects invalid input', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc')
    expect(normalizeHex('fff')).toBe('#ffffff')
    expect(normalizeHex('#12345678')).toBe('#12345678')
    expect(normalizeHex('nope')).toBeNull()
  })

  it('splitAlpha / withAlpha are inverses', () => {
    expect(splitAlpha('#ff0000')).toEqual({ rgb: '#ff0000', alpha: 1 })
    expect(splitAlpha('#ff000080').alpha).toBeCloseTo(128 / 255)
    expect(withAlpha('#ff0000', 1)).toBe('#ff0000') // opaque → no suffix
    expect(withAlpha('#ff0000', 0.5)).toBe('#ff000080')
  })

  it('hexToRgb / rgbToHex (with clamp)', () => {
    expect(hexToRgb('#3366cc')).toEqual({ r: 51, g: 102, b: 204 })
    expect(rgbToHex(51, 102, 204)).toBe('#3366cc')
    expect(rgbToHex(300, -5, 128)).toBe('#ff0080')
  })

  it('compositeOver composites an alpha over an opaque background', () => {
    expect(compositeOver('#ffffff80', '#000000')).toBe('#808080') // ~50% white over black
    expect(compositeOver('#ff0000', '#00ff00')).toBe('#ff0000') // opaque fg → fg
  })

  it('lerpColor interpolates RGB + alpha', () => {
    expect(lerpColor('#000000', '#ffffff', 0)).toBe('#000000')
    expect(lerpColor('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(lerpColor('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(lerpColor('#ff0000', '#0000ff', 0.5)).toBe('#800080')
    // interpolated alpha: opaque → transparent at the midpoint
    expect(lerpColor('#ff0000', '#ff000000', 0.5)).toBe('#ff000080')
  })

  it('hex ↔ hsv: faithful round-trip (±1 per channel)', () => {
    const hex = '#7a33cc'
    const { h, s, v } = hexToHsv(hex)
    const back = hexToRgb(hsvToHex(h, s, v))
    const orig = hexToRgb(hex)
    expect(Math.abs(back.r - orig.r)).toBeLessThanOrEqual(1)
    expect(Math.abs(back.g - orig.g)).toBeLessThanOrEqual(1)
    expect(Math.abs(back.b - orig.b)).toBeLessThanOrEqual(1)
  })
})
