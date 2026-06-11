// Pointer grabbing: press / drag / release / longpress.
// node environment: we capture the listeners attached to the fake canvas, then fire synthetic
// PointerEvents. The "drag" composes with the existing primitives (the mouse is in the expression
// context) -> a handler `drag { px = mouse.x }` is enough to make the object follow.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FlatPlayer, type PlayerOptions } from './player'
import { playHeadless } from './headless'
import type { Action } from '@flatkit/engine/actions'
import type { Doc, Group, Layer, Text, Interaction, Region } from '@flatkit/types'
import { IDENTITY, translation } from '@flatkit/engine/transform'
import { parsePathData } from '@flatkit/engine/svgPath'

const fakeCtx = () =>
  new Proxy(
    {},
    {
      get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 }) : p === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) : () => {}),
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D

type Handlers = Record<string, (e: { clientX: number; clientY: number; pointerId: number }) => void>
function fakeCanvas(handlers: Handlers): HTMLCanvasElement {
  return {
    getContext: () => fakeCtx(),
    getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 }),
    addEventListener: (type: string, fn: Handlers[string]) => { handlers[type] = fn },
    removeEventListener: (type: string) => { delete handlers[type] },
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    style: {},
  } as unknown as HTMLCanvasElement
}

// A full-frame "piece" (100x100 Text at the origin) -> any world point in [0,100]^2 hits it.
const piece = (): Text => ({
  id: 'Piece', kind: 'text', name: 'Piece', transform: IDENTITY, content: 'x',
  font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.25, color: '#000', box: { w: 100, h: 100 },
})

function makeDoc(interactions: Interaction[]): Doc {
  const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [piece()] }
  return { width: 100, height: 100, layers: [layer], symbols: [], interactions, timeline: { fps: 24, durationFrames: 1, tracks: [] } }
}

const sv = (name: string, value: string): Action => ({ do: 'setVar', name, value })
const opts: PlayerOptions = { input: true, padding: 0 }

beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 })
  vi.stubGlobal('addEventListener', () => {})
  vi.stubGlobal('removeEventListener', () => {})
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => vi.unstubAllGlobals())

describe('FlatPlayer -- grabbing (press / drag / release / longpress)', () => {
  it('press -> drag follows mouse.x -> release', () => {
    const h: Handlers = {}
    const inter: Interaction[] = [
      { id: 'p', targetId: 'Piece', event: 'press', actions: [sv('grabbed', '1')] },
      { id: 'd', targetId: 'Piece', event: 'drag', actions: [sv('px', 'mouse.x')] },
      { id: 'r', targetId: 'Piece', event: 'release', actions: [sv('grabbed', '0')] },
    ]
    const pl = new FlatPlayer(fakeCanvas(h), makeDoc(inter), opts)
    h.pointerdown({ clientX: 5, clientY: 5, pointerId: 1 })
    expect(pl.getVar('grabbed')).toBe(1)
    h.pointermove({ clientX: 40, clientY: 5, pointerId: 1 })
    expect(pl.getVar('px')).toBe(40) // the object followed the pointer
    h.pointerup({ clientX: 40, clientY: 5, pointerId: 1 })
    expect(pl.getVar('grabbed')).toBe(0)
    pl.destroy()
  })

  it('drag keeps following even when the pointer leaves the object', () => {
    const h: Handlers = {}
    const inter: Interaction[] = [
      { id: 'p', targetId: 'Piece', event: 'press', actions: [sv('grabbed', '1')] },
      { id: 'd', targetId: 'Piece', event: 'drag', actions: [sv('px', 'mouse.x')] },
    ]
    const pl = new FlatPlayer(fakeCanvas(h), makeDoc(inter), opts)
    h.pointerdown({ clientX: 50, clientY: 50, pointerId: 1 })
    h.pointermove({ clientX: 95, clientY: 95, pointerId: 1 }) // still in the object
    expect(pl.getVar('px')).toBe(95)
    pl.destroy()
  })

  it('hold without moving -> longpress', () => {
    vi.useFakeTimers()
    const h: Handlers = {}
    const inter: Interaction[] = [{ id: 'l', targetId: 'Piece', event: 'longpress', actions: [sv('held', '1')] }]
    const pl = new FlatPlayer(fakeCanvas(h), makeDoc(inter), opts)
    h.pointerdown({ clientX: 5, clientY: 5, pointerId: 1 })
    expect(pl.getVar('held')).toBeUndefined()
    vi.advanceTimersByTime(600)
    expect(pl.getVar('held')).toBe(1)
    pl.destroy()
    vi.useRealTimers()
  })

  it('moving beyond the tolerance cancels the long-press', () => {
    vi.useFakeTimers()
    const h: Handlers = {}
    const inter: Interaction[] = [{ id: 'l', targetId: 'Piece', event: 'longpress', actions: [sv('held', '1')] }]
    const pl = new FlatPlayer(fakeCanvas(h), makeDoc(inter), opts)
    h.pointerdown({ clientX: 5, clientY: 5, pointerId: 1 })
    h.pointermove({ clientX: 50, clientY: 50, pointerId: 1 }) // > tolerance
    vi.advanceTimersByTime(600)
    expect(pl.getVar('held')).toBeUndefined()
    pl.destroy()
    vi.useRealTimers()
  })
})

describe('FlatPlayer -- interactor (drag / dropped on)', () => {
  it('drag writes varX/varY with the grab offset, then dropped on Zone at release', () => {
    const h: Handlers = {}
    const zone: Text = { id: 'Zone', kind: 'text', name: 'Zone', transform: IDENTITY, content: '', font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.25, color: '#000', box: { w: 100, h: 100 } }
    const pc = { ...piece(), expressions: { x: 'px', y: 'py' } as Record<string, string> }
    const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [zone, pc] }
    const doc: Doc = {
      width: 100, height: 100, layers: [layer], symbols: [],
      variables: { px: 0, py: 0 },
      interactors: [{ targetId: 'Piece', axis: 'xy', varX: 'px', varY: 'py' }],
      interactions: [{ id: 'd', targetId: 'Piece', event: 'drop', over: 'Zone', actions: [sv('px', '999')] }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, opts)
    h.pointerdown({ clientX: 5, clientY: 5, pointerId: 1 }) // piece at (0,0) -> grab offset (-5,-5)
    h.pointermove({ clientX: 40, clientY: 30, pointerId: 1 })
    expect(pl.getVar('px')).toBe(35) // 40 + (-5) -> the grab point stays under the cursor
    expect(pl.getVar('py')).toBe(25) // 30 + (-5)
    h.pointerup({ clientX: 40, clientY: 30, pointerId: 1 }) // center (35,25) in Zone [0,100]^2 -> drop
    expect(pl.getVar('px')).toBe(999)
    pl.destroy()
  })

  it('NESTED object: the variable receives the position in PARENT space (Tier 2)', () => {
    const h: Handlers = {}
    // 100x100 piece (expressions x=cx,y=cy) INSIDE a parent translated by (50,50).
    const child = { ...piece(), id: 'Child', name: 'Child', expressions: { x: 'cx', y: 'cy' } as Record<string, string> }
    const parent: Group = { id: 'Parent', kind: 'group', name: 'Parent', transform: translation(50, 50), layers: [{ id: 'pl', name: 'c', visible: true, locked: false, opacity: 1, items: [child] }] }
    const doc: Doc = {
      width: 100, height: 100, layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [parent] }], symbols: [],
      variables: { cx: 0, cy: 0 },
      interactors: [{ targetId: 'Child', axis: 'xy', varX: 'cx', varY: 'cy' }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, opts)
    h.pointerdown({ clientX: 60, clientY: 60, pointerId: 1 }) // child at world (50,50) -> offset (-10,-10)
    h.pointermove({ clientX: 80, clientY: 70, pointerId: 1 }) // world target (70,60) -> local (20,10) since parent at (50,50)
    expect(pl.getVar('cx')).toBe(20)
    expect(pl.getVar('cy')).toBe(10)
    pl.destroy()
  })

  it('toLocalX/Y and toGlobalX/Y in a handler convert to/from the parent space', () => {
    const h: Handlers = {}
    const child = { ...piece(), id: 'Child', name: 'Child' } // 100x100, in a parent at (50,50)
    const parent: Group = { id: 'Parent', kind: 'group', name: 'Parent', transform: translation(50, 50), layers: [{ id: 'pl', name: 'c', visible: true, locked: false, opacity: 1, items: [child] }] }
    const doc: Doc = {
      width: 100, height: 100, layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [parent] }], symbols: [],
      interactions: [{ id: 'c', targetId: 'Child', event: 'click', actions: [sv('lx', 'toLocalX(60, 60)'), sv('gx', 'toGlobalX(10, 10)')] }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, opts)
    h.pointerdown({ clientX: 60, clientY: 60, pointerId: 1 })
    expect(pl.getVar('lx')).toBe(10) // world 60 -> local 60-50
    expect(pl.getVar('gx')).toBe(60) // local 10 -> world 10+50
    pl.destroy()
  })

  it('confine bounds the output to the zone bbox', () => {
    const h: Handlers = {}
    const field: Text = { id: 'Field', kind: 'text', name: 'Field', transform: IDENTITY, content: '', font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.25, color: '#000', box: { w: 30, h: 30 } }
    const pc = { ...piece(), expressions: { x: 'px', y: 'py' } as Record<string, string> }
    const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [field, pc] }
    const doc: Doc = {
      width: 100, height: 100, layers: [layer], symbols: [],
      variables: { px: 0, py: 0 },
      interactors: [{ targetId: 'Piece', axis: 'xy', varX: 'px', varY: 'py', confine: 'Field' }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, opts)
    h.pointerdown({ clientX: 0, clientY: 0, pointerId: 1 }) // offset (0,0)
    h.pointermove({ clientX: 90, clientY: 90, pointerId: 1 }) // outside Field (30x30) -> clamped to 30,30
    expect(pl.getVar('px')).toBe(30)
    expect(pl.getVar('py')).toBe(30)
    pl.destroy()
  })

  it('enabled: the drag is inert while the expression is false, active when it is true', () => {
    const h: Handlers = {}
    const pc = { ...piece(), expressions: { x: 'px', y: 'py' } as Record<string, string> }
    const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [pc] }
    const doc: Doc = {
      width: 100, height: 100, layers: [layer], symbols: [],
      variables: { px: 0, py: 0, unlocked: 0 },
      interactors: [{ targetId: 'Piece', axis: 'xy', varX: 'px', varY: 'py', enabled: 'unlocked' }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, opts)
    h.pointerdown({ clientX: 5, clientY: 5, pointerId: 1 })
    h.pointermove({ clientX: 40, clientY: 40, pointerId: 1 })
    expect(pl.getVar('px')).toBe(0) // locked -> no drag
    h.pointerup({ clientX: 40, clientY: 40, pointerId: 1 })
    pl.setVar('unlocked', 1)
    h.pointerdown({ clientX: 5, clientY: 5, pointerId: 1 })
    h.pointermove({ clientX: 40, clientY: 40, pointerId: 1 })
    expect(pl.getVar('px')).toBe(35) // unlocked -> follows the pointer (offset -5)
    pl.destroy()
  })

  it('turn: the object writes the angle (degrees) from the pivot to the pointer, optional snap', () => {
    const h: Handlers = {}
    const pc = { ...piece(), expressions: { rotation: 'ang' } as Record<string, string> }
    const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [pc] }
    const doc: Doc = {
      width: 100, height: 100, layers: [layer], symbols: [],
      variables: { ang: 0 },
      interactors: [{ targetId: 'Piece', axis: 'turn', varX: 'ang', pivot: { x: 50, y: 50 }, grid: 15 }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, opts)
    h.pointerdown({ clientX: 50, clientY: 50, pointerId: 1 })
    h.pointermove({ clientX: 90, clientY: 50, pointerId: 1 }) // pivot->right -> 0deg
    expect(pl.getVar('ang')).toBe(0)
    h.pointermove({ clientX: 50, clientY: 90, pointerId: 1 }) // pivot->down -> 90deg
    expect(pl.getVar('ang')).toBe(90)
    h.pointermove({ clientX: 53, clientY: 12, pointerId: 1 }) // ~ -85deg -> snap 15 -> -90deg
    expect(pl.getVar('ang')).toBe(-90)
    pl.destroy()
  })

  it('trace: the progress advances along the path (monotone, within tolerance)', () => {
    const h: Handlers = {}
    const region: Region = { id: 'r', color: '#000', path: parsePathData('M0 50L100 50') } // horizontal line
    const pathGroup: Group = { id: 'Path', kind: 'group', name: 'Path', transform: IDENTITY, layers: [{ id: 'cl', name: 'c', visible: true, locked: false, opacity: 1, items: [region] }] }
    const cursor = { ...piece(), id: 'Cursor', name: 'Cursor' }
    const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [pathGroup, cursor] }
    const doc: Doc = {
      width: 100, height: 100, layers: [layer], symbols: [], variables: { prog: 0 },
      interactors: [{ targetId: 'Cursor', axis: 'trace', varX: 'prog', confine: 'Path', grid: 20 }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, { ...opts, render: false }) // doc with a region -> we avoid Path2D (render); the interaction logic does not depend on it
    h.pointerdown({ clientX: 10, clientY: 50, pointerId: 1 })
    h.pointermove({ clientX: 50, clientY: 50, pointerId: 1 }) // midway
    expect(pl.getVar('prog') as number).toBeCloseTo(0.5, 1)
    h.pointermove({ clientX: 100, clientY: 50, pointerId: 1 }) // end
    expect(pl.getVar('prog') as number).toBeCloseTo(1, 1)
    h.pointermove({ clientX: 50, clientY: 200, pointerId: 1 }) // out of tolerance -> progress HELD (monotone)
    expect(pl.getVar('prog') as number).toBeCloseTo(1, 1)
    pl.destroy()
  })

  it('indexed output: a gesture writes into an ELEMENT of an array (pos[i])', () => {
    const h: Handlers = {}
    const pc = { ...piece(), expressions: { x: 'pos[1]' } as Record<string, string> }
    const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [pc] }
    const doc: Doc = {
      width: 100, height: 100, layers: [layer], symbols: [],
      variables: { pos: [0, 0, 0], i: 1 },
      interactors: [{ targetId: 'Piece', axis: 'x', varX: 'pos[i]' }], // output = array element
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, { ...opts, render: false })
    h.pointerdown({ clientX: 5, clientY: 5, pointerId: 1 })
    h.pointermove({ clientX: 40, clientY: 5, pointerId: 1 }) // 40 + offset(-5) = 35 -> pos[1]
    expect((pl.getVar('pos') as number[])[1]).toBe(35)
    expect((pl.getVar('pos') as number[])[0]).toBe(0) // the other slots intact
    pl.destroy()
  })

  it('reveal: scratching accumulates the coverage (monotone) -> fraction 0..1', () => {
    const h: Handlers = {}
    const pc = { ...piece(), box: { w: 40, h: 40 } } // 40x40 zone -> 2x2 grid with brush 20 (centers 10/30)
    const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [pc] }
    const doc: Doc = {
      width: 100, height: 100, layers: [layer], symbols: [], variables: { seen: 0 },
      interactors: [{ targetId: 'Piece', axis: 'reveal', varX: 'seen', grid: 20 }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, { ...opts, render: false })
    h.pointerdown({ clientX: 10, clientY: 10, pointerId: 1 })
    h.pointermove({ clientX: 10, clientY: 10, pointerId: 1 }) // corner: ticks 3 cells out of 4 (the 4th is at ~28 > brush)
    expect(pl.getVar('seen') as number).toBeCloseTo(0.75, 5)
    h.pointermove({ clientX: 30, clientY: 30, pointerId: 1 }) // ticks the last cell -> all revealed
    expect(pl.getVar('seen')).toBe(1)
    h.pointermove({ clientX: 200, clientY: 200, pointerId: 1 }) // out of zone -> stays at 1 (monotone, never goes back down)
    expect(pl.getVar('seen')).toBe(1)
    pl.destroy()
  })

  it('reveal: coverage ACCUMULATES across separate grabs (true monotonicity)', () => {
    const h: Handlers = {}
    const pc = { ...piece(), box: { w: 40, h: 40 } } // 2x2 grid, brush 20 (cell centers 10/30)
    const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [pc] }
    const doc: Doc = {
      width: 100, height: 100, layers: [layer], symbols: [], variables: { seen: 0 },
      interactors: [{ targetId: 'Piece', axis: 'reveal', varX: 'seen', grid: 20 }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, { ...opts, render: false })
    h.pointerdown({ clientX: 10, clientY: 10, pointerId: 1 })
    h.pointermove({ clientX: 10, clientY: 10, pointerId: 1 }) // first stroke: 3 cells -> 0.75
    expect(pl.getVar('seen') as number).toBeCloseTo(0.75, 5)
    h.pointerup({ clientX: 10, clientY: 10, pointerId: 1 }) // let go (a child scratching in short bursts)
    h.pointerdown({ clientX: 30, clientY: 30, pointerId: 1 }) // NEW grab
    h.pointermove({ clientX: 30, clientY: 30, pointerId: 1 }) // ticks the missing far cell — must ADD, not reset
    expect(pl.getVar('seen')).toBe(1) // 3 prior + the 4th, NOT 0.75 of this stroke alone
    pl.destroy()
  })

  it('link: the wire follows the pointer, and on release writes the target index (center stuck) or 0', () => {
    const h: Handlers = {}
    const mkText = (id: string, x: number, y: number): Text => ({
      id, kind: 'text', name: id, transform: translation(x, y), content: 'x',
      font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.25, color: '#000', box: { w: 20, h: 20 },
    })
    const a = mkText('A', 40, 40) // bbox 40..60, center (50,50)
    const b = mkText('B', 70, 70) // bbox 70..90, center (80,80)
    const targetsGroup: Group = { id: 'Targets', kind: 'group', name: 'Targets', transform: IDENTITY, layers: [{ id: 'cl', name: 'c', visible: true, locked: false, opacity: 1, items: [a, b] }] }
    const source = mkText('Source', 0, 0) // bbox 0..20
    const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [targetsGroup, source] }
    const doc: Doc = {
      width: 100, height: 100, layers: [layer], symbols: [], variables: { ex: 0, ey: 0, target: 0 },
      interactors: [{ targetId: 'Source', axis: 'link', varX: 'ex', varY: 'ey', varT: 'target', confine: 'Targets' }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, { ...opts, render: false })
    // linked to B
    h.pointerdown({ clientX: 5, clientY: 5, pointerId: 1 }) // grabs Source
    h.pointermove({ clientX: 50, clientY: 50, pointerId: 1 }) // the free end follows the pointer
    expect(pl.getVar('ex')).toBe(50)
    expect(pl.getVar('ey')).toBe(50)
    h.pointermove({ clientX: 80, clientY: 80, pointerId: 1 }) // over B
    h.pointerup({ clientX: 80, clientY: 80, pointerId: 1 }) // released on B -> target = 2, end stuck to B's center
    expect(pl.getVar('target')).toBe(2)
    expect(pl.getVar('ex')).toBe(80)
    expect(pl.getVar('ey')).toBe(80)
    // released into the void -> target = 0 (silent return handled by the author)
    h.pointerdown({ clientX: 5, clientY: 5, pointerId: 1 })
    h.pointermove({ clientX: 30, clientY: 30, pointerId: 1 })
    h.pointerup({ clientX: 30, clientY: 30, pointerId: 1 })
    expect(pl.getVar('target')).toBe(0)
    pl.destroy()
  })

  it('link: a `when released` handler reads the RESOLVED target (verdict written before release)', () => {
    const h: Handlers = {}
    const mkText = (id: string, x: number, y: number): Text => ({
      id, kind: 'text', name: id, transform: translation(x, y), content: 'x',
      font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.25, color: '#000', box: { w: 20, h: 20 },
    })
    const b = mkText('B', 70, 70) // bbox 70..90
    const targetsGroup: Group = { id: 'Targets', kind: 'group', name: 'Targets', transform: IDENTITY, layers: [{ id: 'cl', name: 'c', visible: true, locked: false, opacity: 1, items: [b] }] }
    const source = mkText('Source', 0, 0)
    const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [targetsGroup, source] }
    const doc: Doc = {
      width: 100, height: 100, layers: [layer], symbols: [], variables: { ex: 0, ey: 0, target: 0, seenTarget: -1 },
      interactors: [{ targetId: 'Source', axis: 'link', varX: 'ex', varY: 'ey', varT: 'target', confine: 'Targets' }],
      // The handler runs DURING `release`; it must already see target = 1 (B), not the stale 0.
      interactions: [{ id: 'r', targetId: 'Source', event: 'release', actions: [sv('seenTarget', 'target')] }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, { ...opts, render: false })
    h.pointerdown({ clientX: 5, clientY: 5, pointerId: 1 })
    h.pointermove({ clientX: 80, clientY: 80, pointerId: 1 })
    h.pointerup({ clientX: 80, clientY: 80, pointerId: 1 }) // released over B
    expect(pl.getVar('target')).toBe(1)
    expect(pl.getVar('seenTarget')).toBe(1) // the released handler observed the verdict, not 0
    pl.destroy()
  })

  it('link: a DISABLED interactor does not capture the pointer (no grab, no re-triggered verdict)', () => {
    const h: Handlers = {}
    const mkText = (id: string, x: number, y: number): Text => ({
      id, kind: 'text', name: id, transform: translation(x, y), content: 'x',
      font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.25, color: '#000', box: { w: 20, h: 20 },
    })
    const b = mkText('B', 70, 70)
    const targetsGroup: Group = { id: 'Targets', kind: 'group', name: 'Targets', transform: IDENTITY, layers: [{ id: 'cl', name: 'c', visible: true, locked: false, opacity: 1, items: [b] }] }
    const source = mkText('Source', 0, 0)
    const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [targetsGroup, source] }
    const doc: Doc = {
      width: 100, height: 100, layers: [layer], symbols: [], variables: { ex: 0, ey: 0, target: 5 },
      // `enabled: '0'` → never active (e.g. an already-linked source). It must NOT grab nor re-write the verdict.
      interactors: [{ targetId: 'Source', axis: 'link', varX: 'ex', varY: 'ey', varT: 'target', confine: 'Targets', enabled: '0' }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, { ...opts, render: false })
    h.pointerdown({ clientX: 5, clientY: 5, pointerId: 1 })
    h.pointermove({ clientX: 80, clientY: 80, pointerId: 1 })
    h.pointerup({ clientX: 80, clientY: 80, pointerId: 1 }) // over B, but the interactor is off
    expect(pl.getVar('target')).toBe(5) // untouched: resolveLink never ran
    expect(pl.getVar('ex')).toBe(0) // no var writes
    pl.destroy()
  })

  it('record: records down/move(during drag)/up + a wait for the elapsed frames', () => {
    const h: Handlers = {}
    const pc = { ...piece(), expressions: { x: 'px', y: 'py' } as Record<string, string> }
    const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [pc] }
    const doc: Doc = {
      width: 100, height: 100, layers: [layer], symbols: [], variables: { px: 0, py: 0 },
      interactors: [{ targetId: 'Piece', axis: 'xy', varX: 'px', varY: 'py' }],
      timeline: { fps: 24, durationFrames: 1000, tracks: [] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, opts)
    pl.startRecording()
    expect(pl.isRecording).toBe(true)
    h.pointerdown({ clientX: 5, clientY: 5, pointerId: 1 })
    h.pointermove({ clientX: 40, clientY: 30, pointerId: 1 })
    pl.seek(12) // time passes -> a `wait` must be inserted before the next gesture
    h.pointerup({ clientX: 40, clientY: 30, pointerId: 1 })
    const g = pl.stopRecording()
    expect(pl.isRecording).toBe(false)
    expect(g).toEqual([
      { type: 'down', x: 5, y: 5 },
      { type: 'move', x: 40, y: 30 },
      { type: 'wait', frames: 12 },
      { type: 'up', x: 40, y: 30 },
    ])
    pl.destroy()
  })

  it('record -> replay: the recorded script replays the same gesture (headless loop)', () => {
    const h: Handlers = {}
    const pc = { ...piece(), expressions: { x: 'px', y: 'py' } as Record<string, string> }
    const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [pc] }
    const mkDoc = (): Doc => ({
      width: 100, height: 100, layers: [layer], symbols: [], variables: { px: 0, py: 0 },
      interactors: [{ targetId: 'Piece', axis: 'xy', varX: 'px', varY: 'py' }],
      timeline: { fps: 24, durationFrames: 1000, tracks: [] },
    })
    const pl = new FlatPlayer(fakeCanvas(h), mkDoc(), opts)
    pl.startRecording()
    h.pointerdown({ clientX: 5, clientY: 5, pointerId: 1 })
    h.pointermove({ clientX: 40, clientY: 30, pointerId: 1 })
    h.pointerup({ clientX: 40, clientY: 30, pointerId: 1 })
    const script = pl.stopRecording()
    pl.destroy()
    // Headless replay of the recorded script -> same final position (grab offset -5).
    const res = playHeadless(mkDoc(), script)
    expect(res.vars.px).toBe(35)
    expect(res.vars.py).toBe(25)
  })

  it('at pointer: the drop tests the POINTER, not the object center', () => {
    const h: Handlers = {}
    // Small zone (10x10) top-left; 100x100 piece. The piece center never falls into the zone,
    // but the pointer can be there.
    const zone: Text = { id: 'Zone', kind: 'text', name: 'Zone', transform: IDENTITY, content: '', font: 'sans-serif', size: 16, align: 'left', lineHeight: 1.25, color: '#000', box: { w: 10, h: 10 } }
    const pc = { ...piece(), expressions: { x: 'px', y: 'py' } as Record<string, string> }
    const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [zone, pc] }
    const doc: Doc = {
      width: 100, height: 100, layers: [layer], symbols: [],
      variables: { px: 0, py: 0, ok: 0 },
      interactors: [{ targetId: 'Piece', axis: 'xy', varX: 'px', varY: 'py' }],
      interactions: [{ id: 'd', targetId: 'Piece', event: 'drop', over: 'Zone', atPointer: true, actions: [sv('ok', '1')] }],
      timeline: { fps: 24, durationFrames: 1, tracks: [] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, opts)
    h.pointerdown({ clientX: 50, clientY: 50, pointerId: 1 }) // piece center -> (50,50), outside Zone [0,10]^2
    h.pointerup({ clientX: 5, clientY: 5, pointerId: 1 }) // pointer in Zone -> drop
    expect(pl.getVar('ok')).toBe(1)
    pl.destroy()
  })

  // Backs `--render --steps N`: run N fixed sim steps (onEnterFrame) headlessly before capture.
  it('stepSim(N): runs onEnterFrame N times (state unfolds, e.g. a physics ramp)', () => {
    const h: Handlers = {}
    const doc: Doc = {
      width: 100, height: 100, layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [] }], symbols: [],
      variables: { px: 0 },
      timeline: { fps: 24, durationFrames: 100000, tracks: [], onEnterFrame: [sv('px', 'px + 10')] },
    }
    const pl = new FlatPlayer(fakeCanvas(h), doc, { ...opts, render: false })
    pl.stepSim(5)
    expect(pl.getVar('px')).toBe(50) // 5 × (+10)
    pl.stepSim(0) // no-op
    expect(pl.getVar('px')).toBe(50)
    pl.destroy()
  })
})
