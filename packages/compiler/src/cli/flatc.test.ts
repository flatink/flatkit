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

  it('--preview <library.flat> → wraps one symbol into a playable, auto-sized Doc', async () => {
    const out = join(cli, '__preview.flatpack')
    try {
      expect(await run(['node', 'flatc', join(cli, 'hero.flat'), '--preview', '-o', out])).toBe(0)
      const doc = JSON.parse(readFileSync(out, 'utf8'))
      expect(doc.symbols.map((s: { name: string }) => s.name)).toContain('Hero') // the lib is kept
      expect(doc.layers).toHaveLength(1)
      const inst = doc.layers[0].items[0]
      expect(inst.kind).toBe('instance')
      expect(inst.symbolId).toBe(doc.symbols.find((s: { name: string }) => s.name === 'Hero').id) // resolved ref
      // Hero spans ±24 (48×48); with the default 24px pad the stage is 96×96 and the instance is centered.
      expect(doc.width).toBe(96)
      expect(doc.height).toBe(96)
      expect(inst.transform.e).toBe(48)
      expect(inst.transform.f).toBe(48)
    } finally {
      rmSync(out, { force: true })
    }
  })

  it('--preview --bbox all unions over all frames (drifting motion is not clipped); frame0 keeps the old measure', async () => {
    const lib = join(cli, '__drift.flat')
    // "Dot" drifts from x=0 to x=100 over the timeline — frame 0 sees a 10px box, the union sees ~110px.
    writeFileSync(lib, [
      'symbol "Drift" {',
      '  timeline 24 8',
      '  layer "l" {',
      '    group "Dot" at 0,0 {',
      '      layer "c" {',
      '        path "M-5 -5L5 -5L5 5L-5 5Z" fill #ff0000',
      '      }',
      '    }',
      '    cel 0 tween {',
      '      pose "Dot" at 0,0',
      '    }',
      '    cel 8 {',
      '      pose "Dot" at 100,0',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n'))
    const outAll = join(cli, '__drift_all.flatpack')
    const out0 = join(cli, '__drift_0.flatpack')
    try {
      expect(await run(['node', 'flatc', lib, '--preview', '-o', outAll])).toBe(0) // default = all
      expect(await run(['node', 'flatc', lib, '--preview', '--bbox', 'frame0', '-o', out0])).toBe(0)
      const wAll = JSON.parse(readFileSync(outAll, 'utf8')).width
      const w0 = JSON.parse(readFileSync(out0, 'utf8')).width
      expect(wAll).toBeGreaterThan(w0 + 80) // ~100px of drift captured by the union, clipped at frame 0
    } finally {
      rmSync(lib, { force: true })
      rmSync(outAll, { force: true })
      rmSync(out0, { force: true })
    }
  })

  it('--preview --bbox all caps the frame sampling (a huge durationFrames does not blow up)', async () => {
    const lib = join(cli, '__huge.flat')
    // 1e9 frames: an unbounded union would allocate a billion-element array. The sampler caps it.
    writeFileSync(lib, [
      'symbol "Huge" {',
      '  timeline 24 1000000000',
      '  layer "l" {',
      '    group "Dot" at 0,0 { layer "c" { path "M-5 -5L5 -5L5 5L-5 5Z" fill #ff0000 } }',
      '    cel 0 tween { pose "Dot" at 0,0 }',
      '    cel 8 { pose "Dot" at 100,0 }',
      '  }',
      '}',
      '',
    ].join('\n'))
    const out = join(cli, '__huge.flatpack')
    try {
      const t0 = performance.now()
      expect(await run(['node', 'flatc', lib, '--preview', '-o', out])).toBe(0)
      expect(performance.now() - t0).toBeLessThan(2000) // bounded work, not O(1e9)
      expect(JSON.parse(readFileSync(out, 'utf8')).width).toBeGreaterThan(100) // still captures the drift
    } finally {
      rmSync(lib, { force: true })
      rmSync(out, { force: true })
    }
  })

  it('--preview --symbol NAME selects the symbol; a missing name fails ≠0', async () => {
    const lib = join(cli, '__multi.flat')
    writeFileSync(lib, 'symbol "Dot" {\n  layer "l" { path "M-8 -8L8 -8L8 8L-8 8Z" fill #ff0000 }\n}\nsymbol "Badge" {\n  layer "l" { path "M-30 -30L30 -30L30 30L-30 30Z" fill #000000 }\n}\n')
    const out = join(cli, '__multi.flatpack')
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(await run(['node', 'flatc', lib, '--preview', '--symbol', 'Badge', '-o', out])).toBe(0)
      expect(JSON.parse(readFileSync(out, 'utf8')).layers[0].items[0].name).toBe('Badge')
      expect(await run(['node', 'flatc', lib, '--preview', '--symbol', 'Nope', '-o', out])).toBe(1) // unknown symbol
    } finally {
      spy.mockRestore()
      rmSync(lib, { force: true })
      rmSync(out, { force: true })
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
