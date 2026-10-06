import { describe, it, expect } from 'vitest'
import type { Doc } from '@flatkit/types'
import { compileFlatpack } from './compile'
import { parseFlat } from '@flatkit/engine/flatFormat'
import { checkProgram } from './check'
import { renderDocToPng, createRenderer } from './cli/render'
import { playHeadless } from '@flatkit/player/debug'
import { run } from './cli/flatc'
import { vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// What a security pass over the 0.36-0.39 changes found, each reproduced before being fixed. Two threats:
// DSL written by a model or an anonymous user and compiled on a server; `.flatpack` documents that are
// untrusted when the player loads them.
const ms = (f: () => unknown): number => { const t = performance.now(); f(); return performance.now() - t }

describe('a crafted document does not crash the renderer', () => {
  // A symbol whose text shows a `text` param: the instance resolves the param table the renderer reads.
  const LBL = 'size 200 100\nsymbol "Lbl" {\n  params {\n    text label = "hi"\n  }\n  layer "c" {\n    text label size 20 color #000000 box 150 30\n  }\n}\nscene { layer "a" { instance "Lbl" as "L" at 10,10 } }\n'
  const craft = (patch: Record<string, unknown>): Doc => {
    const doc = compileFlatpack(LBL)
    Object.assign(doc.symbols[0].layers[0].items[0] as object, patch)
    return doc
  }
  it('`contentParam: "constructor"` (a name every object inherits) draws the text it carries', async () => {
    await expect(renderDocToPng(craft({ contentParam: 'constructor' }), { scale: 1 })).resolves.toBeInstanceOf(Uint8Array)
  }, 60_000)
  it('a `content` that is not a string is drawn as text', async () => {
    await expect(renderDocToPng(craft({ content: 5, contentParam: undefined }), { scale: 1 })).resolves.toBeInstanceOf(Uint8Array)
  }, 60_000)
})

describe('`--check` stays fast on names nobody would write', () => {
  it('"did you mean" is not an edit distance between two 3000-character names', () => {
    const long = (k: number) => 'p' + String(k).padStart(4, '0') + 'x'.repeat(3000)
    const params = Array.from({ length: 30 }, (_, k) => `number ${long(k)} = 1`).join('\n    ')
    const call = Array.from({ length: 30 }, (_, k) => `${long(k)}y = 2`).join(', ')
    const src = `size 200 200\nsymbol "S" {\n  params {\n    ${params}\n  }\n  layer "a" { circle 0 0 5 fill #cc3333 }\n}\nscene { layer "c" { instance "S" as "I" at 10,10 { ${call} } } }\n`
    expect(ms(() => checkProgram(src))).toBeLessThan(3000) // was 22 s
  })
})

describe('large sources', () => {
  it('a path of 130 000 points does not throw (no spread of its coordinates into `Math.max`)', () => {
    const pts = Array.from({ length: 130_000 }, (_, k) => `L${k % 400} ${(k * 7) % 300}`).join(' ')
    expect(() => checkProgram(`size 400 300\nscene { layer "c" { path "M0 0 ${pts}" nofill stroke #000000 1 } }\n`)).not.toThrow()
  })
  it('`--since` on 20 000 paths is linear: it does not re-count lines from the top for each one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flatc-since-big-'))
    try {
      const lines = Array.from({ length: 20_000 }, (_, k) => `    path "M0 ${k} L40 ${k + 5} L80 ${k} L120 ${k + 4}" nofill stroke #000000 1`)
      writeFileSync(join(dir, 'p.flatink'), `size 400 300\nscene {\n  layer "c" {\n${lines.join('\n')}\n  }\n}\n`)
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      try { expect(ms(() => run(['node', 'flatc', join(dir, 'p.flatink'), '--since', '0.35', '--all']))).toBeLessThan(1500) } // was 3.1 s
      finally { spy.mockRestore() }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('`--check` says true things about function parameters', () => {
  it('a value function whose parameter is named `value` or `time` reads its argument: no warning', () => {
    const r = checkProgram('size 100 100\nvar r = 0\nvar q = 0\nfn dbl(value) = value * 2\nfn tw(time) = time + 1\nscene { layer "c" { circle 0 0 5 fill #000000 } }\nwhen loaded {\n  r = dbl(21)\n  q = tw(5)\n}\n')
    expect(r.report).not.toMatch(/parameter "(value|time)"/)
  })
  it('…but a parameter named like a math function or constant is still hidden, and still reported', () => {
    expect(checkProgram('size 100 100\nvar r = 0\nfn f(PI) = PI * 2\nscene { layer "c" { circle 0 0 5 fill #000000 } }\nwhen loaded { r = f(1) }\n').report).toMatch(/parameter "PI" of fn f is hidden/)
  })
})

describe('`flatc --play` reports a gesture it cannot replay, without a stack trace', () => {
  it('an unknown target is one line on stderr and exit code 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flatc-play-err-'))
    try {
      writeFileSync(join(dir, 'p.flatink'), 'size 100 100\nscene { layer "c" { group "G" at 50,50 { layer "a" { circle 0 0 5 fill #000000 } } } }\n')
      writeFileSync(join(dir, 's.json'), JSON.stringify([{ type: 'turn', target: 'Nope', angle: 90 }]))
      const errs: string[] = []
      const se = vi.spyOn(process.stderr, 'write').mockImplementation((x: string | Uint8Array) => { errs.push(String(x)); return true })
      const so = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      let code: unknown
      try { code = run(['node', 'flatc', join(dir, 'p.flatink'), '--play', '--script', join(dir, 's.json'), '--no-libs']) } finally { se.mockRestore(); so.mockRestore() }
      expect(code).toBe(1)
      expect(errs.join('')).toMatch(/^flatc: .*"Nope"/m)
      expect(errs.join('')).not.toMatch(/\n\s+at /) // no stack
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('`repeat` cannot be used to make the compiler build a huge source', () => {
  it('a short library whose loop copies a large body 5000 times is refused quickly', () => {
    const body = Array.from({ length: 400 }, (_, k) => `      path "M${k} 0 L${k + 1} 1" fill #333333`).join('\n')
    const lib = `symbol "Big" {\n  layer "a" {\n    repeat i from 1 to 5000 {\n${body}\n    }\n  }\n}\n`
    let err: unknown
    const t = ms(() => { try { parseFlat(lib) } catch (e) { err = e } })
    expect(String(err)).toMatch(/unfolded source passes/)
    expect(t).toBeLessThan(3000) // was 18 s and 3 GB
  })
  it('a comment full of `repeat x from … to …` with no brace is scanned in linear time', () => {
    // The comment comes LAST: with no `{` after it, a regex over the source retried every split of the ` to `s.
    const lib = `symbol "S" { layer "a" { circle 0 0 5 fill #333333 } }\n// repeat a from ${' to'.repeat(40_000)}\n`
    expect(ms(() => parseFlat(lib))).toBeLessThan(1000) // was 12 s for 120 KB
  })
  it('more than 5000 iterations in all is an error, not a silent cut', () => {
    expect(() => parseFlat('symbol "S" {\n  layer "a" {\n    repeat i from 1 to 6000 { circle $(i) 0 1 fill #333333 }\n  }\n}\n')).toThrow(/more than 5000 iterations/)
  })
})

describe('`--render --script`: what a script may write', () => {
  it('more than 200 `shot`s is refused before anything is written', async () => {
    const skiaPkg: string = 'skia-canvas'
    try { await import(skiaPkg) } catch { return }
    const dir = mkdtempSync(join(tmpdir(), 'flatc-shots-'))
    try {
      writeFileSync(join(dir, 'p.flatink'), 'size 40 40\nscene { layer "c" { circle 20 20 5 fill #000000 } }\n')
      writeFileSync(join(dir, 's.json'), JSON.stringify(Array.from({ length: 201 }, (_, k) => ({ type: 'shot', name: `s${k}` }))))
      const errs: string[] = []
      const se = vi.spyOn(process.stderr, 'write').mockImplementation((x: string | Uint8Array) => { errs.push(String(x)); return true })
      const so = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      let code: unknown
      try { code = await run(['node', 'flatc', join(dir, 'p.flatink'), '--render', '--script', join(dir, 's.json'), '-o', join(dir, 'o.png'), '--scale', '1', '--no-libs']) } finally { se.mockRestore(); so.mockRestore() }
      expect(code).toBe(1)
      expect(errs.join('')).toMatch(/200 shots/)
      const { readdirSync } = await import('node:fs')
      expect(readdirSync(dir).filter((f) => f.endsWith('.png'))).toEqual([])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 60_000)
})

// A seeded run must say the same thing twice, whoever runs it. But drawing and hit-testing drew from the
// same seeded stream as the logic: a channel bound to `random()` shifted every draw a handler made after
// it, so `--play` and `--render --script` disagreed on the same script and the same seed.
describe('`random()`: the logic draws the same numbers, whatever is painted', () => {
  const SRC = 'size 200 100\nvar v = 0\nscene { layer "c" { group "Star" at 50,50 { layer "a" { circle 0 0 10 fill #000000 } } } }\nobject "Star" { dx = random() * 2 }\nwhen loaded { v = floor(random() * 1000) }\n'
  it('`--play` and a renderer agree on what `when loaded` drew', async () => {
    const played = playHeadless(compileFlatpack(SRC), [{ type: 'wait', frames: 1 }]).vars.v
    const r = await createRenderer(compileFlatpack(SRC), { scale: 1, interactive: true })
    try {
      await r.frame(0)
      const res = r.play([{ type: 'wait', frames: 1 }, { type: 'expect', vars: { v: played as number } }])
      expect(res.expectFailures).toEqual([])
    } finally { r.close() }
  }, 60_000)
})

describe('the renderer refuses a picture it cannot afford', () => {
  it('`size 8000 8000` at scale 2 (256 million pixels) is an error, not 3 GB of memory', async () => {
    const doc = compileFlatpack('size 8000 8000\nscene { layer "c" { circle 10 10 5 fill #000000 } }\n')
    await expect(createRenderer(doc, { scale: 2 })).rejects.toThrow(/pixels/)
  }, 60_000)
  it('an ordinary 1920 x 1080 frame at scale 2 is fine', async () => {
    const r = await createRenderer(compileFlatpack('size 1920 1080\nscene { layer "c" { circle 10 10 5 fill #000000 } }\n'), { scale: 2 })
    r.close()
  }, 60_000)
})

// Performance pass over 0.41..0.43 — measured before: locating each Doc warning re-scanned the whole source
// and re-counted its lines (20k warnings: 1.1 s -> 8.6 s), and each scene expression was linted on its own,
// rebuilding the linter's tables every time (20k binds: 0.7 s -> 6 s). Bounds are loose on purpose.
describe('checkProgram — stays linear on a large program', () => {
  const scene = (items: string[]) => ['scene {', '  layer "c" {', ...items.map((i) => `    ${i}`), '  }', '}'].join('\n')
  it('many located warnings', () => {
    const n = 12000
    const src = ['size 200 200', ...Array.from({ length: n }, (_, i) => `var dead${i} = 0`), scene(['circle 0 0 5 fill #000000']), ''].join('\n')
    const t0 = performance.now()
    const r = checkProgram(src)
    const ms = performance.now() - t0
    expect(r.diagnostics.filter((d) => /never used/.test(d.message))).toHaveLength(n)
    expect(r.diagnostics.find((d) => /"dead11999"/.test(d.message))?.line).toBe(12001)
    expect(ms).toBeLessThan(2500)
  }, 60000)
  it('many scene expressions, wrong and right', () => {
    const n = 8000
    const src = ['size 200 200', 'var p = 0', scene(Array.from({ length: n }, (_, i) => `text "{}" at 0,${i} bind "${i % 2 ? 'p + ' + i : 'qq' + i}"`)), ''].join('\n')
    const t0 = performance.now()
    const r = checkProgram(src)
    const ms = performance.now() - t0
    expect(r.diagnostics.filter((d) => /unknown variable "qq/.test(d.message))).toHaveLength(n / 2)
    expect(r.diagnostics.find((d) => /"qq7998"/.test(d.message))?.line).toBe(4 + 7999)
    expect(ms).toBeLessThan(2500)
  }, 60000)
})
