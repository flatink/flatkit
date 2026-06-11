import { describe, it, expect } from 'vitest'
import { smoothClosedRing } from './smooth'
import {
  polygonsToPath,
  pathToPolygons,
  pathToBezier,
  transformPath,
  translatePath,
  pathBBox,
  clonePath,
  samplePathAt,
  projectToPath,
  resampleSubpath,
  lerpPath,
  type Path,
} from './path'

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]
const oct = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2
  return { x: Math.cos(a) * 10, y: Math.sin(a) * 10 }
})

describe('polygonsToPath / pathToPolygons', () => {
  it('identity round-trip on linear polygons', () => {
    const polys = [square, oct]
    expect(pathToPolygons(polygonsToPath(polys))).toEqual(polys)
  })

  it('one ring = one closed subpath without handles', () => {
    const p = polygonsToPath([square])
    expect(p.subpaths.length).toBe(1)
    expect(p.subpaths[0].closed).toBe(true)
    expect(p.subpaths[0].segments.every((s) => !s.inHandle && !s.outHandle)).toBe(true)
  })

  it('subdivides a curved cubic (handled edge → more points)', () => {
    const path: Path = {
      subpaths: [
        {
          closed: true,
          segments: [
            { anchor: { x: 0, y: 0 }, outHandle: { x: 0, y: 50 } },
            { anchor: { x: 100, y: 0 }, inHandle: { x: 100, y: 50 } },
          ],
        },
      ],
    }
    const ring = pathToPolygons(path)[0]
    expect(ring.length).toBeGreaterThan(4) // curved edge 0→1 subdivided
    expect(ring[0]).toEqual({ x: 0, y: 0 })
  })
})

describe('pathToBezier (zero-regression guard)', () => {
  it('closed subpath without handles === smoothClosedRing (square)', () => {
    const sub = polygonsToPath([square]).subpaths[0]
    expect(pathToBezier(sub)).toEqual(smoothClosedRing(square))
  })

  it('closed subpath without handles === smoothClosedRing (octagon)', () => {
    const sub = polygonsToPath([oct]).subpaths[0]
    expect(pathToBezier(sub)).toEqual(smoothClosedRing(oct))
  })

  it('returns null below 2 segments', () => {
    expect(pathToBezier({ closed: true, segments: [{ anchor: { x: 0, y: 0 } }] })).toBeNull()
  })

  it('honors explicit handles (literal cubic)', () => {
    const sub = {
      closed: false,
      segments: [
        { anchor: { x: 0, y: 0 }, outHandle: { x: 3, y: 7 } },
        { anchor: { x: 10, y: 0 }, inHandle: { x: 8, y: 9 } },
      ],
    }
    const bz = pathToBezier(sub)!
    expect(bz.segs[0].c1).toEqual({ x: 3, y: 7 })
    expect(bz.segs[0].c2).toEqual({ x: 8, y: 9 })
    expect(bz.segs[0].p).toEqual({ x: 10, y: 0 })
  })
})

describe('transformPath / translatePath / pathBBox / clonePath', () => {
  it('translatePath offsets anchors and handles', () => {
    const path: Path = {
      subpaths: [{ closed: false, segments: [{ anchor: { x: 1, y: 2 }, outHandle: { x: 3, y: 4 } }] }],
    }
    const t = translatePath(path, 10, 20)
    expect(t.subpaths[0].segments[0].anchor).toEqual({ x: 11, y: 22 })
    expect(t.subpaths[0].segments[0].outHandle).toEqual({ x: 13, y: 24 })
  })

  it('transformPath applies an affine (scale ×2)', () => {
    const path = polygonsToPath([square])
    const t = transformPath(path, { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 })
    expect(t.subpaths[0].segments[1].anchor).toEqual({ x: 20, y: 0 })
  })

  it('pathBBox encloses anchors and handles', () => {
    const path: Path = {
      subpaths: [{ closed: false, segments: [{ anchor: { x: 0, y: 0 }, outHandle: { x: 0, y: 50 } }, { anchor: { x: 10, y: 0 } }] }],
    }
    expect(pathBBox(path)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 50 })
  })

  it('clonePath is a deep clone', () => {
    const path = polygonsToPath([square])
    const c = clonePath(path)
    c.subpaths[0].segments[0].anchor.x = 999
    expect(path.subpaths[0].segments[0].anchor.x).toBe(0)
  })
})

describe('samplePathAt (motion guides)', () => {
  // Horizontal segment [0,0] → [100,0] (open subpath, no handles).
  const line: Path = { subpaths: [{ closed: false, segments: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] }] }

  it('endpoints: t=0 → start, t=1 → end', () => {
    expect(samplePathAt(line, 0).point).toEqual({ x: 0, y: 0 })
    expect(samplePathAt(line, 1).point).toEqual({ x: 100, y: 0 })
  })

  it('midpoint: t=0.5 → middle (arc length)', () => {
    expect(samplePathAt(line, 0.5).point.x).toBeCloseTo(50, 5)
  })

  it('unit tangent in the direction of travel', () => {
    const { tangent } = samplePathAt(line, 0.3)
    expect(tangent.x).toBeCloseTo(1, 5)
    expect(tangent.y).toBeCloseTo(0, 5)
  })

  it('constant speed: two unequal-length segments, t=0.5 = mid-LENGTH', () => {
    // [0,0]→[10,0] (len 10) then [10,0]→[10,90] (len 90); total 100, mid = 50 → on the 2nd segment at y=40.
    const p: Path = { subpaths: [{ closed: false, segments: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 90 } }] }] }
    const { point } = samplePathAt(p, 0.5)
    expect(point.x).toBeCloseTo(10, 5)
    expect(point.y).toBeCloseTo(40, 5)
  })

  it('outside [0,1]: clamped to the endpoints (the object stays on the path, Flash style)', () => {
    expect(samplePathAt(line, -0.5).point).toEqual({ x: 0, y: 0 }) // backtrack absorbed → stays at start
    expect(samplePathAt(line, 1.5).point).toEqual({ x: 100, y: 0 }) // overshoot absorbed → stays at end
  })

  it('falls back on an empty path', () => {
    expect(samplePathAt({ subpaths: [] }, 0.5)).toEqual({ point: { x: 0, y: 0 }, tangent: { x: 1, y: 0 } })
  })
})

describe('projectToPath (guide layer: pose → parameter along the path)', () => {
  const line: Path = { subpaths: [{ closed: false, segments: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] }] }

  it('endpoints and middle', () => {
    expect(projectToPath(line, { x: 0, y: 0 })).toBeCloseTo(0, 5)
    expect(projectToPath(line, { x: 100, y: 0 })).toBeCloseTo(1, 5)
    expect(projectToPath(line, { x: 50, y: 0 })).toBeCloseTo(0.5, 5)
  })

  it('projects the nearest point (off the path)', () => {
    expect(projectToPath(line, { x: 30, y: 40 })).toBeCloseTo(0.3, 5) // projected at x=30
    expect(projectToPath(line, { x: -20, y: 5 })).toBeCloseTo(0, 5) // clamp to start
    expect(projectToPath(line, { x: 200, y: 5 })).toBeCloseTo(1, 5) // clamp to end
  })

  it('inverse of samplePathAt (chevron)', () => {
    const chevron: Path = { subpaths: [{ closed: false, segments: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 50, y: -50 } }, { anchor: { x: 100, y: 0 } }] }] }
    const p = samplePathAt(chevron, 0.5).point // apex (50,-50)
    expect(projectToPath(chevron, p)).toBeCloseTo(0.5, 4)
  })
})

describe('resampleSubpath / lerpPath (morph)', () => {
  const mkSquare = (x: number, y: number, s: number): Path => ({
    subpaths: [{ closed: true, segments: [{ anchor: { x, y } }, { anchor: { x: x + s, y } }, { anchor: { x: x + s, y: y + s } }, { anchor: { x, y: y + s } }] }],
  })

  it('resampleSubpath: n evenly spaced points (closed)', () => {
    const pts = resampleSubpath(mkSquare(0, 0, 10).subpaths[0], 8)
    expect(pts).toHaveLength(8)
  })

  it('lerpPath t=0 / t=1 ≈ endpoints (by bbox)', () => {
    const a = mkSquare(0, 0, 10)
    const b = mkSquare(100, 50, 20)
    const m0 = pathBBox(lerpPath(a, b, 0))!
    expect(m0.minX).toBeCloseTo(0, 0)
    expect(m0.maxX).toBeCloseTo(10, 0)
    const m1 = pathBBox(lerpPath(a, b, 1))!
    expect(m1.minX).toBeCloseTo(100, 0)
    expect(m1.maxX).toBeCloseTo(120, 0)
  })

  it('lerpPath midway: center = middle of the two centers', () => {
    const a = mkSquare(0, 0, 10) // center (5,5)
    const b = mkSquare(100, 0, 10) // center (105,5)
    const m = pathBBox(lerpPath(a, b, 0.5))!
    expect((m.minX + m.maxX) / 2).toBeCloseTo(55, 0) // middle of 5 and 105
  })
})
