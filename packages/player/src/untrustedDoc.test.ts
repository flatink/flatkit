// What an UNTRUSTED `.flatpack` must not be able to do to the page that plays it — findings of the
// security pass over 0.41..0.43, each reproduced first.
import { describe, it, expect, afterEach } from 'vitest'
import type { Doc } from '@flatkit/types'
import { playHeadless } from './headless'

const I = { a: 1, b: 0, c: 0, d: 1, e: 50, f: 50 }
const square = { id: 'r', color: '#cc3333', path: { subpaths: [{ closed: true, segments: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }, { anchor: { x: 20, y: 20 } }] }] } }
/** A symbol with ONE number param, an instance of it named `inst`, and an `every frame` reading `read`. */
const docWith = (inst: string, param: string, read: string, extra: Partial<Doc> = {}): Doc => ({
  width: 200, height: 200, variables: { b: -1 },
  layers: [{ id: 'L0', name: 'c', visible: true, locked: false, opacity: 1, items: [{ id: 'i1', kind: 'instance', name: inst, transform: I, symbolId: 's' }] }],
  symbols: [{ id: 's', name: 'Robot', layers: [{ id: 'L2', name: 'l', visible: true, locked: false, opacity: 1, items: [square] }], params: [{ name: param, type: 'number', default: '1' }] }],
  timeline: { fps: 24, durationFrames: 60, tracks: [], onEnterFrame: [{ do: 'setVar', name: 'b', value: read }] },
  ...extra,
} as unknown as Doc)

describe('an untrusted document', () => {
  afterEach(() => { delete (Object.prototype as Record<string, unknown>).isAdmin })

  it('cannot write to Object.prototype through an instance named `__proto__`', () => {
    playHeadless(docWith('__proto__', 'isAdmin', '__proto__.isAdmin'), [{ type: 'wait', frames: 2 }])
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined()
  })

  it('cannot freeze the player with a param name built as a regex', () => {
    const t0 = performance.now()
    playHeadless(docWith('R', '(a+)+x', `R.${'a'.repeat(28)}!`), [{ type: 'wait', frames: 2 }])
    expect(performance.now() - t0).toBeLessThan(500)
    expect(() => playHeadless(docWith('R', '(', 'R.x'), [{ type: 'wait', frames: 1 }])).not.toThrow()
  })

  it('cannot make one tick walk billions of frames', () => {
    const d = docWith('R', 'p', 'R.p', {})
    d.timeline = { ...d.timeline!, fps: 6e9, durationFrames: 1e15, frameActions: [{ frame: 3, actions: [{ do: 'setVar', name: 'b', value: '7' }] }] }
    const t0 = performance.now()
    const v = playHeadless(d, [{ type: 'wait', frames: 2 }]).vars
    expect(performance.now() - t0).toBeLessThan(500)
    expect(v.b).toBeDefined()
  })

  it('cannot stall a tick with a long `from` value', () => {
    const d = docWith('R', 'p', '0')
    d.symbols[0].states = [{ param: 'st', states: [{ name: 'a', frame: 0 }, { name: 'b', frame: 10 }], initial: 'a', transition: 0 }]
    d.timeline!.onEnterFrame = [{ do: 'setParam', target: 'R', param: 'st', value: 'a' + ' '.repeat(80000) + 'x' }]
    const t0 = performance.now()
    playHeadless(d, [{ type: 'wait', frames: 3 }])
    expect(performance.now() - t0).toBeLessThan(500)
  })
})
