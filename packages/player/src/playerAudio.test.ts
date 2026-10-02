// flatink/flatink#50 — the first `sound "x"` of an asset was silent: its fetch and decode STARTED in the
// frame that played it (a spike of up to 130 ms), and the sound itself was only "audible on the next
// trigger". Sounds are now decoded when the document loads, and a sound asked for while its asset is
// still decoding plays as soon as it is ready.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FlatPlayer } from './player'
import type { Action } from '@flatkit/engine/actions'
import type { Asset, Doc, Layer } from '@flatkit/types'

const fakeCtx = () => new Proxy({}, { get: (_t, p) => (p === 'measureText' ? () => ({ width: 0 }) : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
const fakeCanvas = () => ({ getContext: () => fakeCtx(), getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 }), addEventListener: () => {}, removeEventListener: () => {}, style: {} }) as unknown as HTMLCanvasElement

let uid = 0
const sound = (): Asset => ({ id: `snd${++uid}`, name: 'bip.wav', kind: 'audio', mime: 'audio/wav', data: 'data:audio/wav;base64,AAAA' })
const docOf = (assets: Asset[], onLoad: Action[] = []): Doc => {
  const layer: Layer = { id: 'L', name: 'c', visible: true, locked: false, opacity: 1, items: [] }
  return { width: 100, height: 100, layers: [layer], symbols: [], assets, timeline: { fps: 24, durationFrames: 1, tracks: [], onLoad } }
}

let live = 0 // AudioContext instances created (creating one before a user gesture earns a browser warning)
let started: unknown[] = [] // buffers handed to a source that was started
let fetched: string[] = []
let decodes: Array<() => void> = [] // pending decodes: call one to let it finish
let now = 0
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const finishDecodes = async () => { await flush(); for (const d of decodes.splice(0)) d(); await flush() }

beforeEach(() => {
  live = 0; started = []; fetched = []; decodes = []; now = 0
  class AudioContext {
    state = 'running'; currentTime = 0; destination = {}
    constructor() { live++ }
    resume() { return Promise.resolve() }
    createBufferSource() { const src = { buffer: null as unknown, loop: false, onended: null, connect: (x: unknown) => x, start: () => { started.push(src.buffer) }, stop: () => {} }; return src }
    createGain() { return { gain: { value: 1 }, connect: (x: unknown) => x } }
    decodeAudioData(b: ArrayBuffer) { return new Promise((res) => decodes.push(() => res({ duration: 1, from: 'live', bytes: b.byteLength }))) }
  }
  class OfflineAudioContext {
    decodeAudioData(b: ArrayBuffer) { return new Promise((res) => decodes.push(() => res({ duration: 1, from: 'offline', bytes: b.byteLength }))) }
  }
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1, AudioContext, OfflineAudioContext })
  vi.stubGlobal('addEventListener', () => {}); vi.stubGlobal('removeEventListener', () => {})
  vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('fetch', (url: string) => { fetched.push(url); return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) }) })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('FlatPlayer — sounds are ready before they are asked for', () => {
  it('every sound asset is fetched and decoded at load, without opening an AudioContext', async () => {
    const a = sound(), b = sound()
    new FlatPlayer(fakeCanvas(), docOf([a, b, { id: 'img', name: 'i.png', kind: 'image', mime: 'image/png', data: 'data:image/png;base64,AAAA' }]), { render: false })
    await flush()
    expect(fetched).toEqual([a.data, b.data]) // the image is not ours to fetch
    expect(decodes).toHaveLength(2)
    expect(live).toBe(0)
  })
  it('with audio off, nothing is fetched', async () => {
    new FlatPlayer(fakeCanvas(), docOf([sound()]), { render: false, audio: false })
    await flush()
    expect(fetched).toEqual([])
  })
  it('a sound decoded at load plays at once when asked for', async () => {
    const a = sound()
    const pl = new FlatPlayer(fakeCanvas(), docOf([a]), { render: false })
    await finishDecodes()
    ;(pl as unknown as { playSound(id: string): void }).playSound(a.id)
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({ from: 'offline' })
  })
})

describe('FlatPlayer — a sound asked for while its asset is still decoding', () => {
  it('plays as soon as it is ready: the FIRST `sound` is heard', async () => {
    const a = sound()
    new FlatPlayer(fakeCanvas(), docOf([a], [{ do: 'sound', assetId: a.id }]), { render: false })
    expect(started).toHaveLength(0) // still decoding
    now = 40
    await finishDecodes()
    expect(started).toHaveLength(1)
  })
  it('asked three times while decoding, it plays once — not a pile-up of the same sound', async () => {
    const a = sound()
    const s: Action = { do: 'sound', assetId: a.id }
    new FlatPlayer(fakeCanvas(), docOf([a], [s, s, s]), { render: false })
    await finishDecodes()
    expect(started).toHaveLength(1)
  })
  it('is dropped when it would come too late to mean anything', async () => {
    const a = sound()
    new FlatPlayer(fakeCanvas(), docOf([a], [{ do: 'sound', assetId: a.id }]), { render: false })
    now = 5000
    await finishDecodes()
    expect(started).toHaveLength(0)
  })
  it('is dropped when the player was destroyed meanwhile', async () => {
    const a = sound()
    const pl = new FlatPlayer(fakeCanvas(), docOf([a], [{ do: 'sound', assetId: a.id }]), { render: false })
    pl.destroy()
    await finishDecodes()
    expect(started).toHaveLength(0)
  })
})

describe('FlatPlayer — a timeline clip whose asset is still decoding when playback starts', () => {
  const withClip = (a: Asset): Doc => { const d = docOf([a]); d.timeline = { fps: 24, durationFrames: 240, tracks: [], sounds: [{ id: 'c', assetId: a.id, startFrame: 0 }] }; return d }
  it('starts once decoded, instead of waiting for the next loop of the timeline', async () => {
    const a = sound()
    new FlatPlayer(fakeCanvas(), withClip(a), { render: false, autoplay: true })
    expect(started).toHaveLength(0)
    await finishDecodes()
    expect(started).toHaveLength(1)
  })
  it('an asset that cannot be decoded is not retried in a loop', async () => {
    const a = sound()
    vi.stubGlobal('fetch', (url: string) => { fetched.push(url); return Promise.reject(new Error('gone')) })
    new FlatPlayer(fakeCanvas(), withClip(a), { render: false, autoplay: true })
    await flush(); await flush(); await flush()
    expect(fetched.length).toBeLessThanOrEqual(2)
    expect(started).toHaveLength(0)
  })
})

describe('FlatPlayer — where there is no OfflineAudioContext', () => {
  it('nothing is decoded at load (that would open an AudioContext before any gesture); the first sound still plays once decoded', async () => {
    const w = window as unknown as Record<string, unknown>
    delete w.OfflineAudioContext
    const a = sound()
    const pl = new FlatPlayer(fakeCanvas(), docOf([a]), { render: false })
    await flush()
    expect([fetched, live]).toEqual([[], 0])
    ;(pl as unknown as { playSound(id: string): void }).playSound(a.id)
    await finishDecodes()
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({ from: 'live' })
  })
})
