import { describe, it, expect } from 'vitest'
import type { Doc } from '@flatkit/types'
import { compileFlatpack } from './compile'
import { checkProgram } from './check'
import { renderDocToPng } from './cli/render'
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
