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
  makePathSampler,
  normalizeClosedForText,
  trimPath,
  pathArcLength,
  type Path,
} from './path'
import { circlePath, parsePathData } from './svgPath'

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

  // Memoization (hit-test hot path): a path's geometry is invariant, so flatten ONCE and reuse — re-flattening
  // every Bezier on every mouse-move was the real cursor lag (subdivision + GC churn). Cache key = path identity.
  const curved = (): Path => ({ subpaths: [{ closed: true, segments: [
    { anchor: { x: 0, y: 0 }, outHandle: { x: 0, y: 50 } },
    { anchor: { x: 100, y: 0 }, inHandle: { x: 100, y: 50 } },
  ] }] })

  it('memoizes by path identity: the same object returns the SAME array (no re-flatten)', () => {
    const path = curved()
    expect(pathToPolygons(path)).toBe(pathToPolygons(path)) // cache hit → identical reference
  })

  it('a distinct path object is re-flattened (fresh array, identical geometry)', () => {
    const a = pathToPolygons(curved())
    const b = pathToPolygons(curved())
    expect(b).not.toBe(a) // different objects → different cache slots…
    expect(b).toEqual(a) // …but the same flattened rings
  })

  it('a non-default tolerance bypasses the cache and never pollutes it', () => {
    const path = curved()
    const fine = pathToPolygons(path) // default tol → cached
    const coarse = pathToPolygons(path, 50) // coarse → fewer subdivisions, NOT served the cached fine rings
    expect(coarse).not.toBe(fine)
    expect(coarse[0].length).toBeLessThan(fine[0].length)
    expect(pathToPolygons(path)).toBe(fine) // the default-tol cache is still intact
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

describe('makePathSampler (text-on-path arc-length sampler)', () => {
  it('horizontal line: length, endpoints, midpoint, tangent', () => {
    const s = makePathSampler(parsePathData('M0 0L100 0'))
    expect(s.length).toBeCloseTo(100, 5)
    expect(s.at(0).point).toMatchObject({ x: expect.closeTo(0, 5), y: expect.closeTo(0, 5) })
    expect(s.at(100).point.x).toBeCloseTo(100, 5)
    expect(s.at(50).point.x).toBeCloseTo(50, 5)
    expect(s.at(30).tangent).toMatchObject({ x: expect.closeTo(1, 5), y: expect.closeTo(0, 5) })
  })

  it('clamps arc length to [0, length]', () => {
    const s = makePathSampler(parsePathData('M0 0L100 0'))
    expect(s.at(-20).point.x).toBeCloseTo(0, 5)
    expect(s.at(999).point.x).toBeCloseTo(100, 5)
  })

  it('L-shaped polyline: samples the second segment + turns the tangent', () => {
    const s = makePathSampler(parsePathData('M0 0L100 0L100 100')) // 90° corner, length 200
    expect(s.length).toBeCloseTo(200, 5)
    const half = s.at(150) // 50px up the vertical leg
    expect(half.point).toMatchObject({ x: expect.closeTo(100, 5), y: expect.closeTo(50, 5) })
    expect(half.tangent).toMatchObject({ x: expect.closeTo(0, 5), y: expect.closeTo(1, 5) })
  })

  it('degenerate (empty) path → zero length, safe fallback', () => {
    const s = makePathSampler({ subpaths: [] })
    expect(s.length).toBe(0)
    expect(s.at(10)).toEqual({ point: { x: 0, y: 0 }, tangent: { x: 1, y: 0 } })
  })

  it('reports `closed` from the traversed subpath (not subpaths[0])', () => {
    expect(makePathSampler(circlePath(100, 100, 50)).closed).toBe(true)
    expect(makePathSampler(parsePathData('M0 0L100 0')).closed).toBe(false)
    // A leading EMPTY subpath must not flip the reading: closed comes from the first non-empty subpath.
    const withEmpty: Path = { subpaths: [{ closed: false, segments: [] }, ...circlePath(100, 100, 50).subpaths] }
    expect(makePathSampler(withEmpty).closed).toBe(true)
  })

  it('coincident polyline points never yield a zero (NaN-prone) tangent', () => {
    // Duplicate the start point — the dedup keeps every tangent well-defined.
    const dup: Path = { subpaths: [{ closed: false, segments: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] }] }
    const tan = makePathSampler(dup).at(0).tangent
    expect(Math.hypot(tan.x, tan.y)).toBeCloseTo(1, 5) // unit tangent, not {0,0}
  })
})

describe('normalizeClosedForText (top-anchored, tangent +x for closed sources)', () => {
  it('circle: re-anchors at the topmost point, forward tangent points +x', () => {
    const out = normalizeClosedForText(circlePath(100, 100, 50))
    expect(out.subpaths[0].closed).toBe(true)
    const first = out.subpaths[0].segments[0].anchor
    expect(first.y).toBeCloseTo(50, 0) // topmost (min-y) point of the circle
    expect(first.x).toBeCloseTo(100, 0) // centered above the circle
    // Going forward from the top, the curve reads left→right (upright label over the top).
    expect(makePathSampler(out).at(0).tangent.x).toBeGreaterThan(0)
  })

  it('open path is returned unchanged (author owns orientation)', () => {
    const open = parsePathData('M0 80 C 120 0 360 0 480 80')
    expect(normalizeClosedForText(open)).toBe(open) // same reference, no reparam
  })
})

// `draw`: how much of an outline is stroked, measured in ARC LENGTH — the same measure `samplePathAt` /
// `projectToPath` (hence a `trace` interactor's progress) walk, so ink under a finger lands where the
// finger is, not where its x-coordinate is.
describe('trimPath (stroke extent by arc length)', () => {
  const len = (pts: { x: number; y: number }[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0)

  it('a straight line: the window is measured in length, from the start', () => {
    const line = parsePathData('M0 0L100 0')
    expect(pathArcLength(line)).toBeCloseTo(100, 6)
    const half = trimPath(line, 0, 0.5)
    expect(half).toHaveLength(1)
    expect(half[0].pts[0]).toEqual({ x: 0, y: 0 })
    expect(half[0].pts[half[0].pts.length - 1].x).toBeCloseTo(50, 6)
    const mid = trimPath(line, 0.25, 0.75) // comet window: both ends cut
    expect(mid[0].pts[0].x).toBeCloseTo(25, 6)
    expect(mid[0].pts[mid[0].pts.length - 1].x).toBeCloseTo(75, 6)
  })

  it('the cut lands where the SAME arc-length parameter puts `samplePathAt` (the `trace` measure)', () => {
    const curve = parsePathData('M0 300C250 100 350 500 500 300') // the shape of a tracing exercise
    for (const t of [0.1, 0.37, 0.5, 0.83]) {
      const tip = trimPath(curve, 0, t)[0].pts.at(-1)!
      const ref = samplePathAt(curve, t).point
      expect(Math.hypot(tip.x - ref.x, tip.y - ref.y)).toBeLessThan(0.5) // < half a pixel, i.e. under a stroke width
    }
  })

  it('subpaths are traversed IN ORDER (the first is drawn whole before the next starts)', () => {
    const two = parsePathData('M0 0L100 0M0 50L100 50') // two 100 px strokes, total 200
    expect(pathArcLength(two)).toBeCloseTo(200, 6)
    expect(trimPath(two, 0, 0.25)).toHaveLength(1) // still inside the FIRST subpath
    const most = trimPath(two, 0, 0.75)
    expect(most).toHaveLength(2)
    expect(len(most[0].pts)).toBeCloseTo(100, 6) // first: whole
    expect(len(most[1].pts)).toBeCloseTo(50, 6) // second: half
  })

  it('a subpath inside the window comes back untouched, and a CLOSED one keeps its `closed`', () => {
    const ring = circlePath(0, 0, 20)
    const whole = trimPath(ring, 0, 1)
    expect(whole).toHaveLength(1)
    expect(whole[0].closed).toBe(true) // full ring → joins, instead of two round caps meeting
    expect(trimPath(ring, 0, 0.5)[0].closed).toBe(false) // a cut piece is an open stroke
  })

  it('an empty or inverted window draws nothing; a degenerate path is safe', () => {
    const line = parsePathData('M0 0L100 0')
    expect(trimPath(line, 0, 0)).toEqual([])
    expect(trimPath(line, 0.8, 0.2)).toEqual([]) // from > to
    expect(trimPath({ subpaths: [] }, 0, 1)).toEqual([])
    expect(pathArcLength({ subpaths: [] })).toBe(0)
  })

  it('out-of-range fractions are clamped (an expression may overshoot)', () => {
    const line = parsePathData('M0 0L100 0')
    expect(len(trimPath(line, -5, 42)[0].pts)).toBeCloseTo(100, 6)
  })

  it('a NON-FINITE bound falls back to the default window instead of poisoning the geometry', () => {
    // An untrusted `.flatpack` can carry `draw: NaN`, and an expression can divide by zero for one frame.
    // NaN through the arithmetic would reach `moveTo(NaN, NaN)` — a stroke that vanishes with no error.
    const line = parsePathData('M0 0L100 0')
    for (const bad of [NaN, Infinity, -Infinity, undefined as unknown as number]) {
      const pieces = trimPath(line, bad, bad)
      expect(pieces).toHaveLength(1)
      expect(len(pieces[0].pts)).toBeCloseTo(100, 6) // from → 0, to → 1: the whole outline
      expect(pieces[0].pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    }
    expect(len(trimPath(line, NaN, 0.5)[0].pts)).toBeCloseTo(50, 6) // only the broken bound falls back
  })
})
