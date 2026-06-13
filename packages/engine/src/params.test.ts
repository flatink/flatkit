import { describe, it, expect } from 'vitest'
import { resolveInstanceParams } from './params'
import type { Instance, SymbolDef } from '@flatkit/types'

const sym = (over: Partial<SymbolDef> = {}): SymbolDef => ({
  id: 's', name: 'Boat', layers: [],
  params: [
    { name: 'hull', type: 'color', default: '#c0392b' },
    { name: 'wave', type: 'number', default: '1', min: 0, max: 2 },
    { name: 'flag', type: 'bool', default: 'true' },
  ],
  ...over,
})
const inst = (params?: Record<string, string>): Pick<Instance, 'params'> => ({ params })

describe('params — resolveInstanceParams', () => {
  it('uses declared defaults (color → color map, number/bool → numeric scope)', () => {
    const r = resolveInstanceParams(sym(), inst())
    expect(r.color).toEqual({ hull: '#c0392b' })
    expect(r.numeric).toEqual({ wave: 1, flag: 1 }) // bool true → 1
  })

  it('call-site values override defaults', () => {
    const r = resolveInstanceParams(sym(), inst({ hull: '#00ff00', wave: '1.5', flag: 'false' }))
    expect(r.color.hull).toBe('#00ff00')
    expect(r.numeric.wave).toBeCloseTo(1.5)
    expect(r.numeric.flag).toBe(0)
  })

  it('numbers are clamped to the declared range', () => {
    expect(resolveInstanceParams(sym(), inst({ wave: '9' })).numeric.wave).toBe(2) // clamp to max
    expect(resolveInstanceParams(sym(), inst({ wave: '-3' })).numeric.wave).toBe(0) // clamp to min
  })

  it('state machines surface as numeric scope values (initial, or a call-site state name)', () => {
    const withState = sym({ states: [{ param: 'door', states: [{ name: 'closed', frame: 0 }, { name: 'open', frame: 24 }], initial: 'closed' }] })
    expect(resolveInstanceParams(withState, inst()).numeric.door).toBe(0) // initial
    expect(resolveInstanceParams(withState, inst({ door: 'open' })).numeric.door).toBe(1) // name → index
  })

  it('no symbol → empty maps', () => {
    expect(resolveInstanceParams(undefined, inst({ x: '1' }))).toEqual({ numeric: {}, color: {} })
  })
})
