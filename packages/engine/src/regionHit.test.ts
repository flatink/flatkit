import { describe, it, expect } from 'vitest'
import { pointInRing, pointInRings, pointInRegion } from './regionHit'
import { polygonsToPath } from './path'

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
