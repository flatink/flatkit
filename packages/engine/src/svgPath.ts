// ─────────────────────────────────────────────────────────────────────────────
//  svgPath.ts — conversion of SVG geometry to FlatInk's `Path` (Bezier) model.
//  PURE (no DOM): `parsePathData` (the `d` attribute) + basic shape builders.
//  Every curve becomes a cubic; quad→cubic, arc→cubics.
// ─────────────────────────────────────────────────────────────────────────────
import type { Point } from '@flatkit/types'
import type { Path, Seg, Subpath } from './path'

/** Split a `d` command string into command letters and numbers. */
function tokenize(d: string): (string | number)[] {
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g
  const out: (string | number)[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) out.push(m[1] ? m[1] : parseFloat(m[2]))
  return out
}

type Cubic = { c1: Point; c2: Point; end: Point }

/** SVG arc (endpoint) → a sequence of cubics (≤ 90° each). [] if degenerate (→ line). */
function arcToCubics(p0: Point, rxIn: number, ryIn: number, rotDeg: number, large: boolean, sweep: boolean, p1: Point): Cubic[] {
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (rx === 0 || ry === 0 || (p0.x === p1.x && p0.y === p1.y)) return []
  const phi = (rotDeg * Math.PI) / 180
  const cosP = Math.cos(phi)
  const sinP = Math.sin(phi)
  const dx = (p0.x - p1.x) / 2
  const dy = (p0.y - p1.y) / 2
  const x1p = cosP * dx + sinP * dy
  const y1p = -sinP * dx + cosP * dy
  let rxs = rx * rx
  let rys = ry * ry
  const lambda = (x1p * x1p) / rxs + (y1p * y1p) / rys
  if (lambda > 1) {
    const s = Math.sqrt(lambda)
    rx *= s
    ry *= s
    rxs = rx * rx
    rys = ry * ry
  }
  const sign = large !== sweep ? 1 : -1
  const numer = Math.max(0, rxs * rys - rxs * y1p * y1p - rys * x1p * x1p)
  const denom = rxs * y1p * y1p + rys * x1p * x1p
  const co = sign * Math.sqrt(denom === 0 ? 0 : numer / denom)
  const cxp = (co * (rx * y1p)) / ry
  const cyp = (co * (-ry * x1p)) / rx
  const cx = cosP * cxp - sinP * cyp + (p0.x + p1.x) / 2
  const cy = sinP * cxp + cosP * cyp + (p0.y + p1.y) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy)
    let a = Math.acos(Math.max(-1, Math.min(1, len === 0 ? 1 : dot / len)))
    if (ux * vy - uy * vx < 0) a = -a
    return a
  }
  const ux = (x1p - cxp) / rx
  const uy = (y1p - cyp) / ry
  const theta1 = angle(1, 0, ux, uy)
  let dtheta = angle(ux, uy, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI
  const n = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)))
  const delta = dtheta / n
  const t = (4 / 3) * Math.tan(delta / 4)
  const pt = (a: number): Point => ({ x: cx + rx * cosP * Math.cos(a) - ry * sinP * Math.sin(a), y: cy + rx * sinP * Math.cos(a) + ry * cosP * Math.sin(a) })
  const deriv = (a: number): Point => ({ x: -rx * cosP * Math.sin(a) - ry * sinP * Math.cos(a), y: -rx * sinP * Math.sin(a) + ry * cosP * Math.cos(a) })
  const out: Cubic[] = []
  let a1 = theta1
  let from = p0
  for (let k = 0; k < n; k++) {
    const a2 = a1 + delta
    const end = pt(a2)
    const d1 = deriv(a1)
    const d2 = deriv(a2)
    out.push({ c1: { x: from.x + t * d1.x, y: from.y + t * d1.y }, c2: { x: end.x - t * d2.x, y: end.y - t * d2.y }, end })
    a1 = a2
    from = end
  }
  return out
}

const setOut = (segs: Seg[], h: Point) => { if (segs.length) segs[segs.length - 1].outHandle = h }
const refl = (anchor: Point, ctrl: Point | null): Point => (ctrl ? { x: 2 * anchor.x - ctrl.x, y: 2 * anchor.y - ctrl.y } : anchor)

/** Drop the closing anchor that duplicates the start (case `… L sx sy Z`). */
function dropClosingDup(segs: Seg[], start: Point): Seg[] {
  if (segs.length > 1) {
    const last = segs[segs.length - 1]
    if (Math.hypot(last.anchor.x - start.x, last.anchor.y - start.y) < 1e-6 && !last.outHandle) {
      if (last.inHandle) segs[0] = { ...segs[0], inHandle: last.inHandle }
      return segs.slice(0, -1)
    }
  }
  return segs
}

/** Parse an SVG `d` attribute into a FlatInk `Path` (all curves → cubics). */
export function parsePathData(d: string): Path {
  const t = tokenize(d)
  let i = 0
  const subpaths: Subpath[] = []
  let segs: Seg[] = []
  let cx = 0, cy = 0, sx = 0, sy = 0
  let cmd = ''
  let prevCubic: Point | null = null // last C2 (for S)
  let prevQuad: Point | null = null // last quad control (for T)
  const num = () => t[i++] as number
  const flushOpen = () => { if (segs.length) subpaths.push({ closed: false, segments: segs }); segs = [] }

  while (i < t.length) {
    if (typeof t[i] === 'string') cmd = t[i++] as string
    else if (!cmd) { i++; continue }
    const rel = cmd === cmd.toLowerCase()
    switch (cmd.toUpperCase()) {
      case 'M': {
        flushOpen()
        let x = num(), y = num()
        if (rel) { x += cx; y += cy }
        cx = sx = x; cy = sy = y
        segs.push({ anchor: { x, y } })
        cmd = rel ? 'l' : 'L' // implicit next = lineto
        prevCubic = prevQuad = null
        break
      }
      case 'L': { let x = num(), y = num(); if (rel) { x += cx; y += cy } segs.push({ anchor: { x, y } }); cx = x; cy = y; prevCubic = prevQuad = null; break }
      case 'H': { let x = num(); if (rel) x += cx; segs.push({ anchor: { x, y: cy } }); cx = x; prevCubic = prevQuad = null; break }
      case 'V': { let y = num(); if (rel) y += cy; segs.push({ anchor: { x: cx, y } }); cy = y; prevCubic = prevQuad = null; break }
      case 'C': {
        let x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num()
        if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy }
        setOut(segs, { x: x1, y: y1 })
        segs.push({ anchor: { x, y }, inHandle: { x: x2, y: y2 } })
        cx = x; cy = y; prevCubic = { x: x2, y: y2 }; prevQuad = null
        break
      }
      case 'S': {
        let x2 = num(), y2 = num(), x = num(), y = num()
        if (rel) { x2 += cx; y2 += cy; x += cx; y += cy }
        setOut(segs, refl({ x: cx, y: cy }, prevCubic))
        segs.push({ anchor: { x, y }, inHandle: { x: x2, y: y2 } })
        cx = x; cy = y; prevCubic = { x: x2, y: y2 }; prevQuad = null
        break
      }
      case 'Q': {
        let qx = num(), qy = num(), x = num(), y = num()
        if (rel) { qx += cx; qy += cy; x += cx; y += cy }
        setOut(segs, { x: cx + (2 / 3) * (qx - cx), y: cy + (2 / 3) * (qy - cy) })
        segs.push({ anchor: { x, y }, inHandle: { x: x + (2 / 3) * (qx - x), y: y + (2 / 3) * (qy - y) } })
        cx = x; cy = y; prevQuad = { x: qx, y: qy }; prevCubic = null
        break
      }
      case 'T': {
        let x = num(), y = num(); if (rel) { x += cx; y += cy }
        const q = refl({ x: cx, y: cy }, prevQuad)
        setOut(segs, { x: cx + (2 / 3) * (q.x - cx), y: cy + (2 / 3) * (q.y - cy) })
        segs.push({ anchor: { x, y }, inHandle: { x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) } })
        cx = x; cy = y; prevQuad = q; prevCubic = null
        break
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), large = num(), sweep = num()
        let x = num(), y = num(); if (rel) { x += cx; y += cy }
        const cubics = arcToCubics({ x: cx, y: cy }, rx, ry, rot, !!large, !!sweep, { x, y })
        if (cubics.length === 0) segs.push({ anchor: { x, y } }) // degenerate → line
        else for (const c of cubics) { setOut(segs, c.c1); segs.push({ anchor: c.end, inHandle: c.c2 }) }
        cx = x; cy = y; prevCubic = prevQuad = null
        break
      }
      case 'Z': {
        if (segs.length) { subpaths.push({ closed: true, segments: dropClosingDup(segs, { x: sx, y: sy }) }); segs = [] }
        cx = sx; cy = sy; prevCubic = prevQuad = null
        break
      }
      default: i = t.length // unknown command → stop
    }
  }
  flushOpen()
  return { subpaths: subpaths.filter((sp) => sp.segments.length > 0) }
}

// ── Basic shape builders (reuse parsePathData / the arc for curves) ──

/** Ellipse (4 cubics via 2 half-arcs). */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): Path {
  if (rx <= 0 || ry <= 0) return { subpaths: [] }
  return parsePathData(`M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0 Z`)
}

export const circlePath = (cx: number, cy: number, r: number): Path => ellipsePath(cx, cy, r, r)

/** Rectangle, optionally with rounded corners (rx/ry). */
export function rectPath(x: number, y: number, w: number, h: number, rx = 0, ry = 0): Path {
  if (w <= 0 || h <= 0) return { subpaths: [] }
  const RX = Math.min(Math.max(0, rx || ry), w / 2)
  const RY = Math.min(Math.max(0, ry || rx), h / 2)
  if (RX <= 0 || RY <= 0) return polyPath([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true)
  return parsePathData(
    `M ${x + RX} ${y} H ${x + w - RX} A ${RX} ${RY} 0 0 1 ${x + w} ${y + RY}` +
    ` V ${y + h - RY} A ${RX} ${RY} 0 0 1 ${x + w - RX} ${y + h}` +
    ` H ${x + RX} A ${RX} ${RY} 0 0 1 ${x} ${y + h - RY}` +
    ` V ${y + RY} A ${RX} ${RY} 0 0 1 ${x + RX} ${y} Z`,
  )
}

/** Polyline / polygon (straight segments). */
export function polyPath(points: Point[], closed: boolean): Path {
  if (points.length < 2) return { subpaths: [] }
  return { subpaths: [{ closed, segments: points.map((p) => ({ anchor: { x: p.x, y: p.y } })) }] }
}

export const linePath = (x1: number, y1: number, x2: number, y2: number): Path =>
  ({ subpaths: [{ closed: false, segments: [{ anchor: { x: x1, y: y1 } }, { anchor: { x: x2, y: y2 } }] }] })
