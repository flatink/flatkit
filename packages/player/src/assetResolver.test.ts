import { describe, it, expect, vi } from 'vitest'
import type { Asset } from '@flatkit/types'
import { sameOriginAssetResolver } from './player'

const asset = (data: string): Asset => ({ id: 'a', kind: 'image', name: 'x', mime: 'image/png', data })
const BASE = 'https://app.example/play/scene.flatpack'

describe('sameOriginAssetResolver', () => {
  const resolve = sameOriginAssetResolver(BASE)

  it('passes embedded data: URIs through untouched', () => {
    expect(resolve(asset('data:image/png;base64,AAAA'))).toBe('data:image/png;base64,AAAA')
  })

  it('resolves a relative key against the host base (same origin)', () => {
    expect(resolve(asset('logo.png'))).toBe('https://app.example/play/logo.png') // relative to the base's folder
    expect(resolve(asset('img/hero.png'))).toBe('https://app.example/play/img/hero.png')
    expect(resolve(asset('/root.png'))).toBe('https://app.example/root.png') // host-absolute path, same origin
  })

  it('allows path traversal but only WITHIN the host origin', () => {
    // `../` cannot leave the origin — the host opted into this whole origin, so its own files are fine.
    expect(resolve(asset('../../secret.png'))).toBe('https://app.example/secret.png')
  })

  it('rejects a document trying to pick its own origin (no arbitrary fetch)', () => {
    expect(resolve(asset('http://evil.example/x.png'))).toBeNull()
    expect(resolve(asset('https://evil.example/x.png'))).toBeNull()
    expect(resolve(asset('//evil.example/x.png'))).toBeNull() // protocol-relative
    expect(resolve(asset('javascript:alert(1)'))).toBeNull()
    expect(resolve(asset('file:///etc/passwd'))).toBeNull()
  })

  it('rejects empty / non-string data', () => {
    expect(resolve(asset(''))).toBeNull()
    expect(resolve({ ...asset('x'), data: undefined as unknown as string })).toBeNull()
  })

  it('a RELATIVE base is the host page\'s own: resolved against `location` where there is one', () => {
    // Without a page (Node) it resolves nothing, as before…
    expect(sameOriginAssetResolver('/activities/42/')(asset('logo.png'))).toBeNull()
    // …in a page it used to resolve nothing either — the example of the host guide, embedded assets included.
    vi.stubGlobal('location', { href: 'https://host.example/app/page.html' })
    try {
      const r = sameOriginAssetResolver('/activities/42/')
      expect(r(asset('fx.assets/pic.png'))).toBe('https://host.example/activities/42/fx.assets/pic.png')
      expect(r(asset('data:image/png;base64,AAAA'))).toBe('data:image/png;base64,AAAA')
      expect(r(asset('https://evil.example/x.png'))).toBeNull()
      expect(r(asset('//evil.example/x.png'))).toBeNull()
    } finally { vi.unstubAllGlobals() }
  })

  it('an invalid base URL disables the resolver entirely', () => {
    const r = sameOriginAssetResolver('not a url')
    expect(r(asset('logo.png'))).toBeNull()
    expect(r(asset('data:image/png;base64,AAAA'))).toBeNull()
  })
})
