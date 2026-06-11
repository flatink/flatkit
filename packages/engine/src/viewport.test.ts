import { describe, it, expect } from 'vitest'
import { clampScale, fitViewport, screenToWorld, worldToScreen, zoomAround } from './viewport'

describe('viewport', () => {
  it('screenToWorld and worldToScreen are inverses', () => {
    const vp = { tx: 120, ty: -40, scale: 2.5 }
    const w = screenToWorld(vp, 300, 200)
    const s = worldToScreen(vp, w)
    expect(s.x).toBeCloseTo(300)
    expect(s.y).toBeCloseTo(200)
  })

  it('zoomAround keeps the pivot point fixed on screen', () => {
    const vp = { tx: 50, ty: 50, scale: 1 }
    const pivot = { x: 400, y: 300 }
    const worldBefore = screenToWorld(vp, pivot.x, pivot.y)
    const vp2 = zoomAround(vp, 2, pivot.x, pivot.y)
    const screenAfter = worldToScreen(vp2, worldBefore)
    expect(screenAfter.x).toBeCloseTo(pivot.x)
    expect(screenAfter.y).toBeCloseTo(pivot.y)
    expect(vp2.scale).toBe(2)
  })

  it('clampScale bounds the zoom', () => {
    expect(clampScale(1000)).toBe(32)
    expect(clampScale(0.0001)).toBe(0.05)
    expect(clampScale(3)).toBe(3)
  })

  it('fitViewport centers the document', () => {
    const vp = fitViewport(1000, 800, 1200, 800, 80)
    // content centered: equal left/right margins
    expect(vp.tx).toBeCloseTo((1000 - 1200 * vp.scale) / 2)
    expect(vp.ty).toBeCloseTo((800 - 800 * vp.scale) / 2)
    expect(vp.scale).toBeLessThanOrEqual((1000 - 80) / 1200 + 1e-9)
  })
})
