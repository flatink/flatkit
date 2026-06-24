import { describe, it, expect } from 'vitest'
import { parseUnits, printUnits } from './dsl'
import {
  objectToUnits,
  unitsToObject,
  timelineToUnits,
  unitsToTimeline,
  variablesToUnits,
  unitsToVariables,
} from './scriptDoc'
import type { Interaction } from './actions'
import type { Timeline } from './timeline'

describe('scriptDoc — object', () => {
  const interactions: Interaction[] = [
    { id: 'a', targetId: 'btn', event: 'click', actions: [{ do: 'setVar', name: 'score', value: 'score + 1' }] },
    { id: 'b', targetId: 'btn', event: 'enter', actions: [{ do: 'pause' }] },
    { id: 'c', targetId: 'other', event: 'click', actions: [{ do: 'play' }] },
  ]

  it('keeps only the interactions of the target + its expressions', () => {
    const units = objectToUnits('btn', interactions, { rotation: 'time * 2' })
    expect(units).toEqual([
      { kind: 'event', event: 'click', body: [{ do: 'setVar', name: 'score', value: 'score + 1' }] },
      { kind: 'event', event: 'enter', body: [{ do: 'pause' }] },
      { kind: 'binding', channel: 'rotation', expr: 'time * 2' },
    ])
  })

  it('unitsToObject separates events and expressions', () => {
    const r = unitsToObject(objectToUnits('btn', interactions, { rotation: 'time * 2', x: 'mouse.x' }))
    expect(r.events).toEqual([
      { event: 'click', actions: [{ do: 'setVar', name: 'score', value: 'score + 1' }] },
      { event: 'enter', actions: [{ do: 'pause' }] },
    ])
    expect(r.expressions).toEqual({ rotation: 'time * 2', x: 'mouse.x' })
  })

  it('round-trip via text (object)', () => {
    const units = objectToUnits('btn', interactions, { rotation: 'time * 2' })
    const back = parseUnits(printUnits(units))
    expect(back.diagnostics).toEqual([])
    expect(back.units).toEqual(units)
  })

  it('emits + reconstructs additive dx/dy offset bindings (model <-> units bridge)', () => {
    const units = objectToUnits('P', [], { x: '100', dx: '58 * sin(time)', dy: 'wobble' })
    expect(units).toEqual([
      { kind: 'binding', channel: 'x', expr: '100' },
      { kind: 'binding', channel: 'dx', expr: '58 * sin(time)' },
      { kind: 'binding', channel: 'dy', expr: 'wobble' },
    ])
    expect(unitsToObject(units).expressions).toEqual({ x: '100', dx: '58 * sin(time)', dy: 'wobble' })
    const back = parseUnits(printUnits(units)) // round-trip through text
    expect(back.diagnostics).toEqual([])
    expect(back.units).toEqual(units)
  })

  it('interactor + drop: objectToUnits / unitsToObject', () => {
    const inter: Interaction[] = [{ id: 'd', targetId: 'P', event: 'drop', over: 'TargetA', actions: [{ do: 'setVar', name: 'ax', value: 'TargetA.x' }] }]
    const interactors = [{ targetId: 'P', axis: 'xy' as const, varX: 'ax', varY: 'ay', confine: 'Field', grid: 20 }]
    const units = objectToUnits('P', inter, { x: 'ax' }, interactors)
    expect(units).toEqual([
      { kind: 'interactor', axis: 'xy', varX: 'ax', varY: 'ay', confine: 'Field', grid: 20 },
      { kind: 'drop', over: 'TargetA', body: [{ do: 'setVar', name: 'ax', value: 'TargetA.x' }] },
      { kind: 'binding', channel: 'x', expr: 'ax' },
    ])
    const r = unitsToObject(units)
    expect(r.interactor).toEqual({ axis: 'xy', varX: 'ax', varY: 'ay', confine: 'Field', grid: 20 })
    expect(r.drops).toEqual([{ over: 'TargetA', actions: [{ do: 'setVar', name: 'ax', value: 'TargetA.x' }] }])
    expect(r.expressions).toEqual({ x: 'ax' })
  })

  it('round-trip via text (interactor + drop)', () => {
    const inter: Interaction[] = [{ id: 'd', targetId: 'P', event: 'drop', over: 'Z', actions: [{ do: 'pause' }] }]
    const interactors = [{ targetId: 'P', axis: 'x' as const, varX: 'sx', confine: 'Rail' }]
    const units = objectToUnits('P', inter, undefined, interactors)
    const back = parseUnits(printUnits(units))
    expect(back.diagnostics).toEqual([])
    expect(back.units).toEqual(units)
  })
})

describe('scriptDoc — scene / timeline', () => {
  const tl: Timeline = {
    fps: 24,
    durationFrames: 120,
    tracks: [],
    onLoad: [{ do: 'setVar', name: 'score', value: '0' }],
    onEnterFrame: [{ do: 'setVar', name: 't', value: 't + 1' }],
    labels: [
      { frame: 60, name: 'middle' },
      { frame: 0, name: 'start' },
    ],
    frameActions: [{ frame: 30, actions: [{ do: 'pause' }] }],
  }

  it('timelineToUnits sorts markers and frame-actions by frame', () => {
    const units = timelineToUnits(tl)
    expect(units).toEqual([
      { kind: 'event', event: 'load', body: [{ do: 'setVar', name: 'score', value: '0' }] },
      { kind: 'event', event: 'enterFrame', body: [{ do: 'setVar', name: 't', value: 't + 1' }] },
      { kind: 'label', frame: 0, name: 'start' },
      { kind: 'label', frame: 60, name: 'middle' },
      { kind: 'frameActions', frame: 30, body: [{ do: 'pause' }] },
    ])
  })

  it('unitsToTimeline reconstructs the script fields (empty = undefined)', () => {
    const s = unitsToTimeline(timelineToUnits(tl))
    expect(s).toEqual({
      onLoad: tl.onLoad,
      onEnterFrame: tl.onEnterFrame,
      labels: [
        { frame: 0, name: 'start' },
        { frame: 60, name: 'middle' },
      ],
      frameActions: tl.frameActions,
    })
  })

  it('timeline without script → no units', () => {
    expect(timelineToUnits({ fps: 24, durationFrames: 10, tracks: [] })).toEqual([])
    expect(unitsToTimeline([])).toEqual({})
  })

  it('round-trip via text (scene)', () => {
    const units = timelineToUnits(tl)
    const back = parseUnits(printUnits(units))
    expect(back.diagnostics).toEqual([])
    expect(back.units).toEqual(units)
  })
})

describe('scriptDoc — globals', () => {
  it('variables ⇄ let units (round-trip)', () => {
    const vars = { score: 0, lives: 3, gravity: -9.8 }
    const units = variablesToUnits(vars)
    expect(units).toEqual([
      { kind: 'declare', name: 'score', value: 0 },
      { kind: 'declare', name: 'lives', value: 3 },
      { kind: 'declare', name: 'gravity', value: -9.8 },
    ])
    expect(unitsToVariables(units)).toEqual(vars)
    // round-trip via text
    const back = parseUnits(printUnits(units))
    expect(back.diagnostics).toEqual([])
    expect(unitsToVariables(back.units)).toEqual(vars)
  })

  it('no variables → empty', () => {
    expect(variablesToUnits(undefined)).toEqual([])
    expect(unitsToVariables([])).toEqual({})
  })
})
