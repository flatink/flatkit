import { describe, it, expect } from 'vitest'
import { smoothClosedRing } from './smooth'

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

describe('smoothClosedRing', () => {
  it('returns null below 3 points', () => {
    expect(smoothClosedRing([])).toBeNull()
    expect(
      smoothClosedRing([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBeNull()
  })

  it('one Bezier per edge, starting at the first vertex', () => {
    const sm = smoothClosedRing(square)!
    expect(sm.segs.length).toBe(square.length)
    expect(sm.start).toEqual(square[0])
    expect(sm.segs[0].p).toEqual(square[1])
  })

  it('preserves sharp angles: on a square, controls stay on the edge (straight segment)', () => {
    const sm = smoothClosedRing(square)!
    // edge 0→1 horizontal (y=0): c1 and c2 must stay at y=0
    expect(sm.segs[0].c1.y).toBeCloseTo(0)
    expect(sm.segs[0].c2.y).toBeCloseTo(0)
  })

  it('smooths gentle vertices: controls leave the edge (octagon)', () => {
    const oct = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2
      return { x: Math.cos(a) * 10, y: Math.sin(a) * 10 }
    })
    const sm = smoothClosedRing(oct)!
    const seg = sm.segs[0]
    // distance (×2 area) of control c1 to the line (oct0→oct1): non-zero = smoothed
    const off = Math.abs(
      (seg.c1.x - oct[0].x) * (oct[1].y - oct[0].y) - (seg.c1.y - oct[0].y) * (oct[1].x - oct[0].x),
    )
    expect(off).toBeGreaterThan(0.01)
  })
})
