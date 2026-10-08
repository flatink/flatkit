import { describe, it, expect } from 'vitest'
import { pointInRing, pointInRings, pointInRegion } from './regionHit'
import { polygonsToPath } from './path'
import type { Point, Region } from '@flatkit/types'

const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
const hole = [{ x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 3, y: 7 }]

describe('regionHit', () => {
  it('pointInRing: inside vs outside', () => {
    expect(pointInRing(square, { x: 5, y: 5 })).toBe(true)
    expect(pointInRing(square, { x: 15, y: 5 })).toBe(false)
  })

  it('pointInRings: even-odd rule (point in a hole is outside)', () => {
    expect(pointInRings([square, hole], { x: 1, y: 1 })).toBe(true) // in square, not in hole
    expect(pointInRings([square, hole], { x: 5, y: 5 })).toBe(false) // in square AND hole → outside
  })

  it('pointInRegion uses the flattened path', () => {
    const region = { id: 'r', color: '#000', path: polygonsToPath([square]) }
    expect(pointInRegion(region, { x: 5, y: 5 })).toBe(true)
    expect(pointInRegion(region, { x: -1, y: -1 })).toBe(false)
  })
})

// flatink/flatink#69 — `nonzero`: the SVG / Canvas default rule, asked for by a word on the shape.
describe('pointInRegion — fill rule', () => {
  const sq = (x0: number, y0: number, x1: number, y1: number, cw = true): Point[] =>
    cw ? [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] : [{ x: x0, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y0 }]
  const reg = (rings: Point[][], fillRule?: 'nonzero'): Region => ({ id: 'r', color: '#000', path: polygonsToPath(rings), ...(fillRule ? { fillRule } : {}) })

  it('two contours of the same direction: the overlap is out by default, in with nonzero', () => {
    const rings = [sq(0, 0, 100, 100), sq(50, 50, 150, 150)]
    expect(pointInRegion(reg(rings), { x: 75, y: 75 })).toBe(false)
    expect(pointInRegion(reg(rings, 'nonzero'), { x: 75, y: 75 })).toBe(true)
    expect(pointInRegion(reg(rings, 'nonzero'), { x: 25, y: 25 })).toBe(true)
    expect(pointInRegion(reg(rings, 'nonzero'), { x: 125, y: 25 })).toBe(false)
  })
  it('nonzero: a contour of the opposite direction cuts a hole', () => {
    const rings = [sq(0, 0, 100, 100), sq(25, 25, 75, 75, false)]
    expect(pointInRegion(reg(rings, 'nonzero'), { x: 50, y: 50 })).toBe(false)
    expect(pointInRegion(reg(rings, 'nonzero'), { x: 10, y: 10 })).toBe(true)
  })
})
