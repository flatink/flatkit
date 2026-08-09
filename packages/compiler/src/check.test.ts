import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkProgram, formatDiagnostics } from './check'
import { compileFlatpack } from './compile'
import { docHasErrors, lintDoc } from './programDoc'
import { run } from './cli/flatc'

const VALID = `size 200 200
background #ffffff

scene {
  layer "art" {
    group "Box" at 100,100 { layer "c" { rect 0 0 10 10 fill #ff0000 } }
  }
}

object "Box" {
  when clicked { x = 20 }
}
`

/** Runs `flatc --check` on a source and returns everything it wrote to stderr — the reference output. */
async function cliCheck(src: string): Promise<{ code: number; err: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'flatc-check-'))
  const file = join(dir, 'p.flatink')
  writeFileSync(file, src)
  const chunks: string[] = []
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => { chunks.push(String(s)); return true })
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  try {
    return { code: await run(['node', 'flatc', file, '--check', '--no-libs']), err: chunks.join('') }
  } finally {
    spy.mockRestore()
    out.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('checkProgram — the API sees exactly what the CLI sees', () => {
  it('a valid program passes', () => {
    const r = checkProgram(VALID)
    expect(r.ok).toBe(true)
    expect(r.errors).toBe(0)
    expect(r.report).toBe('')
    expect(r.doc).not.toBeNull()
  })

  it('a text that is not FlatInk at all is an ERROR (it used to compile to a silent empty Doc)', () => {
    // `compileFlatpack` swallows unknown top-level statements: the Doc comes back empty and nothing
    // distinguishes it from a valid one. The diagnostic exists only on the SOURCE.
    const src = "this is not flatink at all {{{"
    const r = checkProgram(src)
    expect(r.ok).toBe(false)
    expect(r.errors).toBeGreaterThan(0)
    expect(r.report).toMatch(/unexpected statement/)
    // …and this is precisely what the naive Doc-based call reports:
    expect(docHasErrors(compileFlatpack(src))).toBe(false)
    expect(lintDoc(compileFlatpack(src))).toEqual([])
  })

  it('an `object` binding to a shape is an ERROR — the check no public call could reach', () => {
    const src = `size 200 200
scene { layer "a" { rect 0 0 10 10 as "Boite" fill #ff0000 } }
object "Boite" { x = 5 }
`
    const r = checkProgram(src)
    expect(r.ok).toBe(false)
    expect(r.report).toMatch(/binds to nothing/)
    expect(r.report).toMatch(/is a shape/)
    expect(r.diagnostics[0].scope).toBe('object "Boite"')
    expect(r.diagnostics[0].line).toBe(3) // the author's line, not a rebuilt program's
    // Even handed the source, the Doc-based pass cannot see it: the Doc no longer holds the binding.
    expect(docHasErrors(compileFlatpack(src), src)).toBe(false)
  })

  it('a source the parser REJECTS outright returns a diagnostic instead of throwing', () => {
    const r = checkProgram('scene 400 300\n') // `scene` takes a block, not numbers
    expect(r.ok).toBe(false)
    expect(r.doc).toBeNull()
    expect(r.report).toMatch(/expected/)
  })

  it('warnings do not block: ok stays true and they are counted apart', () => {
    const src = `size 200 200
timeline 24 60

scene {
  layer "art" {
    group "Box" at 100,100 { layer "c" { rect 0 0 10 10 fill #ff0000 } }
  }
}

object "Box" {
  when clicked { doneAt = time }
  scaleX = 1 + pulse(doneAt, 0.6) * 0.2
}
`
    const r = checkProgram(src)
    expect(r.ok).toBe(true)
    expect(r.errors).toBe(0)
    expect(r.warnings).toBeGreaterThan(0)
    expect(r.report).toMatch(/captured on `time`/)
  })

  it('reads the symbol libraries it is given, and lints the symbols too', () => {
    const lib = `symbol "Star" { layer "c" { circle 0 0 5 fill #ffff00 } }`
    const src = `size 200 200
scene { layer "a" { instance "Star" as "s1" at 50,50 } }
object "s1" { rotation = 0.1 }
`
    const withLib = checkProgram(src, { assetSrcs: [lib] })
    expect(withLib.ok).toBe(true)
    expect(withLib.doc?.symbols.map((s) => s.name)).toEqual(['Star']) // the lib really was compiled in
    expect(checkProgram(src).doc?.symbols).toEqual([])
  })

  // `size` is the format's REQUIRED first line, and the compiler silently defaults it to 800x600. That
  // silence is expensive: a generator omitted it across its whole corpus for months, so every document
  // was laid out for one canvas and drawn on another — everything past the real width clipped away,
  // with nothing to say so. A warning, not an error: a fragment being checked on its own is legitimate.
  it('a program that never declares `size` is warned about, without being blocked', () => {
    const src = 'scene { layer "a" { rect 0 0 10 10 fill #ff0000 } }\n'
    const r = checkProgram(src)
    expect(r.ok).toBe(true)
    expect(r.errors).toBe(0)
    expect(r.warnings).toBeGreaterThan(0)
    expect(r.report).toMatch(/`size W H`/)
    expect(r.report).toMatch(/800x600|defaults/)
  })

  it('a program that declares it says nothing', () => {
    expect(checkProgram(VALID).report).not.toMatch(/`size W H`/)
  })

  it('every diagnostic carries a scope, a position and a severity', () => {
    const r = checkProgram("this is not flatink at all {{{")
    for (const d of r.diagnostics) {
      expect(typeof d.scope).toBe('string')
      expect(d.line).toBeGreaterThan(0)
      expect(d.col).toBeGreaterThan(0)
      expect(['error', 'warning']).toContain(d.severity)
    }
    expect(formatDiagnostics(r.diagnostics)).toBe(r.report)
  })
})

// The whole point of the API: it must not drift from the terminal. These compare the two on the very
// sources that exposed the gap — a divergence here means an integrator validating in a service gets a
// different verdict than the same file checked at the prompt.
describe('checkProgram — parity with `flatc --check`', () => {
  const sources: [string, string][] = [
    ['valid program', VALID],
    ['not FlatInk at all', "this is not flatink at all {{{"],
    ['object bound to a shape', `size 200 200\nscene { layer "a" { rect 0 0 10 10 as "Boite" fill #ff0000 } }\nobject "Boite" { x = 5 }\n`],
    ['unknown variable in a handler', `size 200 200\nscene { layer "a" { group "B" { layer "c" { rect 0 0 10 10 fill #f00 } } } }\nobject "B" { x = speed + 1 }\n`],
    ['a warning only', `size 200 200\nvar unused = 3\nscene { layer "a" { group "B" { layer "c" { rect 0 0 10 10 fill #f00 } } } }\nobject "B" { x = 1 }\n`],
  ]

  for (const [label, src] of sources) {
    it(`${label}: same report and same verdict`, async () => {
      const cli = await cliCheck(src)
      const api = checkProgram(src)
      expect(api.report).toBe(cli.err.trimEnd())
      expect(api.ok).toBe(cli.code === 0)
    })
  }
})
