// Keyboard input reaching EXPRESSIONS: `keys.<Key>` is 1 while the key is held, 0 otherwise.
//
// REGRESSION: `keys` is a Proxy over the held-keys Set, and the expression sandbox resolves a member
// access with `Object.hasOwn(o, prop)` (own properties only — never reach `constructor`/`__proto__`).
// A get-trap-only Proxy has an EMPTY target, so `hasOwn` was always false and every `keys.<Key>` read
// evaluated to NaN -> 0 via the evaluator's fallback: keyboard input was silently dead in the DSL.
// The proxy now also answers `has`/`getOwnPropertyDescriptor`, so the sandbox guard passes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FlatPlayer } from './player'
import type { Action } from '@flatkit/engine/actions'
import type { Doc } from '@flatkit/types'

const fakeCtx = () =>
  new Proxy(
    {},
    {
      get: (_t, p) => {
        if (p === 'measureText') return () => ({ width: 0 })
        if (p === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
        return () => {}
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D

const fakeCanvas = (): HTMLCanvasElement =>
  ({
    getContext: () => fakeCtx(),
    getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 }),
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {},
  }) as unknown as HTMLCanvasElement

// `every frame` actions, so an expression is evaluated on each stepSim.
function makeDoc(onEnterFrame: Action[], variables: Record<string, number> = {}): Doc {
  return {
    width: 100, height: 100, variables,
    layers: [{ id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [] }],
    symbols: [],
    timeline: { fps: 24, durationFrames: 48, tracks: [], onEnterFrame },
  }
}

type FakeKeyEvent = { key: string; target?: unknown; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; preventDefault: () => void }
type KeyHandlers = Record<string, (e: FakeKeyEvent) => void>

let keyHandlers: KeyHandlers

beforeEach(() => {
  keyHandlers = {}
  const on = (type: string, fn: (e: FakeKeyEvent) => void) => { if (type === 'keydown' || type === 'keyup' || type === 'blur') keyHandlers[type] = fn }
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1 })
  vi.stubGlobal('addEventListener', on)
  vi.stubGlobal('removeEventListener', () => {})
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => vi.unstubAllGlobals())

/** Fires a keydown and reports whether the player consumed it (`preventDefault`). */
function press(key: string, extra: Partial<FakeKeyEvent> = {}): boolean {
  let consumed = false
  keyHandlers.keydown?.({ key, preventDefault: () => { consumed = true }, ...extra })
  return consumed
}
const release = (key: string) => keyHandlers.keyup?.({ key, preventDefault: () => {} })

describe('FlatPlayer -- keys.<Key> in expressions', () => {
  it('reads 1 while held, 0 once released (regression: always 0)', () => {
    const p = new FlatPlayer(fakeCanvas(), makeDoc([{ do: 'setVar', name: 'k', value: 'keys.ArrowRight' }], { k: -1 }), {})
    p.stepSim(1)
    expect(p.getVar('k')).toBe(0) // nothing held

    press('ArrowRight')
    p.stepSim(1)
    expect(p.getVar('k')).toBe(1) // held -> 1 (was 0 before the proxy fix)

    release('ArrowRight')
    p.stepSim(1)
    expect(p.getVar('k')).toBe(0)
  })

  it('an unknown key reads 0, never NaN (a NaN would make `if keys.X` unpredictable)', () => {
    const p = new FlatPlayer(fakeCanvas(), makeDoc([{ do: 'setVar', name: 'k', value: 'keys.NeverPressed * 10 + 5' }]), {})
    p.stepSim(1)
    expect(p.getVar('k')).toBe(5) // 0 * 10 + 5 — a NaN would have collapsed the whole expression to the fallback
  })

  it('drives a conditional: `if keys.Space` only fires while the key is held', () => {
    const body: Action[] = [{ do: 'if', cond: 'keys.Space', then: [{ do: 'setVar', name: 'jumps', value: 'jumps + 1' }] }]
    const p = new FlatPlayer(fakeCanvas(), makeDoc(body, { jumps: 0 }), {})
    p.stepSim(2)
    expect(p.getVar('jumps')).toBe(0)
    press(' ') // the space bar reports key " " -> also registered as "Space"
    p.stepSim(2)
    expect(p.getVar('jumps')).toBe(2)
    release(' ')
    p.stepSim(2)
    expect(p.getVar('jumps')).toBe(2)
  })

  it('the sandbox still holds: keys.<inherited> is not reachable', () => {
    const p = new FlatPlayer(fakeCanvas(), makeDoc([{ do: 'setVar', name: 'k', value: 'keys.constructor' }], { k: -1 }), {})
    p.stepSim(1)
    expect(p.getVar('k')).toBe(0) // a non-numeric member -> NaN -> 0, never a function
  })

  it('input: false (gallery preview) does not attach the key listeners', () => {
    new FlatPlayer(fakeCanvas(), makeDoc([]), { input: false })
    expect(keyHandlers.keydown).toBeUndefined()
  })
})

// The listeners are global (no focus notion): without these guards a scene would eat the keystrokes
// the user types in the host page, and would swallow the page's own scrolling/shortcuts.
describe('FlatPlayer -- keyboard and the host page', () => {
  const doc = () => makeDoc([{ do: 'setVar', name: 'k', value: 'keys.ArrowRight' }], { k: -1 })

  it('ignores a keydown typed in a host form field', () => {
    const p = new FlatPlayer(fakeCanvas(), doc(), {})
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { isContentEditable: true }]) {
      expect(press('ArrowRight', { target })).toBe(false) // not consumed: the field keeps its key
      p.stepSim(1)
      expect(p.getVar('k')).toBe(0) // and the scene never saw it
    }
  })

  it('a keyup is always processed, even from a field (else the key stays stuck down)', () => {
    const p = new FlatPlayer(fakeCanvas(), doc(), {})
    press('ArrowRight') // pressed over the canvas
    p.stepSim(1)
    expect(p.getVar('k')).toBe(1)
    keyHandlers.keyup?.({ key: 'ArrowRight', target: { tagName: 'INPUT' }, preventDefault: () => {} })
    p.stepSim(1)
    expect(p.getVar('k')).toBe(0)
  })

  it('consumes ONLY the keys the scene reads (the page keeps scrolling otherwise)', () => {
    new FlatPlayer(fakeCanvas(), doc(), {})
    expect(press('ArrowRight')).toBe(true) // read by the scene -> no page scroll
    expect(press('ArrowLeft')).toBe(false) // not read -> native behavior preserved
    expect(press('a')).toBe(false)
  })

  it('`keys.Space` consumes the space bar (reported as " ")', () => {
    new FlatPlayer(fakeCanvas(), makeDoc([{ do: 'setVar', name: 'k', value: 'keys.Space' }]), {})
    expect(press(' ')).toBe(true)
    expect(press('x')).toBe(false)
  })

  it('never consumes a browser/OS shortcut nor Tab (accessibility)', () => {
    new FlatPlayer(fakeCanvas(), makeDoc([{ do: 'setVar', name: 'k', value: 'keys.ArrowRight + keys.Tab + keys.F5' }]), {})
    expect(press('ArrowRight', { ctrlKey: true })).toBe(false)
    expect(press('ArrowRight', { metaKey: true })).toBe(false)
    expect(press('ArrowRight', { altKey: true })).toBe(false)
    expect(press('Tab')).toBe(false)
    expect(press('F5')).toBe(false)
    expect(press('ArrowRight')).toBe(true) // …but the plain key is still consumed
  })

  // Same write path as a physical key: for an on-screen D-pad (touch) and the headless `key` gesture.
  it('setKey drives keys.<Name> programmatically, and stays held until released', () => {
    const p = new FlatPlayer(fakeCanvas(), doc(), {})
    p.setKey('ArrowRight', true)
    p.stepSim(1)
    expect(p.getVar('k')).toBe(1)
    p.stepSim(1)
    expect(p.getVar('k')).toBe(1) // still held — no auto-release
    p.setKey('ArrowRight', false)
    p.stepSim(1)
    expect(p.getVar('k')).toBe(0)
  })

  it('setKey(" ") and setKey("Space") both drive keys.Space', () => {
    for (const name of [' ', 'Space']) {
      const p = new FlatPlayer(fakeCanvas(), makeDoc([{ do: 'setVar', name: 'k', value: 'keys.Space' }]), {})
      p.setKey(name, true)
      p.stepSim(1)
      expect(p.getVar('k')).toBe(1)
      p.setKey(name, false)
      p.stepSim(1)
      expect(p.getVar('k')).toBe(0)
    }
  })

  it('losing the window releases the held keys (alt-tab delivers no keyup)', () => {
    const p = new FlatPlayer(fakeCanvas(), doc(), {})
    press('ArrowRight')
    p.stepSim(1)
    expect(p.getVar('k')).toBe(1)
    keyHandlers.blur?.({ key: '', preventDefault: () => {} })
    p.stepSim(1)
    expect(p.getVar('k')).toBe(0)
  })
})
