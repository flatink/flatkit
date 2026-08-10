import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkProgram, formatDiagnostics, applyFixes } from './check'
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

  // A model that forgets `scene { … }` and writes its composition at the root gets one error PER LINE —
  // 72 on a 75-line file, and not one of them contains the word `scene`. Every message is accurate and
  // none names the cause, so the repair pass they are handed returns the same program with the same
  // errors. It cannot guess. Say the cause once instead of the symptom seventy-two times.
  it('composition at the root says the `scene` block is missing, once', () => {
    const src = `size 480 320
group "Hero" at 10,10 {
  layer "art" { rect 0 0 20 20 fill #ff0000 }
}
text "Hi" at 5,5 box 40 20
circle 30 30 5 fill #00ff00
`
    const r = checkProgram(src)
    expect(r.ok).toBe(false)
    const errors = r.diagnostics.filter((d) => d.severity === 'error')
    expect(errors, `got ${errors.length} errors:\n${r.report}`).toHaveLength(1)
    expect(errors[0].message).toMatch(/`scene \{ … \}`/)
    expect(errors[0].message).toMatch(/group/) // names what it saw at the root
    expect(r.report).not.toMatch(/unexpected statement/) // the symptom is gone
  })

  it('a program that HAS a scene keeps its precise per-line errors', () => {
    // The collapse must only fire when the block is genuinely absent, or it would hide real mistakes.
    const src = `size 480 320
scene { layer "a" { group "B" { layer "c" { rect 0 0 10 10 fill #ff0000 } } } }
object "B" { x = speed + 1 }
`
    const r = checkProgram(src)
    expect(r.report).toMatch(/unknown variable "speed"/)
    expect(r.report).not.toMatch(/no `scene/)
  })

  // Reported from a generated activity: the pieces stopped following the finger during a drag. Two
  // `object "X"` blocks — the gesture's, carrying `drag` + `x`/`y`, and a skin pass adding a wobble —
  // and the second REPLACED the first's bindings. Handlers from several blocks already accumulated, so
  // the same construct behaved two ways for its two halves, and the loss was silent: the interactor
  // still wrote the variables, nothing read them, `--check` reported a clean program.
  it('two `object` blocks MERGE their bindings, they do not replace', () => {
    const src = `size 400 400
var ix = 0
var iy = 0
scene { layer "a" { group "It" at 100,100 { layer "c" { circle 0 0 34 fill #ff0000 } } } }
object "It" {
  drag ix, iy
  x = ix
  y = iy
}
object "It" {
  dy = 3 * sin(clock)
}
`
    const r = checkProgram(src)
    expect(r.errors).toBe(0)
    const item = r.doc!.layers[0].items[0] as { expressions?: Record<string, string> }
    expect(item.expressions, 'the drag bindings were dropped by the second block').toEqual({
      x: 'ix', y: 'iy', dy: '3 * sin(clock)',
    })
    expect(r.report, 'different channels merge cleanly — nothing to say').toBe('')
  })

  it('but binding the SAME channel twice warns, because one of them is lost', () => {
    const src = `size 400 400
var ix = 0
scene { layer "a" { group "It" at 100,100 { layer "c" { circle 0 0 34 fill #ff0000 } } } }
object "It" { x = ix }
object "It" { x = 42 }
`
    const r = checkProgram(src)
    expect(r.ok).toBe(true) // a warning, not a refusal
    expect(r.report).toMatch(/binds `x` here and already did on line 4/)
    expect(r.report).toMatch(/dx.*dy|add to a position/) // it points at the additive way out
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

// The point of carrying the repair is that a consumer can apply it WITHOUT a model round-trip: a missing
// separator should not cost a whole regeneration. Measured on the Moiki pipeline: 1 program in 4 compiled,
// and the three failures were three DIFFERENT grammar slips.
describe('applyFixes', () => {
  const scene = 'size 100 100\nscene { layer "a" { group "Box" at 50,50 pivot 0,0 { layer "c" { rect -5 -5 10 10 fill #ffffff } } } }\n'

  it('repairs a run-on interactor line, and the result checks clean', () => {
    const src = scene + 'object "Box" {\n  dragX cx { confine to Box  snap 26 }\n  x = cx\n}\n'
    const before = checkProgram(src)
    expect(before.ok).toBe(false)
    const { text, applied } = applyFixes(src, before.diagnostics)
    expect(applied).toBe(1)
    expect(text).toContain('    confine to Box\n    snap 26\n')
    expect(checkProgram(text).ok).toBe(true)
  })

  it('a multi-line replacement inherits the indentation of the line it replaces', () => {
    const src = scene + 'object "Box" {\n      dragX cx { confine to Box  snap 26 }\n  x = cx\n}\n'
    const { text } = applyFixes(src, checkProgram(src).diagnostics)
    expect(text).toContain('      dragX cx {\n        confine to Box\n        snap 26\n      }\n')
  })

  it('leaves the source untouched when nothing carries a fix', () => {
    const src = scene + 'object "Nowhere" {\n  x = 1\n}\n'
    const r = applyFixes(src, checkProgram(src).diagnostics)
    expect(r).toEqual({ text: src, applied: 0 })
  })

  it('applies several fixes bottom-up, so earlier line numbers stay valid', () => {
    const src = scene + 'object "Box" {\n  dragX cx { confine to Box  snap 26 }\n}\nobject "Box" {\n  dragY cy { confine to Box  snap 13 }\n}\n'
    const { applied, text } = applyFixes(src, checkProgram(src).diagnostics)
    expect(applied).toBe(2)
    expect(text).toContain('    snap 26\n')
    expect(text).toContain('    snap 13\n')
  })
})

// The #1 footgun, and it is mechanical: the parser knows exactly where the second statement begins,
// because that is the token it choked on. Reported from real use -- `rendu = 1   send "success"`.
describe('applyFixes — two statements on one line', () => {
  const scene = 'size 100 100\nscene { layer "a" { group "Box" at 50,50 pivot 0,0 { layer "c" { rect -5 -5 10 10 fill #ffffff } } } }\n'

  it('splits an action swallowed into the expression before it', () => {
    const src = scene.replace('size 100 100\n', 'size 100 100\nvar rendu = 0\n') + 'object "Box" {\n  when clicked {\n    rendu = 1  send "success"\n  }\n}\n'
    const before = checkProgram(src)
    expect(before.ok).toBe(false)
    const { text, applied } = applyFixes(src, before.diagnostics)
    expect(applied).toBe(1)
    expect(text).toContain('    rendu = 1\n    send "success"\n')
    expect(checkProgram(text).ok).toBe(true)
  })

  // Not every pair on one line is broken: `a = 1  b = 2` PARSES -- the statement parser splits at the
  // boundary on its own. Only an ACTION keyword gets swallowed into the expression before it, because the
  // expression parser eats it first. So there is nothing to repair here, and nothing to report.
  it('says nothing about two assignments on one line, which parse', () => {
    const src = scene.replace('size 100 100\n', 'size 100 100\nvar a = 0\nvar b = 0\n') + 'object "Box" {\n  when clicked {\n    a = 1  b = 2\n  }\n}\n'
    expect(checkProgram(src).diagnostics).toEqual([])
    expect(applyFixes(src, []).applied).toBe(0)
  })
})

// The flat parser used to give up "without a position" -- every syntax error landed at 1:1, which is
// accurate about the token and useless about where to look. Now it names the line, and the two mechanical
// slips carry their repair.
describe('applyFixes — syntax slips the flat parser can repair', () => {
  it('`at 12 -16` gets its comma, and the error is positioned', () => {
    const src = 'size 200 200\nscene { layer "a" {\n  group "G" at 12 -16 pivot 0,0 { layer "c" { rect 0 0 4 4 fill #ffffff } }\n} }\n'
    const before = checkProgram(src)
    expect(before.ok).toBe(false)
    expect(before.diagnostics[0].line).toBe(3)
    const { text, applied } = applyFixes(src, before.diagnostics)
    expect(applied).toBe(1)
    expect(text).toContain('at 12,-16')
    expect(checkProgram(text).ok).toBe(true)
  })

  it('`#` used as a comment becomes `//`', () => {
    const src = 'size 200 200\nscene { layer "a" {\n  # a remark\n  rect 0 0 4 4 fill #ffffff\n} }\n'
    const before = checkProgram(src)
    expect(before.ok).toBe(false)
    const { text, applied } = applyFixes(src, before.diagnostics)
    expect(applied).toBe(1)
    expect(text).toContain('  // a remark\n')
    expect(checkProgram(text).ok).toBe(true)
  })

  it('but NOT when the rest of the line would be swallowed', () => {
    // `scene { # c }` -> `scene { // c }` comments out the closing brace. The repair is only offered when
    // the remainder of the line holds no brace; otherwise the author decides.
    const src = 'size 200 200\nscene { layer "a" { rect 0 0 4 4 fill #ffffff # note } }\n'
    expect(checkProgram(src).diagnostics[0].fix).toBeUndefined()
  })
})

// `flatc --fix` end to end. Two rules make it safe unattended: it ITERATES (repairing one error unmasks
// the next -- a run-on interactor line swallows the statements under it), and it reverts unless the error
// count strictly drops.
describe('flatc --fix', () => {
  it('repairs a program with several slips, iterating, and leaves it checking clean', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flatc-fix-'))
    const file = join(dir, 'p.flatink')
    const src = [
      'size 200 200',
      'var rendu = 0',
      'var cx = 0',
      'scene { layer "a" {',
      '  group "Rail" at 100,150 pivot 0,0 hitbox 200 20 { layer "c" { rect -100 -5 200 10 fill #333333 } }',
      '  group "P" at 20 60 pivot 0,0 hitbox 40 40 { layer "c" { circle 0 0 15 fill #ff0000 } }',
      '} }',
      'object "P" {',
      '  dragX cx { confine to Rail  snap 26 }',
      '  x = cx',
      '  when clicked {',
      '    rendu = 1  send "success"',
      '  }',
      '}',
      '',
    ].join('\n')
    writeFileSync(file, src)
    try {
      expect(checkProgram(src).ok).toBe(false)
      const code = await run(['node', 'flatc', file, '--fix', '--no-libs'])
      expect(code).toBe(0)
      const after = readFileSync(file, 'utf8')
      expect(after).toContain('at 20,60')
      expect(after).toContain('    confine to Rail\n    snap 26\n')
      expect(after).toContain('    rendu = 1\n    send "success"\n')
      expect(checkProgram(after).ok).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('leaves the file untouched when nothing is mechanical', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flatc-fix-'))
    const file = join(dir, 'p.flatink')
    const src = 'size 200 200\nscene { layer "a" { group "G" at 10,10 pivot 0,0 { layer "c" { rect 0 0 4 4 fill #ffffff } } } }\nobject "Absent" {\n  x = 1\n}\n'
    writeFileSync(file, src)
    try {
      expect(await run(['node', 'flatc', file, '--fix', '--no-libs'])).toBe(1)
      expect(readFileSync(file, 'utf8')).toBe(src)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
