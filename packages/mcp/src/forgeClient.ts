// Minimal HTTP client for the forge's public API (`/v1/*`), authenticated with an API KEY (`X-API-Key`).
// The MCP server is just an adapter on top: the forge stays the source of truth.
export type Json = Record<string, unknown>

export type ForgeClient = ReturnType<typeof createForgeClient>

export function createForgeClient(forgeUrl: string, apiKey: string) {
  const base = forgeUrl.replace(/\/+$/, '')

  async function req(path: string, init?: RequestInit): Promise<Json> {
    const r = await fetch(base + path, {
      ...init,
      headers: {
        'X-API-Key': apiKey,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
    const j = (await r.json().catch(() => ({}))) as Json
    // The forge's "business" 4xx responses already return { ok:false, error/errors } -> we pass them through.
    // Only failures with no usable body (auth, network) become an exception.
    if (!r.ok && !('ok' in j) && !('error' in j)) throw new Error(`forge ${r.status} ${path} : ${JSON.stringify(j).slice(0, 300)}`)
    return j
  }

  return {
    base,
    hasKey: apiKey.length > 0,
    searchAssets(query: string, opts: { category?: string; limit?: number } = {}): Promise<Json> {
      const p = new URLSearchParams({ q: query })
      if (opts.category) p.set('category', opts.category)
      if (opts.limit) p.set('limit', String(opts.limit))
      return req('/v1/library/search?' + p.toString())
    },
    getAsset(name: string): Promise<Json> {
      return req('/v1/library/' + encodeURIComponent(name))
    },
    check(source: string, library?: string[]): Promise<Json> {
      return req('/v1/check', { method: 'POST', body: JSON.stringify({ source, ...(library?.length ? { library } : {}) }) })
    },
    preview(source: string, library?: string[], render?: { frame?: number; scale?: number }): Promise<Json> {
      return req('/v1/preview', { method: 'POST', body: JSON.stringify({ source, ...(library?.length ? { library } : {}), ...(render ? { render } : {}) }) })
    },
    publish(source: string, opts: { library?: string[]; title?: string } = {}): Promise<Json> {
      return req('/v1/publish', { method: 'POST', body: JSON.stringify({ source, ...(opts.library?.length ? { library: opts.library } : {}), ...(opts.title ? { title: opts.title } : {}) }) })
    },
    previewSymbolFrames(lib: string, opts: { symbol?: string; set?: Record<string, string | number>; frames: number[]; engine?: 'flatc' | 'player'; scale?: number }): Promise<Json> {
      return req('/v1/preview-symbol-frames', {
        method: 'POST',
        body: JSON.stringify({
          lib,
          frames: opts.frames,
          ...(opts.symbol ? { symbol: opts.symbol } : {}),
          ...(opts.set ? { set: opts.set } : {}),
          ...(opts.engine ? { engine: opts.engine } : {}),
          ...(opts.scale ? { scale: opts.scale } : {}),
        }),
      })
    },
  }
}
