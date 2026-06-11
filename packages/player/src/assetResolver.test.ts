import { describe, it, expect } from 'vitest'
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

  it('an invalid base URL disables the resolver entirely', () => {
    const r = sameOriginAssetResolver('not a url')
    expect(r(asset('logo.png'))).toBeNull()
    expect(r(asset('data:image/png;base64,AAAA'))).toBeNull()
  })
})
