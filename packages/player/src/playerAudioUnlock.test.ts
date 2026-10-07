// flatink/flatink demos on 0.45 — a looping clip at frame 0 stayed silent for good in Safari. With
// `autoplay` the clips are scheduled at load, outside any gesture: the browser keeps the AudioContext
// suspended and refuses that `resume()`. Nothing asked again afterwards, so no click ever unlocked it.
// The first gesture on the page now resumes the context, and the clips are put back on the playhead.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FlatPlayer } from './player'
import type { Asset, Doc, Layer } from '@flatkit/types'

const fakeCtx = () => new Proxy({}, { get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
const fakeCanvas = () => ({ getContext: () => fakeCtx(), getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 }), addEventListener: () => {}, removeEventListener: () => {}, style: {} }) as unknown as HTMLCanvasElement

let uid = 0
const docWithLoop = (): Doc => {
  const a: Asset = { id: `snd${++uid}`, name: 'tick.wav', kind: 'audio', mime: 'audio/wav', data: 'data:audio/wav;base64,AAAA' }
  const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [] }
  return { width: 100, height: 100, layers: [layer], symbols: [], assets: [a], timeline: { fps: 24, durationFrames: 240, tracks: [], sounds: [{ id: 'c', assetId: a.id, startFrame: 0, loop: true }] } }
}

// One context for the whole file, as in a page: the player shares it between its instances.
const audio = { state: 'suspended', inGesture: false, resumes: 0, refused: 0, started: 0, stopped: 0 }
const listeners: Array<{ type: string; fn: () => void; capture: boolean }> = []
const gesture = async (type: string) => {
  audio.inGesture = true
  for (const l of listeners) if (l.type === type) l.fn()
  audio.inGesture = false
  await flush()
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
let decodes: Array<() => void> = []
const finishDecodes = async () => { await flush(); for (const d of decodes.splice(0)) d(); await flush() }

beforeEach(() => {
  Object.assign(audio, { state: 'suspended', inGesture: false, resumes: 0, refused: 0, started: 0, stopped: 0 })
  decodes = []
  class AudioContext {
    currentTime = 0; destination = {}
    get state() { return audio.state }
    // Safari: outside a gesture the promise stays pending and the context stays suspended.
    resume() { audio.resumes++; if (!audio.inGesture) { audio.refused++; return new Promise<void>(() => {}) } audio.state = 'running'; return Promise.resolve() }
    createBufferSource() { return { buffer: null as unknown, loop: false, onended: null, connect: (x: unknown) => x, start: () => { audio.started++ }, stop: () => { audio.stopped++ } } }
    createGain() { return { gain: { value: 1 }, connect: (x: unknown) => x } }
  }
  class OfflineAudioContext {
    decodeAudioData() { return new Promise((res) => decodes.push(() => res({ duration: 1 }))) }
  }
  const addEventListener = (type: string, fn: () => void, o?: boolean | { capture?: boolean }) => { listeners.push({ type, fn, capture: o === true || (typeof o === 'object' && !!o.capture) }) }
  vi.stubGlobal('window', { addEventListener, removeEventListener: () => {}, devicePixelRatio: 1, AudioContext, OfflineAudioContext })
  vi.stubGlobal('addEventListener', () => {}); vi.stubGlobal('removeEventListener', () => {})
  vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('fetch', () => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('FlatPlayer — an AudioContext born suspended is unlocked by the first gesture on the page', () => {
  it('a click resumes it, and the clips restart from the playhead', async () => {
    const pl = new FlatPlayer(fakeCanvas(), docWithLoop(), { render: false, autoplay: true })
    await finishDecodes()
    expect(audio.state).toBe('suspended') // the load-time resume was refused
    expect(audio.refused).toBeGreaterThan(0)
    const before = { resumes: audio.resumes, started: audio.started }
    await gesture('pointerdown')
    expect(audio.resumes).toBe(before.resumes + 1) // asked INSIDE the gesture
    expect(audio.state).toBe('running')
    expect(audio.started).toBe(before.started + 1) // rescheduled on the playhead, not left where the load put it
    pl.destroy()
  })

  it('listens on the window, in the capture phase: a host that stops the event does not keep the sound locked', async () => {
    const pl = new FlatPlayer(fakeCanvas(), docWithLoop(), { render: false, autoplay: true })
    await finishDecodes()
    for (const type of ['pointerdown', 'pointerup', 'keydown', 'touchend']) expect(listeners.filter((l) => l.type === type && l.capture), type).toHaveLength(1)
    pl.destroy()
  })

  for (const type of ['pointerup', 'keydown', 'touchend']) it(`${type} unlocks it too`, async () => {
    const pl = new FlatPlayer(fakeCanvas(), docWithLoop(), { render: false, autoplay: true })
    await finishDecodes()
    audio.state = 'suspended'
    await gesture(type)
    expect(audio.state).toBe('running')
    pl.destroy()
  })

  it('a gesture on a running context touches nothing: no restart of the clips at every click', async () => {
    const pl = new FlatPlayer(fakeCanvas(), docWithLoop(), { render: false, autoplay: true })
    await finishDecodes()
    await gesture('pointerdown')
    const before = { ...audio }
    await gesture('pointerdown'); await gesture('keydown')
    expect(audio).toEqual(before)
    pl.destroy()
  })

  it('a paused or destroyed player is not started by it', async () => {
    const paused = new FlatPlayer(fakeCanvas(), docWithLoop(), { render: false })
    const gone = new FlatPlayer(fakeCanvas(), docWithLoop(), { render: false, autoplay: true })
    await finishDecodes()
    gone.destroy()
    audio.state = 'suspended'
    const started = audio.started
    await gesture('pointerdown')
    expect(audio.state).toBe('running')
    expect(audio.started).toBe(started)
    paused.destroy()
  })

  it('with audio off, the gesture starts nothing', async () => {
    const pl = new FlatPlayer(fakeCanvas(), docWithLoop(), { render: false, autoplay: true })
    await finishDecodes()
    pl.setAudio(false)
    audio.state = 'suspended'
    const started = audio.started
    await gesture('pointerdown')
    expect(audio.started).toBe(started)
    pl.destroy()
  })
})
