import { describe, it, expect } from 'vitest'
import { parsePathData, ellipsePath, rectPath, polyPath, linePath } from './svgPath'
import { pathToPolygons, pathBBox, pathToBezier } from './path'

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

// flatink/flatink#8, second half — `L` is a LINE. A path made only of lines used to be read as free-hand
// material and rounded at every vertex turning by less than 60 degrees: a hexagon written by hand came
// out soft. Material is now what says so (`{ smooth: true }`, the `smooth` word of the text format).
describe('parsePathData — a path made only of lines', () => {
  const straightEverywhere = (path: ReturnType<typeof parsePathData>): boolean => {
    const bz = pathToBezier(path.subpaths[0])!
    return bz.segs.every((s, i) => {
      const p0 = i === 0 ? bz.start : bz.segs[i - 1].p
      const cross = (a: { x: number; y: number }) => Math.abs((s.p.x - p0.x) * (a.y - p0.y) - (s.p.y - p0.y) * (a.x - p0.x))
      return cross(s.c1) < 1e-9 && cross(s.c2) < 1e-9
    })
  }
  const TRAPEZOID = 'M20 100 L60 40 L160 40 L200 100 Z' // two vertices turn by less than 60 degrees
  const HEXAGON = 'M100 0 L50 87 L-50 87 L-100 0 L-50 -87 L50 -87 Z'
  it('is drawn with straight sides, soft angles included', () => {
    expect(straightEverywhere(parsePathData(TRAPEZOID))).toBe(true)
    expect(straightEverywhere(parsePathData(HEXAGON))).toBe(true)
    expect(straightEverywhere(parsePathData('M0 0 L40 10 L80 30 L120 60'))).toBe(true) // open
  })
  it('`smooth` keeps it as free-hand material: the soft vertices are rounded', () => {
    expect(straightEverywhere(parsePathData(TRAPEZOID, { smooth: true }))).toBe(false)
    expect(parsePathData(TRAPEZOID, { smooth: true }).subpaths[0].segments.every((s) => !s.inHandle && !s.outHandle)).toBe(true)
  })
  it('a polygon whose corners are all sharp carries nothing extra', () => {
    const square = parsePathData('M0 0 L10 0 L10 10 L0 10 Z')
    expect(square.subpaths[0].segments).toEqual([{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }, { anchor: { x: 0, y: 10 } }])
  })
  it('the anchors are the points that were written, either way', () => {
    const pts = (p: ReturnType<typeof parsePathData>) => p.subpaths[0].segments.map((s) => [s.anchor.x, s.anchor.y])
    expect(pts(parsePathData(TRAPEZOID))).toEqual([[20, 100], [60, 40], [160, 40], [200, 100]])
    expect(pts(parsePathData(TRAPEZOID, { smooth: true }))).toEqual(pts(parsePathData(TRAPEZOID)))
  })
})

// Reported by the editor after the move to 0.36: `polyPath` says "straight segments" and returned bare
// anchors — free-hand material, rounded at gentle turns and exported with `smooth`. An SVG `<polygon>`
// imported through it stayed soft while the same points given as a `<path>` came out straight.
describe('polyPath — a polygon has straight sides', () => {
  const octagon = Array.from({ length: 8 }, (_, i) => ({ x: 100 + 80 * Math.cos((i * Math.PI) / 4), y: 100 + 80 * Math.sin((i * Math.PI) / 4) }))
  const straight = (sub: ReturnType<typeof polyPath>['subpaths'][number]): boolean => {
    const bz = pathToBezier(sub)!
    return bz.segs.every((s, i) => {
      const p0 = i === 0 ? bz.start : bz.segs[i - 1].p
      const cross = (a: { x: number; y: number }) => Math.abs((s.p.x - p0.x) * (a.y - p0.y) - (s.p.y - p0.y) * (a.x - p0.x))
      return cross(s.c1) < 1e-9 && cross(s.c2) < 1e-9
    })
  }
  it('gentle turns included, closed or open', () => {
    expect(straight(polyPath(octagon, true).subpaths[0])).toBe(true)
    expect(straight(polyPath(octagon.slice(0, 5), false).subpaths[0])).toBe(true)
  })
  it('draws exactly what the same points written as path data draw', () => {
    const d = `M${octagon.map((p) => `${p.x} ${p.y}`).join(' L')} Z`
    expect(pathToBezier(polyPath(octagon, true).subpaths[0])).toEqual(pathToBezier(parsePathData(d).subpaths[0]))
  })
  it('a rectangle (all corners sharp) is still bare anchors', () => {
    expect(rectPath(0, 0, 40, 20).subpaths[0].segments.every((s) => !s.inHandle && !s.outHandle)).toBe(true)
  })
})
