import { describe, it, expect, vi, afterEach } from 'vitest'
import { createForgeClient } from './forgeClient.ts'

const mockFetch = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
const callOf = (f: ReturnType<typeof mockFetch>) => f.mock.calls[0] as unknown as [string, RequestInit]

afterEach(() => { vi.restoreAllMocks() })

describe('forgeClient', () => {
  it('search_assets -> GET /v1/library/search (q/category/limit) + X-API-Key', async () => {
    const f = mockFetch(200, { ok: true, assets: [] })
    vi.stubGlobal('fetch', f)
    await createForgeClient('http://forge.test/', 'key123').searchAssets('cat', { category: 'animals', limit: 5 })
    const [url, init] = callOf(f)
    expect(url).toBe('http://forge.test/v1/library/search?q=cat&category=animals&limit=5')
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('key123')
  })

  it('preview -> POST /v1/preview with source + library (omitted when empty)', async () => {
    const f = mockFetch(200, { ok: true, png: 'data:image/png;base64,AAA', width: 50, height: 50 })
    vi.stubGlobal('fetch', f)
    const r = await createForgeClient('http://forge.test', 'k').preview('size 50 50', ['soap'])
    const [url, init] = callOf(f)
    expect(url).toBe('http://forge.test/v1/preview')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ source: 'size 50 50', library: ['soap'] })
    expect((r as { png: string }).png).toBe('data:image/png;base64,AAA')
  })

  it('publish without library -> no library field in the body', async () => {
    const f = mockFetch(200, { ok: true, url: 'http://x/p/1' })
    vi.stubGlobal('fetch', f)
    await createForgeClient('http://forge.test', 'k').publish('s', { title: 'T' })
    expect(JSON.parse(callOf(f)[1].body as string)).toEqual({ source: 's', title: 'T' })
  })

  it('previewSymbolFrames -> POST /v1/preview-symbol-frames (lib/frames/engine; empty fields omitted)', async () => {
    const f = mockFetch(200, { ok: true, engine: 'player', frames: ['data:image/png;base64,AAA'], width: 64, height: 64 })
    vi.stubGlobal('fetch', f)
    await createForgeClient('http://forge.test', 'k').previewSymbolFrames('symbol "X" {}', { frames: [0, 4], engine: 'player', set: { state: 'on' } })
    const [url, init] = callOf(f)
    expect(url).toBe('http://forge.test/v1/preview-symbol-frames')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ lib: 'symbol "X" {}', frames: [0, 4], engine: 'player', set: { state: 'on' } })
  })

  it('business error (400 ok:false) surfaced WITHOUT throwing (LLM feedback)', async () => {
    const f = mockFetch(400, { ok: false, error: 'not found', unresolved: [{ name: 'soapp', suggestions: ['soap'] }] })
    vi.stubGlobal('fetch', f)
    const r = (await createForgeClient('http://forge.test', 'k').publish('s', { library: ['soapp'] })) as { ok: boolean; error: string }
    expect(r.ok).toBe(false)
    expect(r.error).toBe('not found')
  })

  it('failure with no usable body (401) -> throws', async () => {
    const f = vi.fn(async () => new Response('', { status: 401 }))
    vi.stubGlobal('fetch', f)
    await expect(createForgeClient('http://forge.test', '').getAsset('x')).rejects.toThrow(/401/)
  })
})
