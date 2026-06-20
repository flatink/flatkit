import { describe, it, expect } from 'vitest'
import {
  evaluateTimeline,
  resolveInstanceFrame,
  applyEasing,
  lerpTransform,
  lerpTransformPivot,
  scheduleSounds,
  type Timeline,
  type TimelineTrack,
} from './timeline'
import { apply, decompose, recompose, translation, IDENTITY, type Transform } from './transform'

const track = (targetId: string, keyframes: TimelineTrack['keyframes']): TimelineTrack => ({
  id: `t-${targetId}`,
  targetId,
  keyframes,
})
const tl = (tracks: TimelineTrack[], over: Partial<Timeline> = {}): Timeline => ({
  fps: 24,
  durationFrames: 60,
  tracks,
  ...over,
})

describe('evaluateTimeline — bounds & constants', () => {
  it('absent timeline or no track → empty map', () => {
    expect(evaluateTimeline(undefined, 0).size).toBe(0)
    expect(evaluateTimeline(tl([]), 5).size).toBe(0)
  })

  it('a single keyframe → constant value at every frame', () => {
    const t = tl([track('a', [{ frame: 10, opacity: 0.5 }])])
    expect(evaluateTimeline(t, 0).get('a')?.opacity).toBe(0.5)
    expect(evaluateTimeline(t, 10).get('a')?.opacity).toBe(0.5)
    expect(evaluateTimeline(t, 999).get('a')?.opacity).toBe(0.5)
  })

  it('before the 1st / after the last keyframe → hold the bound', () => {
    const t = tl([
      track('a', [
        { frame: 10, opacity: 0.2 },
        { frame: 20, opacity: 0.8 },
      ]),
    ])
    expect(evaluateTimeline(t, 5).get('a')?.opacity).toBe(0.2) // before
    expect(evaluateTimeline(t, 50).get('a')?.opacity).toBe(0.8) // after
  })

  it('unsorted keyframes on input → correct result (defensive sort)', () => {
    const t = tl([
      track('a', [
        { frame: 20, opacity: 1 },
        { frame: 0, opacity: 0 },
      ]),
    ])
    expect(evaluateTimeline(t, 10).get('a')?.opacity).toBeCloseTo(0.5)
  })
})

describe('evaluateTimeline — interpolation', () => {
  it('linear opacity at the midpoint', () => {
    const t = tl([
      track('a', [
        { frame: 0, opacity: 0 },
        { frame: 10, opacity: 1 },
      ]),
    ])
    expect(evaluateTimeline(t, 5).get('a')?.opacity).toBeCloseTo(0.5)
    expect(evaluateTimeline(t, 2.5).get('a')?.opacity).toBeCloseTo(0.25)
  })

  it('fill color interpolated at the midpoint + held at the bounds', () => {
    const t = tl([
      track('a', [
        { frame: 0, color: '#000000' },
        { frame: 10, color: '#ffffff' },
      ]),
    ])
    expect(evaluateTimeline(t, 0).get('a')?.color).toBe('#000000')
    expect(evaluateTimeline(t, 5).get('a')?.color).toBe('#808080')
    expect(evaluateTimeline(t, 10).get('a')?.color).toBe('#ffffff')
  })

  it('container tint interpolated: color + amount', () => {
    const t = tl([
      track('g', [
        { frame: 0, tint: { color: '#ff0000', amount: 0 } },
        { frame: 10, tint: { color: '#0000ff', amount: 1 } },
      ]),
    ])
    const ov = evaluateTimeline(t, 5).get('g')
    expect(ov?.tint).toEqual({ color: '#800080', amount: 0.5 })
  })

  it('gradient fill (paint) interpolated: stops', () => {
    const lin = (c0: string, c1: string) => ({ type: 'linear' as const, angle: 0, stops: [{ offset: 0, color: c0 }, { offset: 1, color: c1 }] })
    const t = tl([
      track('r', [
        { frame: 0, paint: lin('#000000', '#ff0000') },
        { frame: 10, paint: lin('#ffffff', '#0000ff') },
      ]),
    ])
    const p = evaluateTimeline(t, 5).get('r')?.paint
    expect(p?.type).toBe('linear')
    if (p?.type === 'linear') {
      expect(p.stops[0].color).toBe('#808080')
      expect(p.stops[1].color).toBe('#800080')
    }
  })

  it('color held when only one bound carries it', () => {
    const t = tl([
      track('a', [
        { frame: 0, color: '#ff0000', opacity: 1 },
        { frame: 10, opacity: 0 },
      ]),
    ])
    expect(evaluateTimeline(t, 5).get('a')?.color).toBe('#ff0000') // no interp → hold
  })

  it('position interpolated (transform)', () => {
    const t = tl([
      track('a', [
        { frame: 0, transform: translation(0, 0) },
        { frame: 10, transform: translation(100, 40) },
      ]),
    ])
    const m = evaluateTimeline(t, 5).get('a')?.transform
    const d = decompose(m!)
    expect(d.x).toBeCloseTo(50)
    expect(d.y).toBeCloseTo(20)
  })

  it('scale interpolated', () => {
    const a = recompose({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 })
    const b = recompose({ x: 0, y: 0, scaleX: 3, scaleY: 3, rotation: 0 })
    const d = decompose(lerpTransform(a, b, 0.5))
    expect(d.scaleX).toBeCloseTo(2)
    expect(d.scaleY).toBeCloseTo(2)
  })

  it('rotation via the shortest arc (350° → 10° passes through 0, not 180)', () => {
    const a = recompose({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: (350 * Math.PI) / 180 })
    const b = recompose({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: (370 * Math.PI) / 180 }) // = 10°
    const r = decompose(lerpTransform(a, b, 0.5)).rotation
    // expected midpoint ≈ 360° ≡ 0°, definitely NOT 180°.
    const norm = ((r % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const near0 = Math.min(norm, 2 * Math.PI - norm)
    expect(near0).toBeLessThan(0.05)
  })

  it('channel defined on one side only → hold that side', () => {
    const t = tl([
      track('a', [
        { frame: 0, opacity: 0.3 }, // no transform
        { frame: 10, transform: translation(5, 5) }, // no opacity
      ]),
    ])
    const ov = evaluateTimeline(t, 5).get('a')!
    expect(ov.opacity).toBe(0.3) // holds the only defined side
    expect(ov.transform).toBeTruthy()
  })

  it('visible is a step (value of the active keyframe)', () => {
    const t = tl([
      track('a', [
        { frame: 0, visible: true },
        { frame: 10, visible: false },
      ]),
    ])
    expect(evaluateTimeline(t, 4).get('a')?.visible).toBe(true)
    expect(evaluateTimeline(t, 10).get('a')?.visible).toBe(false)
  })

  it('multiple tracks → multiple entries', () => {
    const t = tl([
      track('a', [{ frame: 0, opacity: 1 }]),
      track('b', [{ frame: 0, opacity: 0.5 }]),
    ])
    const scope = evaluateTimeline(t, 0)
    expect(scope.size).toBe(2)
    expect(scope.get('b')?.opacity).toBe(0.5)
  })
})

describe('lerpTransform — spin direction (cw/ccw/turns)', () => {
  const rot = (deg: number) => recompose({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: (deg * Math.PI) / 180 })
  const degAt = (a: number, b: number, t: number, dir?: 'cw' | 'ccw', turns?: number) =>
    (decompose(lerpTransform(rot(a), rot(b), t, dir, turns)).rotation * 180) / Math.PI
  const nearAngle = (got: number, want: number) => {
    let d = ((got - want) % 360 + 360) % 360
    if (d > 180) d -= 360
    return Math.abs(d)
  }

  it('full turn cw (same pose, turns=1) → half turn midway', () => {
    // a==b: a bare matrix would not turn; cw+turns=1 forces a full turn.
    expect(nearAngle(degAt(0, 0, 0.5, 'cw', 1), 180)).toBeLessThan(1)
    expect(nearAngle(degAt(0, 0, 0.25, 'cw', 1), 90)).toBeLessThan(1)
  })

  it('cw 90° = short clockwise; ccw toward +90° = the long way (-270°)', () => {
    expect(nearAngle(degAt(0, 90, 0.5, 'cw'), 45)).toBeLessThan(1) // +45
    expect(nearAngle(degAt(0, 90, 0.5, 'ccw'), -135)).toBeLessThan(1) // -135 (counter-clockwise)
  })

  it('auto (no direction) stays the shortest arc', () => {
    expect(nearAngle(degAt(350, 10, 0.5), 0)).toBeLessThan(1) // through 0, not 180
  })

  it('cw with 2 turns = 720° of travel', () => {
    expect(nearAngle(degAt(0, 0, 0.5, 'cw', 2), 0)).toBeLessThan(1) // 720*0.5 = 360 ≡ 0
    expect(nearAngle(degAt(0, 0, 0.25, 'cw', 2), 180)).toBeLessThan(1) // 720*0.25 = 180
  })
})

describe('scheduleSounds — audio scheduling', () => {
  const clip = (startFrame: number) => ({ id: 's', assetId: 'a', startFrame })
  it('future clip: starts later, offset 0', () => {
    const [s] = scheduleSounds([clip(24)], 24, 0, 10) // start=1s, head=0 → +1s
    expect(s.when).toBeCloseTo(11)
    expect(s.offset).toBeCloseTo(0)
  })
  it('already-started clip: starts now, at the right offset', () => {
    const [s] = scheduleSounds([clip(24)], 24, 48, 10) // start=1s, head=2s → we enter at 1s
    expect(s.when).toBeCloseTo(10)
    expect(s.offset).toBeCloseTo(1)
  })
})

describe('lerpTransformPivot — interpolation around a pivot', () => {
  it('pivot {0,0} ⇒ identical to lerpTransform', () => {
    const a = translation(10, 20)
    const b = recompose({ x: 80, y: -30, scaleX: 2, scaleY: 1.5, rotation: 1 })
    const ref = lerpTransform(a, b, 0.37)
    const piv = lerpTransformPivot(a, b, 0.37, { x: 0, y: 0 })
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) expect(piv[k]).toBeCloseTo(ref[k])
  })

  it('in-place rotation around the pivot: the pivot stays fixed (vs lerpTransform which drifts it)', () => {
    const P = { x: 50, y: 0 } // local pivot
    const A = IDENTITY // pivot @ (50,0)
    const B: Transform = { a: 0, b: 1, c: -1, d: 0, e: 50, f: -50 } // 90° rotation AROUND (50,0) → pivot stays @ (50,0)
    const r = lerpTransformPivot(A, B, 0.5, P) // 45° around the pivot
    const pv = apply(r, P)
    expect(pv.x).toBeCloseTo(50) // pivot fixed
    expect(pv.y).toBeCloseTo(0)
    // the local origin orbits around the pivot (at distance 50, rotated by 45°)
    const o = apply(r, { x: 0, y: 0 })
    expect(o.x).toBeCloseTo(50 - 50 * Math.cos(Math.PI / 4)) // ≈ 14.64
    expect(o.y).toBeCloseTo(-50 * Math.sin(Math.PI / 4)) // ≈ -35.36
    // lerpTransform (no pivot) would drift the pivot
    const drift = apply(lerpTransform(A, B, 0.5), P)
    expect(Math.hypot(drift.x - 50, drift.y - 0)).toBeGreaterThan(1)
  })
})

describe('applyEasing', () => {
  it('linear = identity; bounds clamped', () => {
    expect(applyEasing(0.5, 'linear')).toBeCloseTo(0.5)
    expect(applyEasing(-1, 'easeInOut')).toBe(0)
    expect(applyEasing(2, 'easeIn')).toBe(1)
  })

  it('easeIn starts slow, easeOut ends slow', () => {
    expect(applyEasing(0.5, 'easeIn')).toBeLessThan(0.5)
    expect(applyEasing(0.5, 'easeOut')).toBeGreaterThan(0.5)
  })

  it('easeInOut symmetric around 0.5', () => {
    expect(applyEasing(0.5, 'easeInOut')).toBeCloseTo(0.5)
    const a = applyEasing(0.25, 'easeInOut')
    const b = applyEasing(0.75, 'easeInOut')
    expect(a + b).toBeCloseTo(1)
  })

  it('cubic-bezier: linear reproduces the identity', () => {
    // cubic-bezier(0,0,1,1) ≡ linear.
    expect(applyEasing(0.5, { cubic: [0, 0, 1, 1] })).toBeCloseTo(0.5, 2)
  })

  it('easing applied within interpolation (easeIn slows the start)', () => {
    const t = tl([
      track('a', [
        { frame: 0, opacity: 0, easing: 'easeIn' },
        { frame: 10, opacity: 1 },
      ]),
    ])
    expect(evaluateTimeline(t, 5).get('a')!.opacity!).toBeLessThan(0.5)
  })
})

describe('evaluateTimeline — expressions', () => {
  const exprTl = (expressions: Record<string, string>, over: Partial<Timeline> = {}): Timeline => ({
    fps: 1,
    durationFrames: 60,
    tracks: [{ id: 't', targetId: 'a', keyframes: [], expressions }],
    ...over,
  })
  const baseOf = (t: Transform) => (id: string) => (id === 'a' ? { transform: t, opacity: 1 } : undefined)

  it('constant rotation expression; x/y kept from the base', () => {
    const ov = evaluateTimeline(exprTl({ rotation: 'PI/2' }), 0, baseOf(translation(100, 50))).get('a')!
    const d = decompose(ov.transform!)
    expect(d.rotation).toBeCloseTo(Math.PI / 2)
    expect(d.x).toBeCloseTo(100)
    expect(d.y).toBeCloseTo(50)
  })

  it('expression with value and time (fps taken into account)', () => {
    // fps=2 → time = frame/2; x = value + time*10
    const tl = exprTl({ x: 'value + time*10' }, { fps: 2 })
    const ov = evaluateTimeline(tl, 4, baseOf(translation(5, 0))).get('a')! // time=2 → x = 5 + 20 = 25
    expect(decompose(ov.transform!).x).toBeCloseTo(25)
  })

  it('opacity expression (without touching the transform)', () => {
    const ov = evaluateTimeline(exprTl({ opacity: '0.25' }), 0, baseOf(translation(0, 0))).get('a')!
    expect(ov.opacity).toBeCloseTo(0.25)
    expect(ov.transform).toBeUndefined() // only opacity changes
  })

  it('invalid expression ignored (no crash, base kept)', () => {
    const ov = evaluateTimeline(exprTl({ x: '1 +' }), 0, baseOf(translation(7, 7))).get('a')!
    expect(ov.transform).toBeUndefined() // x not touched
  })
})

describe('resolveInstanceFrame', () => {
  it('synced (default) follows the parent, looped over the duration', () => {
    expect(resolveInstanceFrame(undefined, 5, 20)).toBe(5)
    expect(resolveInstanceFrame({ mode: 'synced' }, 25, 20)).toBe(5) // loop
    expect(resolveInstanceFrame({ mode: 'synced' }, 0, 20)).toBe(0)
  })

  it('singleFrame shows a fixed pose', () => {
    expect(resolveInstanceFrame({ mode: 'singleFrame', frame: 12 }, 999, 20)).toBe(12)
    expect(resolveInstanceFrame({ mode: 'singleFrame' }, 5, 20)).toBe(0) // default 0
  })

  it('independent loops on the MONO clock (its own duration), ignoring the parent frame', () => {
    // parentFrame 25 (would synced→5), but mono 50 mod 20 = 10 → immune to the parent's wrap.
    expect(resolveInstanceFrame({ mode: 'independent' }, 25, 20, 50)).toBe(10)
    expect(resolveInstanceFrame({ mode: 'independent' }, 0, 20, 7)).toBe(7)
    expect(resolveInstanceFrame({ mode: 'independent' }, 0, 20, 23)).toBe(3) // wraps on 20, not on the parent
  })

  it('once plays through then HOLDS the last frame (clamped to [0, dur-1])', () => {
    expect(resolveInstanceFrame({ mode: 'once' }, 0, 20, 5)).toBe(5)
    expect(resolveInstanceFrame({ mode: 'once' }, 0, 20, 19)).toBe(19)
    expect(resolveInstanceFrame({ mode: 'once' }, 0, 20, 100)).toBe(19) // held on the last frame
    expect(resolveInstanceFrame({ mode: 'once' }, 0, 20, -3)).toBe(0) // clamped low
  })

  it('independent/once fall back to synced when there is no mono clock (static walk)', () => {
    expect(resolveInstanceFrame({ mode: 'independent' }, 25, 20)).toBe(5) // no monoFrame → parent-driven
    expect(resolveInstanceFrame({ mode: 'once' }, 25, 20)).toBe(5)
  })

  it('synced ignores the mono clock (graphic-symbol style, parent-driven)', () => {
    expect(resolveInstanceFrame({ mode: 'synced' }, 25, 20, 99)).toBe(5)
    expect(resolveInstanceFrame(undefined, 25, 20, 99)).toBe(5)
  })

  it('zero duration → frame 0 (no division by zero)', () => {
    expect(resolveInstanceFrame({ mode: 'synced' }, 7, 0)).toBe(0)
    expect(resolveInstanceFrame({ mode: 'independent' }, 7, 0, 5)).toBe(0)
  })
})

describe('identity & stability', () => {
  it('lerpTransform(t, t, *) ≈ t', () => {
    const t = translation(13, -7)
    const d = decompose(lerpTransform(t, t, 0.37))
    expect(d.x).toBeCloseTo(13)
    expect(d.y).toBeCloseTo(-7)
  })

  it('interpolated IDENTITY stays neutral', () => {
    const d = decompose(lerpTransform(IDENTITY, IDENTITY, 0.5))
    expect(d.x).toBeCloseTo(0)
    expect(d.scaleX).toBeCloseTo(1)
  })
})
