import { describe, it, expect } from 'vitest'
import { stateFrame, stateValueOf, initialStateValue, stateMachineByParam } from './states'
import type { StateMachine } from '@flatkit/types'

const door: StateMachine = { param: 'door', states: [{ name: 'closed', frame: 0 }, { name: 'open', frame: 24 }], transition: 12 }

describe('states — pure state machine resolution', () => {
  it('stateValueOf: name → index, number passthrough, unknown → initial', () => {
    expect(stateValueOf(door, 'closed')).toBe(0)
    expect(stateValueOf(door, 'open')).toBe(1)
    expect(stateValueOf(door, 0.5)).toBe(0.5)
    expect(stateValueOf(door, '1')).toBe(1) // numeric string
    expect(stateValueOf(door, 'nope')).toBe(0) // unknown → initial (first)
    expect(stateValueOf(door, undefined)).toBe(0)
  })

  it('initialStateValue: explicit initial wins, else first', () => {
    expect(initialStateValue(door)).toBe(0)
    expect(initialStateValue({ ...door, initial: 'open' })).toBe(1)
    expect(initialStateValue({ ...door, initial: 'ghost' })).toBe(0) // unknown → first
  })

  it('stateFrame: discrete anchors and fractional in-between', () => {
    expect(stateFrame(door, 0)).toBe(0) // closed
    expect(stateFrame(door, 1)).toBe(24) // open
    expect(stateFrame(door, 0.5)).toBe(12) // mid-transition → the authored in-between frame
    expect(stateFrame(door, -5)).toBe(0) // clamped low
    expect(stateFrame(door, 9)).toBe(24) // clamped high
  })

  it('stateFrame: 3 anchors lerp per segment', () => {
    const sm: StateMachine = { param: 's', states: [{ name: 'a', frame: 0 }, { name: 'b', frame: 10 }, { name: 'c', frame: 50 }] }
    expect(stateFrame(sm, 0.5)).toBe(5) // between a(0) and b(10)
    expect(stateFrame(sm, 1.5)).toBe(30) // between b(10) and c(50)
    expect(stateFrame(sm, 2)).toBe(50)
  })

  it('stateMachineByParam: by name or first', () => {
    const ms = [door, { param: 'light', states: [{ name: 'off', frame: 0 }] }]
    expect(stateMachineByParam(ms, 'light')?.param).toBe('light')
    expect(stateMachineByParam(ms)?.param).toBe('door') // first
    expect(stateMachineByParam(ms, 'ghost')).toBeUndefined()
    expect(stateMachineByParam(undefined)).toBeUndefined()
  })
})
