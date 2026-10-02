import { describe, it, expect, vi } from 'vitest'
import { readFileSync, rmSync, writeFileSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
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

  it('--check on a program using a LOCAL package → exit 0 (the qualified alias is not re-emitted as `fn`)', () => {
    // `use "physics"` inlines `tick` AND the alias `physics.tick`. The alias has no syntax, so printing it
    // back as `fn physics.tick(…)` made the reconstructed program unparseable → 3 phantom errors, exit 1.
    const errs: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => { errs.push(String(s)); return true })
    try {
      expect(run(['node', 'flatc', join(cli, 'scene.flatink'), '--check'])).toBe(0)
      expect(errs.join('')).not.toMatch(/fn physics/)
    } finally {
      spy.mockRestore()
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

  it('--check: surfaces an unknown channel in an object block (dropped silently before the fix)', () => {
    const base = 'size 100 100\nscene {\n  layer "L" {\n    group "G" { layer "c" { circle 0 0 5 fill #f00 } }\n  }\n}\n'
    const bad = join(cli, '__check_bad.flatink')
    const good = join(cli, '__check_good.flatink')
    writeFileSync(bad, base + 'object "G" {\n  scaleZ = 1\n}\n')
    writeFileSync(good, base + 'object "G" {\n  scale = 2\n}\n') // `scale` alias → scaleX + scaleY
    const errs: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => { errs.push(String(s)); return true })
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      expect(run(['node', 'flatc', bad, '--check'])).toBe(1) // unknown channel → non-zero
      expect(errs.join('')).toContain('unknown channel "scaleZ"')
      expect(run(['node', 'flatc', good, '--check'])).toBe(0) // `scale` is valid sugar
    } finally {
      spy.mockRestore()
      outSpy.mockRestore()
      rmSync(bad, { force: true })
      rmSync(good, { force: true })
    }
  })

  // A whole PROGRAM saved as `.flat` used to pass `--check` with "0 symbol(s)" and exit 0 — `parseFlatLib`
  // reads a bag of symbols and ignores everything else. A check written against the wrong extension ALWAYS
  // passed, which is the worst possible answer for tooling: it looks exactly like a safety net.
  it('--check on a PROGRAM saved as .flat fails instead of vacuously passing', () => {
    const disguised = join(cli, '__disguised.flat')
    writeFileSync(disguised, 'var a = 0\nscene { layer "L" { circle 0 0 5 fill #fff } }\nobject "L" { opacity = a }\n')
    const errs: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => { errs.push(String(s)); return true })
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      expect(run(['node', 'flatc', disguised, '--check'])).toBe(1)
      expect(errs.join('')).toMatch(/this is a PROGRAM, not a symbol library/)
      expect(errs.join('')).toMatch(/Rename it to \.flatink/)
    } finally { spy.mockRestore(); outSpy.mockRestore(); rmSync(disguised, { force: true }) }
  })

  // `.flat` libs are auto-discovered from the program's FOLDER, so a broken scratch file next to the program
  // failed the build with an error that never named it. Name the file, and offer the opt-out.
  it('a broken neighbouring .flat is NAMED, and --no-libs skips the auto-discovery', () => {
    const prog = join(cli, '__neighbour_prog.flatink')
    const broken = join(cli, '__neighbour_broken.flat')
    writeFileSync(prog, 'size 100 100\nscene { layer "L" { circle 0 0 5 fill #ffffff } }\n')
    writeFileSync(broken, 'symbol "Broken" {\n  layer "a" { rect 0 0 ZZZ }\n}\n')
    const errs: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => { errs.push(String(s)); return true })
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      expect(run(['node', 'flatc', prog, '--check'])).toBe(1)
      expect(errs.join('')).toContain('__neighbour_broken.flat') // the culprit is named
      expect(errs.join('')).toContain('--no-libs')               // and the way out is offered
      expect(run(['node', 'flatc', prog, '--check', '--no-libs'])).toBe(0) // the program itself is fine
    } finally { spy.mockRestore(); outSpy.mockRestore(); rmSync(prog, { force: true }); rmSync(broken, { force: true }) }
  })

  it('--check <library>.flat lints the asset lib per-symbol (not as a scene)', () => {
    const ok = join(cli, '__lib_ok.flat')
    const warn = join(cli, '__lib_warn.flat')
    const err = join(cli, '__lib_err.flat')
    writeFileSync(ok, 'symbol "Halo" { params { color teinte = #ffe9a8 } layer "c" { circle 0 0 60 fill radial(0.5,0.5,0.5, 0:teinte@0.8, 1:teinte@0) } }')
    writeFileSync(warn, 'symbol "Halo" { params { color teinte = #ffe9a8 } layer "c" { circle 0 0 60 fill radial(0.5,0.5,0.5, 0:teint@0.8, 1:teinte@0) } }') // typo'd param
    writeFileSync(err, 'symbol "S" { timeline 24 24 layer "c" { group "g" at 0,0 pivot 0,0 expr scaleX "nope" { layer "c" { circle 0 0 10 fill #fff } } } }')
    const errs: string[] = [], outs: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => { errs.push(String(s)); return true })
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => { outs.push(String(s)); return true })
    try {
      expect(run(['node', 'flatc', ok, '--check'])).toBe(0) // healthy lib → exit 0
      expect(outs.join('')).toContain('check passed') // success line…
      expect(outs.join('').toLowerCase()).not.toContain('error') // …with NO "error" word (a `grep error` trap)
      errs.length = 0; outs.length = 0
      expect(run(['node', 'flatc', warn, '--check'])).toBe(0) // a warning does not block
      expect(errs.join('')).toMatch(/\[Halo\].*unknown color param "teint"/)
      expect(errs.join('')).not.toContain('[scene]') // parsed as a LIB, not a scene
      expect(outs.join('')).toMatch(/check passed.*1 warning/) // warning count surfaced on success
      errs.length = 0
      expect(run(['node', 'flatc', err, '--check'])).toBe(1) // an expr error blocks
      expect(errs.join('')).toMatch(/\[S\].*unknown variable "nope"/)
    } finally {
      spy.mockRestore(); outSpy.mockRestore()
      for (const f of [ok, warn, err]) rmSync(f, { force: true })
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

  it('--preview --set resolves a state name to its numeric value and bakes it into the preview', async () => {
    const lib = join(cli, '__door.flat')
    writeFileSync(lib, [
      'symbol "Door" {',
      '  timeline 24 24',
      '  states door { closed at 0  open at 24  initial closed }',
      '  layer "panel" { path "M0 0L20 0L20 40L0 40Z" fill #884422 }',
      '}',
      '',
    ].join('\n'))
    const outOpen = join(cli, '__door_open.flatpack')
    const outClosed = join(cli, '__door_closed.flatpack')
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(await run(['node', 'flatc', lib, '--preview', '--set', 'door=open', '-o', outOpen])).toBe(0)
      expect(await run(['node', 'flatc', lib, '--preview', '--set', 'door=closed', '-o', outClosed])).toBe(0)
      const instOf = (f: string) => JSON.parse(readFileSync(f, 'utf8')).layers[0].items[0].params
      expect(instOf(outOpen)).toEqual({ door: 'open' }) // set on the preview instance (resolved at render)
      expect(instOf(outClosed)).toEqual({ door: 'closed' })
    } finally {
      spy.mockRestore()
      rmSync(lib, { force: true })
      rmSync(outOpen, { force: true })
      rmSync(outClosed, { force: true })
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

  it('--render of a MASK scene works under Node (DOMMatrix global injected, not "is not defined")', async () => {
    let hasSkia = true
    const skiaPkg: string = 'skia-canvas'
    try { await import(skiaPkg) } catch { hasSkia = false }
    if (!hasSkia) return // no skia binary → skip
    // A mask layer with a NESTED child layer → the clip path builder does `new DOMMatrix([...])`,
    // which threw "DOMMatrix is not defined" headless (browser global absent under Node) until the fix.
    const prog = join(cli, '__mask.flatink')
    const out = join(cli, '__mask.png')
    writeFileSync(prog, 'size 100 100\nscene {\n  mask layer "M" {\n    circle 50 50 30 fill #ffffff\n    layer "content" {\n      rect 0 0 100 100 fill #ff0000\n    }\n  }\n}\n')
    const errs: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => { errs.push(String(s)); return true })
    try {
      expect(await run(['node', 'flatc', prog, '--render', '-o', out, '--scale', '1'])).toBe(0)
      expect(errs.join('')).not.toContain('DOMMatrix')
      const buf = readFileSync(out)
      expect([...buf.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]) // PNG signature
    } finally {
      spy.mockRestore()
      rmSync(prog, { force: true })
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

// flatink/flatink#6 — `--check` and the compile took the `.flat` files given on the command line; `--play`
// and `--render` dropped them and only saw the ones sitting NEXT to the program. A program whose library
// lives in another folder checked green and then played an empty scene.
describe('flatc — `.flat` libraries passed as arguments reach --play and --render', () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'flatc-libs-'))
    mkdirSync(join(dir, 'lib'))
    writeFileSync(join(dir, 'lib', 'dot.flat'), 'symbol "Dot" {\n  layer "a" {\n    circle 0 0 20 fill #cc3333\n  }\n}\n')
    writeFileSync(join(dir, 'prog.flatink'), 'size 100 100\nvar n = 0\nscene {\n  layer "c" {\n    instance "Dot" as "D" at 50,50\n  }\n}\nobject "D" {\n  when clicked {\n    n = n + 1\n  }\n}\n')
    writeFileSync(join(dir, 's.json'), JSON.stringify([{ type: 'down', x: 50, y: 50 }, { type: 'up', x: 50, y: 50 }]))
    return dir
  }
  it('--play: the instance is there to be clicked', () => {
    const dir = setup()
    const outs: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => { outs.push(String(s)); return true })
    try {
      expect(run(['node', 'flatc', join(dir, 'prog.flatink'), join(dir, 'lib', 'dot.flat'), '--play', '--script', join(dir, 's.json')])).toBe(0)
      expect(JSON.parse(outs.join('')).vars.n).toBe(1)
    } finally {
      spy.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('--render: the instance is drawn', async () => {
    const dir = setup()
    const errs: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => { errs.push(String(s)); return true })
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      const png = join(dir, 'a.png')
      expect(await run(['node', 'flatc', join(dir, 'prog.flatink'), join(dir, 'lib', 'dot.flat'), '--render', '-o', png, '--scale', '1'])).toBe(0)
      const { loadImage, Canvas } = await import('skia-canvas')
      const img = await loadImage(png)
      const c = new Canvas(100, 100)
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      expect([...g.getImageData(50, 50, 1, 1).data]).toEqual([204, 51, 51, 255]) // the dot is drawn
    } finally {
      spy.mockRestore(); out.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// flatink/flatink#24 — a replay is reproducible by default, and `--seed` picks another draw.
describe('flatc --play — random() and --seed', () => {
  const play = (extra: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'flatc-seed-'))
    writeFileSync(join(dir, 'p.flatink'), 'size 100 100\nvar r = 0\nscene {\n  layer "c" {\n  }\n}\nwhen loaded {\n  r = random()\n}\n')
    writeFileSync(join(dir, 's.json'), '[]')
    const outs: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => { outs.push(String(s)); return true })
    try {
      expect(run(['node', 'flatc', join(dir, 'p.flatink'), '--play', '--script', join(dir, 's.json'), '--no-libs', ...extra])).toBe(0)
      return JSON.parse(outs.join('')).vars.r as number
    } finally { spy.mockRestore(); rmSync(dir, { recursive: true, force: true }) }
  }
  it('the same draw from one run to the next', () => { expect(play([])).toBe(play([])) })
  it('--seed N changes it, reproducibly', () => {
    expect(play(['--seed', '5'])).toBe(play(['--seed', '5']))
    expect(play(['--seed', '5'])).not.toBe(play([]))
  })
})

// Found while counting warnings on a consumer's corpus: `flatc … --check | grep -c warning` gave a
// different total from one run to the next. The binary called `process.exit` right after writing, and a
// write to a PIPE is asynchronous on macOS and Windows — anything past the pipe's buffer (64 KB) was
// lost, mid-line. A report that long is exactly the one somebody pipes into a tool.
describe('flatc binary — a long report survives a pipe', () => {
  it('prints every line, and the summary last', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flatc-pipe-'))
    try {
      // 1500 shapes far outside the canvas: one warning each, about 200 KB of report.
      const shapes = Array.from({ length: 1500 }, (_, i) => `    group "Hors${i}" at ${5000 + i},5000 {\n      layer "a" {\n        rect 0 0 10 10 fill #333333\n      }\n    }`).join('\n')
      writeFileSync(join(dir, 'p.flatink'), `size 100 100\nscene {\n  layer "c" {\n${shapes}\n  }\n}\n`)
      const bin = join(dirname(fileURLToPath(import.meta.url)), '../../bin/flatc.mjs')
      const r = spawnSync(process.execPath, [bin, join(dir, 'p.flatink'), '--check', '--no-libs'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/check passed .* 1500 warning\(s\)/)
      // the report itself goes to stderr — also a pipe here
      expect(r.stderr.split('\n').filter((l) => l.includes('warning:'))).toHaveLength(1500)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 60_000)
})

// 0.36 made `L` a straight line. A corpus written before it holds paths of lines that were drawn rounded
// and are not any more — some on purpose (a soft hill written as four points), most not (a hexagon). A
// permanent warning could not tell them apart, and a polyline meant straight would be warned about for
// ever. `--since` is the one-shot answer: it lists what is drawn differently, and the author decides.
describe('flatc --since — what is drawn differently since an earlier version', () => {
  const SRC = [
    'size 400 300', 'scene {', '  layer "c" {',
    '    path "M-20 250 L120 190 L280 240 L420 200" nofill stroke #334455 3',       // line 4: open, 4 points, soft
    '    path "M100 0 L50 87 L-50 87 L-100 0 L-50 -87 L50 -87 Z" fill #223344',      // line 5: closed hexagon
    '    path "M0 0 L40 0 L40 40 L0 40 Z" fill #223344',                             // square: sharp corners only
    '    path "M0 100 L60 60 L140 110 L220 70" smooth nofill stroke #334455 3',      // already says smooth
    '    path "M0 0 C10 -10 20 -10 30 0 L60 20" nofill stroke #334455 3',            // has a curve: not a path of lines
    '    path "M0 200 L1 200.1 L2 200.3 L3 200.6 L4 201" nofill stroke #334455 1',   // gentle and tiny: nothing to see
    '  }', '}', '',
  ].join('\n')
  const report = (args: string[], src = SRC) => {
    const dir = mkdtempSync(join(tmpdir(), 'flatc-since-'))
    writeFileSync(join(dir, 'p.flatink'), src)
    const outs: string[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => { outs.push(String(s)); return true })
    try { return { code: run(['node', 'flatc', join(dir, 'p.flatink'), ...args]) as number, lines: outs.join('').split('\n').filter(Boolean) } }
    finally { spy.mockRestore(); rmSync(dir, { recursive: true, force: true }) }
  }
  it('lists the paths of lines that used to be rounded, with their line, and nothing else', () => {
    const { code, lines } = report(['--since', '0.35'])
    expect(code).toBe(0)
    const listed = lines.filter((l) => /p\.flatink:\d+:/.test(l))
    expect(listed).toHaveLength(2)
    expect(listed[0]).toMatch(/p\.flatink:4: open path of 4 points.*was rounded.*`smooth`/)
    expect(listed[1]).toMatch(/p\.flatink:5: closed path of 6 points/)
  })
  it('says how far each one moves, and sums up', () => {
    const { lines } = report(['--since', '0.35'])
    expect(lines.find((l) => /p\.flatink:4:/.test(l))).toMatch(/moves by up to \d+(\.\d)? (px|units)/)
    expect(lines.at(-1)).toMatch(/2 path\(s\).*1 open.*1 closed/)
  })
  // A long line with gentle turns moves by little of its SIZE and by several units all the same: a hill's
  // highlight across a 960-wide frame moved by 3.9 units, 0.4% of its length, and only `--all` listed it —
  // among 35 000 others.
  it('a long open line that moves by 2 units or more is listed, however small that is of its size', () => {
    const { lines } = report(['--since', '0.35'], 'size 960 540\nscene {\n  layer "c" {\n    path "M-20 250 L220 218 L620 228 L980 222" nofill stroke #ffffff 3\n  }\n}\n')
    const listed = lines.filter((l) => /p\.flatink:\d+:/.test(l))
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatch(/p\.flatink:4: open path of 4 points.*moves by up to 3\.9 units \(0\.4% of its size\)/)
  })
  it('a version that already drew lines straight has nothing to report', () => {
    const { code, lines } = report(['--since', '0.36'])
    expect(code).toBe(0)
    expect(lines.filter((l) => /p\.flatink:\d+:/.test(l))).toEqual([])
    expect(lines.join(' ')).toMatch(/nothing is drawn differently since 0\.36/)
  })
})

// The `flatc` half of a wave of reports from a crew writing real activities (flatink/flatink#16 #21 #23 #38).
describe('flatc — replay and preview, as reported', () => {
  const work = () => mkdtempSync(join(tmpdir(), 'flatc-lot5-'))
  const capture = async (args: string[]) => {
    const outs: string[] = [], errs: string[] = []
    const so = vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => { outs.push(String(s)); return true })
    const se = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => { errs.push(String(s)); return true })
    try { return { code: await run(['node', 'flatc', ...args]), out: outs.join(''), err: errs.join('') } }
    finally { so.mockRestore(); se.mockRestore() }
  }
  const hasSkia = async () => { const skiaPkg: string = 'skia-canvas'; try { await import(skiaPkg); return true } catch { return false } }
  const PROG = `size 200 100
background #ffffff
var lit = 0
var frames = 0
scene {
  layer "a" {
    group "Button" at 50,50 { layer "c" { rect -30 -30 60 60 fill #3366cc } }
    group "Lamp" at 150,50 { layer "c" { rect -30 -30 60 60 fill #cc3333 } }
  }
}
object "Button" { when clicked { lit = lit + 1 } }
object "Lamp" { opacity = lit > 0 }
every frame { frames = frames + 1 }
`

  it('--play: a pointer event takes a frame; --settle 0 gives the instantaneous replay back (#16)', async () => {
    const dir = work()
    try {
      writeFileSync(join(dir, 'p.flatink'), PROG)
      writeFileSync(join(dir, 's.json'), JSON.stringify([{ type: 'tap', target: 'Button' }]))
      const base = [join(dir, 'p.flatink'), '--play', '--script', join(dir, 's.json'), '--no-libs']
      expect(JSON.parse((await capture(base)).out).vars.frames).toBe(2)
      expect(JSON.parse((await capture([...base, '--settle', '0'])).out).vars.frames).toBe(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('--render --script: the image of the state the script reaches (#38)', async () => {
    if (!(await hasSkia())) return
    const dir = work()
    try {
      writeFileSync(join(dir, 'p.flatink'), PROG)
      writeFileSync(join(dir, 's.json'), JSON.stringify([{ type: 'tap', target: 'Button' }, { type: 'expect', vars: { lit: 1 } }]))
      const plain = join(dir, 'plain.png'), played = join(dir, 'played.png')
      expect((await capture([join(dir, 'p.flatink'), '--render', '-o', plain, '--scale', '1', '--no-libs'])).code).toBe(0)
      const r = await capture([join(dir, 'p.flatink'), '--render', '--script', join(dir, 's.json'), '-o', played, '--scale', '1', '--no-libs'])
      expect(r.code).toBe(0)
      expect(r.out).toMatch(/played\.png ✓.*after 2 gesture\(s\)/)
      expect(readFileSync(plain).equals(readFileSync(played)), 'the script changed nothing in the picture').toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 60_000)

  it('--render --script: a `shot` writes the picture at that point, and a failed `expect` fails the run', async () => {
    if (!(await hasSkia())) return
    const dir = work()
    try {
      writeFileSync(join(dir, 'p.flatink'), PROG)
      writeFileSync(join(dir, 's.json'), JSON.stringify([
        { type: 'shot', name: 'before' }, { type: 'tap', target: 'Button' }, { type: 'shot', name: 'after' }, { type: 'expect', vars: { lit: 7 } },
      ]))
      const out = join(dir, 'state.png')
      const r = await capture([join(dir, 'p.flatink'), '--render', '--script', join(dir, 's.json'), '-o', out, '--scale', '1', '--no-libs'])
      expect(existsSync(join(dir, 'state.before.png'))).toBe(true)
      expect(existsSync(join(dir, 'state.after.png'))).toBe(true)
      expect(existsSync(out)).toBe(true) // the final state, always
      expect(readFileSync(join(dir, 'state.before.png')).equals(readFileSync(join(dir, 'state.after.png')))).toBe(false)
      expect(readFileSync(join(dir, 'state.after.png')).equals(readFileSync(out))).toBe(true)
      expect(r.code).toBe(1)
      expect(r.err).toMatch(/expect: lit expected 7, got 1/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 60_000)

  const BAR = `symbol "Bar" {
  params { number long = 3 range 1 5 "length" }
  layer "a" {
    group "Body" pivot 0,0 expr scaleX "long" { layer "p" { rect 0 -10 50 20 fill #3366cc } }
  }
}
`
  it('--preview measures the symbol as it is DRAWN: its `expr` and the --set values (#21)', async () => {
    const dir = work()
    try {
      writeFileSync(join(dir, 'bar.flat'), BAR)
      const size = async (extra: string[]) => {
        const out = join(dir, 'o.flatpack')
        expect((await capture([join(dir, 'bar.flat'), '--preview', '-o', out, ...extra])).code).toBe(0)
        const d = JSON.parse(readFileSync(out, 'utf8'))
        return [d.width, d.height]
      }
      expect(await size([])).toEqual([198, 68]) // long = 3: 150 wide, plus the 24 of padding on each side
      expect(await size(['--set', 'long=5'])).toEqual([298, 68])
      expect(await size(['--set', 'long=1'])).toEqual([98, 68])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  const SWITCH = `symbol "Switch" {
  timeline 24 24
  states pos { off at 0   on at 24   initial off   transition 12 }
  layer "b" {
    group "Ball" at 0,0 { layer "a" { circle 0 0 10 fill #cc3333 } }
    cel 0 tween { pose "Ball" at 0,0 }
    cel 24 { pose "Ball" at 60,0 }
  }
}
`
  it('--preview --frame on a symbol driven by its states says it has no effect, and what to write (#23)', async () => {
    const dir = work()
    try {
      writeFileSync(join(dir, 'sw.flat'), SWITCH)
      const out = join(dir, 'o.flatpack')
      const r = await capture([join(dir, 'sw.flat'), '--preview', '--frame', '12', '-o', out])
      expect(r.code).toBe(0)
      expect(r.err).toMatch(/--frame 12.*"Switch".*states.*--set pos=/s)
      // No state, or frame 0: nothing to say.
      expect((await capture([join(dir, 'sw.flat'), '--preview', '-o', out])).err).not.toMatch(/--frame/)
      writeFileSync(join(dir, 'bar.flat'), BAR)
      expect((await capture([join(dir, 'bar.flat'), '--preview', '--frame', '12', '-o', out])).err).not.toMatch(/states/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
