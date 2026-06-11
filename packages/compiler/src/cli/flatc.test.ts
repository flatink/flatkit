import { describe, it, expect, vi } from 'vitest'
import { readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { run } from './flatc'
import { resolveLayerAt } from '@flatkit/engine/cel'

// CLI smoke test: compile the shipped example (examples/cli) → playable .flatpack, embedded media.
const cli = join(dirname(fileURLToPath(import.meta.url)), '../../../../examples/cli')

describe('flatc — CLI', () => {
  it('compiles program + auto .flat + media + PACKAGES (use) → playable .flatpack', () => {
    const out = join(cli, '__test_out.flatpack')
    try {
      expect(run(['node', 'flatc', join(cli, 'scene.flatink'), '-o', out])).toBe(0)
      const doc = JSON.parse(readFileSync(out, 'utf8'))
      const names = doc.symbols.map((s: { name: string }) => s.name)
      expect(names).toContain('Hero') // local lib
      expect(names).toContain('Star') // symbol imported via use "shapes"
      expect(doc.assets[0].data.startsWith('data:image/svg+xml;base64,')).toBe(true) // embedded media
      const player = doc.layers[0].items.find((it: { name: string }) => it.name === 'player')
      expect(player.symbolId).toBe(doc.symbols.find((s: { name: string }) => s.name === 'Hero').id) // resolved ref
      // local package "physics" INLINED (bare name + qualified); stdlib "collision" kept as a reference
      const fnNames = (doc.functions ?? []).map((f: { name: string }) => f.name)
      expect(fnNames).toContain('tick')
      expect(fnNames).toContain('physics.tick')
      expect(doc.imports).toEqual(['collision'])
      const rows = resolveLayerAt(doc.layers[0], 0, { fps: 24, ctx: { mouse: { x: 0, y: 0 }, score: 0 } as never })
      expect(Array.isArray(rows)).toBe(true)
    } finally {
      rmSync(out, { force: true })
    }
  })

  it('--assets external → relative keys + sidecar files (no base64)', () => {
    const out = join(cli, '__ext_out.flatpack')
    const assetsDir = join(cli, '__ext_out.assets')
    try {
      expect(run(['node', 'flatc', join(cli, 'scene.flatink'), '-o', out, '--assets', 'external'])).toBe(0)
      const doc = JSON.parse(readFileSync(out, 'utf8'))
      expect(doc.assets[0].data).toBe('__ext_out.assets/logo.svg') // relative key, not embedded
      expect(doc.assets[0].data.startsWith('data:')).toBe(false)
      expect(doc.assets[0].mime).toBe('image/svg+xml')
      expect(existsSync(join(assetsDir, 'logo.svg'))).toBe(true) // sidecar file copied next to the .flatpack
    } finally {
      rmSync(out, { force: true })
      rmSync(assetsDir, { recursive: true, force: true })
    }
  })

  it('refuses media that escapes the program folder (path traversal)', () => {
    // A secret sitting OUTSIDE the program folder, referenced via `../`.
    const secret = join(cli, '..', '__secret.txt')
    const prog = join(cli, '__evil.flatink')
    const out = join(cli, '__evil.flatpack')
    writeFileSync(secret, 'TOP-SECRET-CONTENT')
    writeFileSync(prog, 'size 100 100\nasset "evil" "../__secret.txt" image\nscene {\n  layer "g" {\n    image "evil" 10 10 at 0,0\n  }\n}\n')
    const errs: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => { errs.push(String(s)); return true })
    try {
      expect(run(['node', 'flatc', prog, '-o', out])).toBe(0)
      const raw = readFileSync(out, 'utf8')
      expect(raw).not.toContain('TOP-SECRET-CONTENT') // raw leak
      expect(raw).not.toContain(Buffer.from('TOP-SECRET-CONTENT').toString('base64')) // base64-embedded leak
      expect(errs.join('')).toContain('outside the program folder')
    } finally {
      spy.mockRestore()
      rmSync(secret, { force: true })
      rmSync(prog, { force: true })
      rmSync(out, { force: true })
    }
  })

  it('--play <program> --script <gestures> → prints { sends, vars } (JSON, headless)', () => {
    const script = join(cli, '__gestures.json')
    writeFileSync(script, JSON.stringify([{ type: 'down', x: 10, y: 10 }, { type: 'up', x: 10, y: 10 }]))
    const chunks: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => { chunks.push(String(s)); return true })
    try {
      expect(run(['node', 'flatc', join(cli, 'scene.flatink'), '--play', '--script', script])).toBe(0)
      const parsed = JSON.parse(chunks.join(''))
      expect(parsed).toHaveProperty('sends')
      expect(parsed).toHaveProperty('vars')
      expect(Array.isArray(parsed.sends)).toBe(true)
    } finally {
      spy.mockRestore()
      rmSync(script, { force: true })
    }
  })

  it('--render <file> -o out.png → headless PNG (skia)', async () => {
    let hasSkia = true
    const skiaPkg: string = 'skia-canvas' // non-literal specifier: not resolved at build time (optional native dep)
    try { await import(skiaPkg) } catch { hasSkia = false }
    if (!hasSkia) return // skia binary missing (e.g. CI without download) → skip
    const out = join(cli, '__render_out.png')
    try {
      expect(await run(['node', 'flatc', join(cli, 'scene.flatink'), '--render', '-o', out, '--scale', '1'])).toBe(0)
      const buf = readFileSync(out)
      expect([...buf.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]) // PNG signature
      expect(buf.length).toBeGreaterThan(1000)
    } finally {
      rmSync(out, { force: true })
    }
  })

  it('--render --steps N → runs the sim before capture (still a valid PNG)', async () => {
    let hasSkia = true
    const skiaPkg: string = 'skia-canvas'
    try { await import(skiaPkg) } catch { hasSkia = false }
    if (!hasSkia) return // no skia binary → skip
    const out = join(cli, '__render_steps.png')
    try {
      expect(await run(['node', 'flatc', join(cli, 'scene.flatink'), '--render', '-o', out, '--scale', '1', '--steps', '10'])).toBe(0)
      const buf = readFileSync(out)
      expect([...buf.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]) // PNG signature
      expect(buf.length).toBeGreaterThan(1000)
    } finally {
      rmSync(out, { force: true })
    }
  })
})
