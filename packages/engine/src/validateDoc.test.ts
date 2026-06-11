import { describe, it, expect } from 'vitest'
import { sanitizeDoc, MAX_DIMENSION } from './validateDoc'

describe('validateDoc — sanitizeDoc', () => {
  it('rejects a non-object top level', () => {
    expect(() => sanitizeDoc(null)).toThrow()
    expect(() => sanitizeDoc(42)).toThrow()
    expect(() => sanitizeDoc('x')).toThrow()
    expect(() => sanitizeDoc([])).toThrow() // arrays are not Docs
  })

  it('clamps page dimensions and defaults missing arrays', () => {
    const d = sanitizeDoc({ width: 1e9, height: -5 })
    expect(d.width).toBe(MAX_DIMENSION) // giant canvas → clamped
    expect(d.height).toBe(1) // negative/zero → 1
    expect(d.layers).toEqual([])
    expect(d.symbols).toEqual([])
  })

  it('coerces non-finite dimensions to the default (not the cap)', () => {
    const d = sanitizeDoc({ width: Number.NaN, height: Infinity, layers: [], symbols: [] })
    expect(d.width).toBe(512) // NaN → default
    expect(d.height).toBe(512) // Infinity is not finite → default, never the raw value
  })

  it('strips prototype-polluting variable keys (from parsed JSON)', () => {
    // JSON.parse creates a REAL own "__proto__" key — the classic pollution vector.
    const raw: unknown = JSON.parse('{"width":100,"height":100,"layers":[],"symbols":[],"variables":{"score":3,"__proto__":9,"constructor":1,"prototype":2,"ok":7}}')
    const d = sanitizeDoc(raw)
    expect(d.variables).toEqual({ score: 3, ok: 7 })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('drops non-numeric variables and empties to undefined', () => {
    const raw: unknown = JSON.parse('{"width":10,"height":10,"layers":[],"symbols":[],"variables":{"a":"oops","b":[1,2],"c":[1,"x"]}}')
    const d = sanitizeDoc(raw)
    expect(d.variables).toEqual({ b: [1, 2] }) // string dropped, mixed array dropped
  })

  it('preserves valid fields untouched', () => {
    const d = sanitizeDoc({
      width: 480, height: 320, layers: [], symbols: [],
      assets: [{ id: 'a', kind: 'image', name: 'x', mime: 'image/png', data: 'data:image/png;base64,AAAA' }],
    })
    expect(d.width).toBe(480)
    expect(d.height).toBe(320)
    expect(d.assets?.length).toBe(1)
  })
})
