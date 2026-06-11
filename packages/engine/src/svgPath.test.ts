import { describe, it, expect } from 'vitest'
import { parsePathData, ellipsePath, rectPath, polyPath, linePath } from './svgPath'
import { pathToPolygons, pathBBox } from './path'

describe('parsePathData', () => {
  it('M/L/Z → closed subpath, correct anchors, no handles', () => {
    const p = parsePathData('M0 0 L10 0 L10 10 Z')
    expect(p.subpaths.length).toBe(1)
    expect(p.subpaths[0].closed).toBe(true)
    const segs = p.subpaths[0].segments
    expect(segs.map((s) => s.anchor)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
    expect(segs.every((s) => !s.inHandle && !s.outHandle)).toBe(true)
  })

  it('C → handles distributed (out on the previous, in on the new)', () => {
    const segs = parsePathData('M0 0 C1 2 3 4 5 6').subpaths[0].segments
    expect(segs[0].outHandle).toEqual({ x: 1, y: 2 })
    expect(segs[1].anchor).toEqual({ x: 5, y: 6 })
    expect(segs[1].inHandle).toEqual({ x: 3, y: 4 })
  })

  it('Q → converted to a cubic', () => {
    const segs = parsePathData('M0 0 Q3 3 6 0').subpaths[0].segments
    expect(segs[0].outHandle).toEqual({ x: 2, y: 2 }) // 0 + 2/3*(3-0)
    expect(segs[1].anchor).toEqual({ x: 6, y: 0 })
    expect(segs[1].inHandle).toEqual({ x: 4, y: 2 }) // 6 + 2/3*(3-6) = 4
  })

  it('relative commands', () => {
    const segs = parsePathData('m10 10 l5 0 l0 5').subpaths[0].segments
    expect(segs.map((s) => s.anchor)).toEqual([{ x: 10, y: 10 }, { x: 15, y: 10 }, { x: 15, y: 15 }])
  })

  it('H/V', () => {
    const segs = parsePathData('M0 0 H10 V10').subpaths[0].segments
    expect(segs.map((s) => s.anchor)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
  })

  it('A (quarter circle) → cubics, correct endpoints', () => {
    const p = parsePathData('M10 0 A10 10 0 0 1 0 10')
    const segs = p.subpaths[0].segments
    expect(segs[0].anchor).toEqual({ x: 10, y: 0 })
    const last = segs[segs.length - 1]
    expect(last.anchor.x).toBeCloseTo(0)
    expect(last.anchor.y).toBeCloseTo(10)
    expect(last.inHandle).toBeTruthy() // curve (not a line)
    // bbox of the quarter circle ≈ [0..10] × [0..10]
    const b = pathBBox(p)!
    expect(b.maxX).toBeCloseTo(10)
    expect(b.maxY).toBeCloseTo(10, 0)
  })

  it('multiple subpaths (repeated M)', () => {
    const p = parsePathData('M0 0 L5 0 Z M10 10 L15 10')
    expect(p.subpaths.length).toBe(2)
    expect(p.subpaths[0].closed).toBe(true)
    expect(p.subpaths[1].closed).toBe(false)
  })
})

describe('shape builders', () => {
  it('ellipsePath: bbox = [cx±rx, cy±ry], closed', () => {
    const p = ellipsePath(50, 40, 30, 20)
    expect(p.subpaths[0].closed).toBe(true)
    const b = pathBBox(p)!
    expect(b.minX).toBeCloseTo(20)
    expect(b.maxX).toBeCloseTo(80)
    expect(b.minY).toBeCloseTo(20)
    expect(b.maxY).toBeCloseTo(60)
  })

  it('rectPath without radius = 4 straight corners', () => {
    const p = rectPath(0, 0, 10, 8)
    expect(p.subpaths[0].segments.length).toBe(4)
    expect(p.subpaths[0].segments.every((s) => !s.inHandle && !s.outHandle)).toBe(true)
  })

  it('rounded rectPath: bbox preserved, curves at the corners', () => {
    const p = rectPath(0, 0, 100, 60, 12, 12)
    const b = pathBBox(p)!
    expect(b.minX).toBeCloseTo(0)
    expect(b.maxX).toBeCloseTo(100)
    expect(p.subpaths[0].segments.some((s) => s.inHandle || s.outHandle)).toBe(true)
  })

  it('polyPath closed / linePath open', () => {
    expect(polyPath([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], true).subpaths[0].closed).toBe(true)
    const l = linePath(0, 0, 10, 10)
    expect(l.subpaths[0].closed).toBe(false)
    expect(pathToPolygons(l)[0].length).toBe(2)
  })
})
