import { describe, it, expect, afterEach } from 'vitest'
import type { Asset, Doc } from '@flatkit/types'
import { loadEmbeddedFonts } from './fonts'

const font = (id: string, family?: string, data = 'data:font/woff2;base64,AAAA'): Asset => ({
  id, kind: 'font', name: `${id}.woff2`, mime: 'font/woff2', data, ...(family ? { family } : {}),
})
const docOf = (assets: Asset[]): Doc => ({ assets }) as unknown as Doc // the helper only reads doc.assets

type GlobalShim = { FontFace?: unknown; document?: unknown }
afterEach(() => {
  delete (globalThis as GlobalShim).FontFace
  delete (globalThis as GlobalShim).document
})

/** Install fake FontFace + document.fonts. Returns the families ATTEMPTED (constructed) and ADDED
 *  (loaded successfully); `preloaded` simulates faces already registered (a remount). */
function installDom(preloaded: string[] = []) {
  const attempted: string[] = []
  const added = new Set<string>(preloaded)
  class FakeFontFace {
    family: string
    constructor(family: string, _src: unknown) {
      this.family = family
      attempted.push(family)
    }
    load(): Promise<unknown> {
      return this.family === 'Bad' ? Promise.reject(new Error('corrupt')) : Promise.resolve(this)
    }
  }
  ;(globalThis as GlobalShim).FontFace = FakeFontFace
  ;(globalThis as GlobalShim).document = {
    fonts: {
      add: (f: { family: string }) => added.add(f.family),
      forEach: (cb: (f: { family: string }) => void) => added.forEach((family) => cb({ family })),
    },
  }
  return { attempted, added: () => [...added] }
}

describe('loadEmbeddedFonts', () => {
  it('no-op outside a DOM (no FontFace) -> resolves without throwing', async () => {
    await expect(loadEmbeddedFonts(docOf([font('Arch')]))).resolves.toBeUndefined()
  })

  it('registers each font as a FontFace, ignores non-fonts, survives a load failure', async () => {
    const dom = installDom()
    await loadEmbeddedFonts(
      docOf([
        font('a', 'Archivo'),
        { id: 'img', kind: 'image', name: 'i.png', mime: 'image/png', data: 'data:image/png;base64,AA' }, // skipped (not a font)
        font('b', 'Bad'), // load() rejects -> dropped, no crash
      ]),
    )
    expect(dom.attempted).toEqual(['Archivo', 'Bad']) // both fonts attempted (image skipped), family = family || id
    expect(dom.added()).toEqual(['Archivo']) // only the one that loaded is added; 'Bad' dropped without crashing
  })

  it('security: rejects a non-`data:` source (remote URL) -> no face attempted, no fetch', async () => {
    const dom = installDom()
    await loadEmbeddedFonts(
      docOf([
        font('evil', 'Evil', 'https://attacker.example/leak.woff2?token=secret'), // arbitrary origin -> skipped
        font('proto', 'Proto', '//attacker.example/x.woff2'), // protocol-relative -> skipped
        font('ok', 'Ok'), // only the data: URI passes
      ]),
    )
    expect(dom.attempted).toEqual(['Ok'])
    expect(dom.added()).toEqual(['Ok'])
  })

  it('security: a non-base64 `data:` URI (crafted) is skipped, no FontFace constructed', async () => {
    const dom = installDom()
    await loadEmbeddedFonts(docOf([font('x', 'Plain', 'data:font/woff2,notbase64')]))
    expect(dom.attempted).toEqual([])
    expect(dom.added()).toEqual([])
  })

  it('idempotent: a family already registered (remount) is not registered again', async () => {
    const dom = installDom(['Archivo']) // already on document.fonts
    await loadEmbeddedFonts(docOf([font('a', 'Archivo'), font('b', 'Brand')]))
    expect(dom.attempted).toEqual(['Brand']) // 'Archivo' skipped, not reconstructed
    expect(dom.added()).toEqual(['Archivo', 'Brand'])
  })
})
