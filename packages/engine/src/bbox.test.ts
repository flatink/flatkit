import { describe, it, expect } from 'vitest'
import { ringsBBox, regionBBox, shapeBBox, combineBBox, translateBBox, bboxIntersects } from './bbox'
import { polygonsToPath } from './path'

const sq = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
  { x: 0, y: 8 },
]

describe('bbox', () => {
  it('ringsBBox / regionBBox', () => {
    expect(ringsBBox([sq])).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 8 })
    expect(ringsBBox([])).toBeNull()
    expect(regionBBox({ id: 'r', color: '#000', path: polygonsToPath([sq]) })).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 8 })
  })

  it('shapeBBox (and empty → null)', () => {
    expect(shapeBBox([[sq]])).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 8 })
    expect(shapeBBox([])).toBeNull()
  })

  it('combineBBox unions several boxes', () => {
    expect(
      combineBBox([
        { minX: 0, minY: 0, maxX: 5, maxY: 5 },
        { minX: 3, minY: -2, maxX: 8, maxY: 4 },
      ]),
    ).toEqual({ minX: 0, minY: -2, maxX: 8, maxY: 5 })
    expect(combineBBox([])).toBeNull()
  })

  it('translateBBox / bboxIntersects', () => {
    expect(translateBBox({ minX: 0, minY: 0, maxX: 2, maxY: 2 }, 5, -3)).toEqual({ minX: 5, minY: -3, maxX: 7, maxY: -1 })
    expect(bboxIntersects({ minX: 0, minY: 0, maxX: 5, maxY: 5 }, { minX: 4, minY: 4, maxX: 9, maxY: 9 })).toBe(true)
    expect(bboxIntersects({ minX: 0, minY: 0, maxX: 2, maxY: 2 }, { minX: 5, minY: 5, maxX: 9, maxY: 9 })).toBe(false)
  })
})
