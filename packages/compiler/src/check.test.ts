import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkProgram, formatDiagnostics, applyFixes, repairLoop } from './check'
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
// separator should not cost a whole regeneration. Measured on an integrator's generation pipeline: 1 program in 4 compiled,
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

// `--fix` writes to the AUTHOR'S file, so the failure modes matter more than the happy path.
describe('flatc --fix — what it must never do to your file', () => {
  const mk = (src: string) => { const dir = mkdtempSync(join(tmpdir(), 'flatc-fix-')); const file = join(dir, 'p.flatink'); writeFileSync(file, src); return { dir, file } }

  it('does not touch the file at all when there is nothing to repair', async () => {
    // It used to rewrite the original unconditionally. Identical bytes, but a new mtime -- which wakes
    // every watcher pointed at the folder, and fails outright on a read-only checkout.
    const { dir, file } = mk('size 200 200\nscene { layer "a" { group "G" at 10,10 pivot 0,0 { layer "c" { rect 0 0 4 4 fill #ffffff } } } }\nobject "Absent" {\n  x = 1\n}\n')
    try {
      const before = statSync(file).mtimeMs
      await new Promise((r) => setTimeout(r, 10))
      expect(await run(['node', 'flatc', file, '--fix', '--no-libs'])).toBe(1)
      expect(statSync(file).mtimeMs).toBe(before)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  // The guarantee is STRUCTURAL, not observed: the loop is a pure function with no filesystem in it, so
  // the CLI can only write once, after it returns. A loop that wrote each pass and reverted on failure
  // would leave a window where the author's file holds a version we already know we do not want.
  it('the repair loop never touches the filesystem, and returns a text that checks clean', () => {
    const src = 'size 200 200\nvar cx = 0\nscene { layer "a" {\n  group "P" at 20,60 pivot 0,0 hitbox 40 40 { layer "c" { circle 0 0 15 fill #ff0000 } }\n} }\nobject "P" {\n  dragX cx { confine to P  snap 26 }\n  x = cx\n}\n'
    const r = repairLoop(src, checkProgram(src).diagnostics, (candidate) => checkProgram(candidate).diagnostics)
    expect(r.applied).toBeGreaterThan(0)
    expect(r.errors).toBe(0)
    expect(r.first).toBeGreaterThan(0)
    expect(checkProgram(r.text).ok).toBe(true)
  })

  it('keeps the LAST ACCEPTED text when a pass makes things worse', () => {
    const src = 'size 200 200\nvar cx = 0\nscene { layer "a" {\n  group "P" at 20,60 pivot 0,0 hitbox 40 40 { layer "c" { circle 0 0 15 fill #ff0000 } }\n} }\nobject "P" {\n  dragX cx { confine to P  snap 26 }\n  x = cx\n}\n'
    const r = repairLoop(src, checkProgram(src).diagnostics, () => [{ scope: 'scene', line: 1, col: 1, severity: 'error', message: 'worse' }, { scope: 'scene', line: 2, col: 1, severity: 'error', message: 'worse' }, { scope: 'scene', line: 3, col: 1, severity: 'error', message: 'worse' }])
    expect(r.applied).toBe(0)
    expect(r.text).toBe(src)
  })

  it('gives up rather than loop when a recheck throws', () => {
    const src = 'size 200 200\nvar cx = 0\nscene { layer "a" {\n  group "P" at 20,60 pivot 0,0 hitbox 40 40 { layer "c" { circle 0 0 15 fill #ff0000 } }\n} }\nobject "P" {\n  dragX cx { confine to P  snap 26 }\n  x = cx\n}\n'
    const r = repairLoop(src, checkProgram(src).diagnostics, () => { throw new Error('boom') })
    expect(r).toMatchObject({ applied: 0, text: src })
  })
})

// `applyFixes` is PUBLIC: the diagnostics it is handed may have been stored, replayed against a changed
// file, or built by a consumer. A position it cannot honour must be skipped, never applied blind -- a
// negative column silently truncates the line through `slice`.
describe('applyFixes — a position it cannot trust is skipped', () => {
  const src = 'size 100 100\nscene { layer "a" { rect 0 0 4 4 fill #ffffff } }\n'
  const edit = (fix: { line: number; col: number; endLine: number; endCol: number; replacement: string }) =>
    applyFixes(src, [{ scope: 'scene', line: 1, col: 1, severity: 'error', message: 'x', fix }])

  it('skips a non-positive column instead of truncating the line', () => {
    expect(edit({ line: 2, col: 0, endLine: 2, endCol: 5, replacement: 'X' })).toEqual({ text: src, applied: 0 })
    expect(edit({ line: 2, col: -3, endLine: 2, endCol: 5, replacement: 'X' })).toEqual({ text: src, applied: 0 })
  })

  it('skips a range that runs backwards', () => {
    expect(edit({ line: 2, col: 10, endLine: 2, endCol: 4, replacement: 'X' })).toEqual({ text: src, applied: 0 })
    expect(edit({ line: 2, col: 1, endLine: 1, endCol: 4, replacement: 'X' })).toEqual({ text: src, applied: 0 })
  })

  it('skips a line past the end of the file', () => {
    expect(edit({ line: 99, col: 1, endLine: 99, endCol: 2, replacement: 'X' })).toEqual({ text: src, applied: 0 })
  })
})

// `--fix` writes AT MOST ONCE, whichever path it takes -- including a source that does not parse at all,
// where the repair used to run one write per syntax error. The observable proof is the mtime: one bump
// for a file that needed several repairs, and none at all for a file that needed none.
describe('flatc --fix — one write, or none', () => {
  const mk = (src: string) => { const dir = mkdtempSync(join(tmpdir(), 'flatc-fix-')); const file = join(dir, 'p.flatink'); writeFileSync(file, src); return { dir, file } }
  const BROKEN_TWICE = 'size 200 200\nvar cx = 0\nscene { layer "a" {\n  group "P" at 20 60 pivot 0,0 hitbox 40 40 { layer "c" { circle 0 0 15 fill #ff0000 } }\n  group "Q" at 80 90 pivot 0,0 { layer "c" { circle 0 0 5 fill #00ff00 } }\n} }\nobject "P" {\n  dragX cx { confine to P  snap 26 }\n  x = cx\n}\n'

  it('repairs two SYNTAX errors and a run-on line in a single write', async () => {
    const { dir, file } = mk(BROKEN_TWICE)
    try {
      expect(checkProgram(BROKEN_TWICE).ok).toBe(false)
      expect(await run(['node', 'flatc', file, '--fix', '--no-libs'])).toBe(0)
      const after = readFileSync(file, 'utf8')
      expect(after).toContain('at 20,60')
      expect(after).toContain('at 80,90')
      expect(after).toContain('    confine to P\n    snap 26\n')
      expect(checkProgram(after).ok).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('does not touch a file it cannot repair mechanically', async () => {
    const { dir, file } = mk('size 200 200\nscene { layer "a" { group "G" at 10,10 pivot 0,0 { layer "c" { rect 0 0 4 4 fill #ffffff } } } }\nobject "Absent" {\n  x = 1\n}\n')
    try {
      const before = statSync(file).mtimeMs
      await new Promise((r) => setTimeout(r, 12))
      expect(await run(['node', 'flatc', file, '--fix', '--no-libs'])).toBe(1)
      expect(statSync(file).mtimeMs).toBe(before)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

// flatink/flatink#67 — behaviors that compiled, passed `--check`, and could never happen.
describe('checkProgram — a behavior that can never happen is named', () => {
  const prog = (behavior: string, head = '') => [
    'size 200 200', 'timeline 24 60', 'var px = 0', 'var py = 0', 'var qx = 0', 'var n = 0', head,
    'scene {', '  layer "art" {',
    '    group "Box" at 100,100 { layer "c" { rect 0 0 10 10 fill #ff0000 } }',
    '    group "Zone" at 10,10 { layer "c" { rect 0 0 30 30 fill #00ff00 } }',
    '    text "Hello" as "msg" at 10,150',
    '  }', '}', behavior, ''].join('\n')
  const about = (src: string, re: RegExp) => checkProgram(src).diagnostics.filter((d) => re.test(d.message)).map((d) => `${d.severity} ${d.line}: ${d.message}`)

  it('two interactors in one object: only the last one worked', () => {
    expect(about(prog('object "Box" {\n  drag px, py\n  dragX qx\n}'), /interactor/)).toEqual([expect.stringMatching(/^error 15: .*"Box".*one interactor/)])
    expect(about(prog('object "Box" {\n  drag px, py\n}\nobject "Box" {\n  dragX qx\n}'), /interactor/)).toHaveLength(1)
    expect(about(prog('object "Box" {\n  drag px, py\n}'), /interactor/)).toEqual([])
  })
  it('`at frame` between two whole frames, or past the last one', () => {
    expect(about(prog('at frame 59.5 { n = 1 }'), /at frame/)).toEqual([expect.stringMatching(/^warning 15: .*59\.5.*whole/i)])
    expect(about(prog('at frame 75 { n = 1 }'), /at frame/)).toEqual([expect.stringMatching(/^warning 15: .*75.*last frame is 59/)])
    expect(about(prog('at frame 59 { n = 1 }'), /at frame/)).toEqual([])
  })
  it('`when dropped on` with nothing to drag', () => {
    expect(about(prog('object "Box" {\n  when dropped on Zone { n = 1 }\n}'), /dropped on/)).toEqual([expect.stringMatching(/^warning 15: .*"Box".*drag/)])
    expect(about(prog('object "Box" {\n  drag px, py\n  when dropped on Zone { n = 1 }\n}'), /dropped on/)).toEqual([])
  })
  it('`sound` of an undeclared asset, `text("…")` of a missing text', () => {
    expect(about(prog('object "Box" {\n  when clicked {\n    sound "boom"\n  }\n}'), /boom/)).toEqual([expect.stringMatching(/^error 17: .*no asset "boom"/)])
    expect(about(prog('object "Box" {\n  when clicked {\n    sound "boom"\n  }\n}', 'asset "boom" "boom.mp3" sound'), /boom/)).toEqual([])
    expect(about(prog('object "Box" {\n  when clicked {\n    send "answer", text("absent")\n  }\n}'), /absent/)).toEqual([expect.stringMatching(/^error 17: .*no text "absent"/)])
    expect(about(prog('object "Box" {\n  when clicked {\n    send "answer", text("msg")\n  }\n}'), /msg/)).toEqual([])
  })
})

// flatink/flatink#68 (from #66.6) — the expressions a scene item carries (`bind`, `draw`, `count`, an `expr`
// attribute) were never linted when checking a `.flatink`: `bind "p +* 2"` passed `--check`.
describe('checkProgram — the expressions written on scene items are linted', () => {
  const prog = (item: string, behavior = '') => ['size 200 200', 'var p = 0', 'var xs = [1, 2]', 'var ys = [1, 2]',
    'scene {', '  layer "art" {', `    ${item}`, '  }', '}', behavior, ''].join('\n')
  const errs = (src: string) => checkProgram(src).diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.line}: ${d.message}`)
  it('a bound text, a drawn stroke, a polyline count, an `expr` attribute', () => {
    expect(errs(prog('text "{}" at 10,10 bind "p +* 2"'))).toEqual([expect.stringMatching(/^7: .*bind.*invalid expression/)])
    expect(errs(prog('text "{}" at 10,10 bind "zork(p) + qq"'))).toEqual([expect.stringMatching(/^7: .*unknown function "zork"/), expect.stringMatching(/^7: .*unknown variable "qq"/)])
    expect(errs(prog('path "M0 0 L100 0" nofill stroke #000000 2 draw "qq"'))).toEqual([expect.stringMatching(/^7: .*draw.*unknown variable "qq"/)])
    expect(errs(prog('polyline xs ys count "qq + 1" nofill stroke #000000 2'))).toEqual([expect.stringMatching(/^7: .*count.*unknown variable "qq"/)])
    expect(errs(prog('group "G" at 0,0 expr x "qq + 1" { layer "a" { circle 0 0 5 fill #000000 } }'))).toEqual([expect.stringMatching(/^7: .*unknown variable "qq"/)])
  })
  it('correct ones say nothing, and an object binding is not reported twice', () => {
    expect(errs(prog('text "{}" at 10,10 bind "p * 2" decimals 1'))).toEqual([])
    expect(errs(prog('group "G" at 0,0 { layer "a" { circle 0 0 5 fill #000000 } }', 'object "G" {\n  x = qq\n}'))).toHaveLength(1)
  })
})

// flatink/flatink#68 (from #64.4c) — the Doc-level warnings were all placed at `1:1`: right file, no line.
// Placed where their subject is written.
describe('checkProgram — a Doc-level warning points at its line', () => {
  const LIB = ['symbol "Robot" {', '  params {', '    number queue = 1 range 0 2', '  }', '  layer "l" {', '    rect 0 0 20 20 fill #cc3333', '  }', '}', ''].join('\n')
  const src = [
    'size 200 200', //                                   1
    'var used = 0', //                                   2
    'var dead = 0', //                                   3
    'fn round(x) = x', //                                4
    LIB.trimEnd(), //                                    5-12
    'scene {', //                                        13
    '  layer "c" {', //                                  14
    '    instance "Robot" as "R" at 50,50 { queu = 1 }', // 15
    '    group "B" at 100,100 { layer "a" { circle 0 0 10 fill #000000 } }', // 16
    '  }', '}', //                                       17-18
    'object "B" {', //                                   19
    '  drag used, used', //                              20
    '  when dropped on Nowhere { used = 1 }', //         21
    '}', //                                              22
    'when loaded {', //                                  23
    '  R.queue = 5', //                                  24
    '}', ''].join('\n')
  const at = (re: RegExp) => checkProgram(src).diagnostics.filter((d) => re.test(d.message)).map((d) => d.line)
  it('a variable, a function, an instance, an assignment, a drop zone', () => {
    expect(at(/"dead" never used/)).toEqual([3])
    expect(at(/fn round is hidden/)).toEqual([4])
    expect(at(/unknown param "queu"/)).toEqual([15])
    expect(at(/"queue" = 5 is outside/)).toEqual([24])
    expect(at(/unknown drop zone "Nowhere"/)).toEqual([21])
  })
})

// Reported by flatink: `each "Eclat" as i { … }` over GROUPS named Eclat0, Eclat1… did nothing, in silence —
// `each` walks the instances of a SYMBOL. The five rings of the demo stayed frozen in a corner.
describe('checkProgram — `each` on a name that is no symbol', () => {
  const groups = 'scene { layer "c" { group "Eclat0" at 50,50 { layer "c" { circle 0 0 10 fill #ee3333 } }  group "Eclat1" at 150,50 { layer "c" { circle 0 0 10 fill #ee3333 } } } }'
  const about = (src: string) => checkProgram(src).diagnostics.filter((d) => /each "/.test(d.message)).map((d) => `${d.severity} ${d.line}: ${d.message}`)
  it('is warned, on its line, naming the groups it probably meant', () => {
    const w = about(['size 300 200', 'var v = [0, 0]', groups, 'each "Eclat" as i { opacity = v[i] }', ''].join('\n'))
    expect(w).toEqual([expect.stringMatching(/^warning 4: each "Eclat".*no symbol.*Eclat0, Eclat1/)])
  })
  it('an `each` over a real symbol, plain or parameterized, says nothing', () => {
    const plain = ['size 300 200', 'var v = [0, 0]', 'symbol "Ring" {', '  layer "l" {', '    circle 0 0 10 fill #ee3333', '  }', '}',
      'scene { layer "c" { instance "Ring" as "A" at 50,50  instance "Ring" as "B" at 150,50 } }', 'each "Ring" as i { opacity = v[i] }', ''].join('\n')
    expect(about(plain)).toEqual([])
    const param = ['size 300 200', 'var v = [0, 0]', 'symbol "Dot"(r) {', '  layer "l" {', '    circle 0 0 $(r) fill #ee3333', '  }', '}',
      'scene { layer "c" { instance "Dot"(5) as "A" at 50,50  instance "Dot"(8) as "B" at 150,50 } }', 'each "Dot" as i { opacity = v[i] }', ''].join('\n')
    expect(about(param)).toEqual([])
  })
})

// Reported by flatink: a stroked line in a group stretched along ONE axis (`scaleY 100`) ran across the whole
// canvas. A stroke scales with its group — its width, and its round caps (2 units of radius became 200 px).
// It renders as documented, so the fix is the author's (`stroke … fixed`): `--check` now points at it.
describe('checkProgram — a stroke inside a group stretched along one axis', () => {
  const prog = (items: string[], behavior = '') => ['size 400 300', 'var fil = 100', 'scene {', '  layer "a" {', ...items.map((i) => `    ${i}`), '  }', '}', behavior, ''].join('\n')
  const about = (src: string) => checkProgram(src).diagnostics.filter((d) => /stretched/.test(d.message)).map((d) => `${d.severity} ${d.line}: ${d.message}`)
  const line = 'layer "c" { path "M0 0 L0 1" nofill stroke #ee3333 4 }'
  it('an `expr` on one axis, a written scale, a binding in an object block', () => {
    expect(about(prog([`group "A" at 100,50 pivot 0,0 expr scaleY "fil" { ${line} }`]))).toEqual([expect.stringMatching(/^warning 5: "A" is stretched along one axis.*fixed/)])
    expect(about(prog([`group "C" at 300,50 pivot 0,0 scaleY 100 { ${line} }`]))).toHaveLength(1)
    expect(about(prog([`group "D" at 300,50 pivot 0,0 { ${line} }`], 'object "D" {\n  scaleX = fil\n}'))).toHaveLength(1)
  })
  it('nothing to say when the stroke is `fixed`, the shape is filled, or the scale is even', () => {
    expect(about(prog(['group "A" at 100,50 pivot 0,0 expr scaleY "fil" { layer "c" { path "M0 0 L0 1" nofill stroke #ee3333 4 fixed } }']))).toEqual([])
    expect(about(prog(['group "B" at 200,50 pivot 0,0 expr scaleY "fil" { layer "c" { rect -2 0 4 1 fill #3333ee } }']))).toEqual([])
    expect(about(prog([`group "E" at 100,50 pivot 0,0 scale 3 { ${line} }`]))).toEqual([])
    expect(about(prog([`group "F" at 100,50 pivot 0,0 { ${line} }`], 'object "F" {\n  feedback lift tilt\n}'))).toEqual([]) // both axes move together
  })
  // Measured on real decks: a reveal wipe (`scaleX` running 0 → 1) fired the first version of this warning on
  // 97 files. The stroke is never ENLARGED there. Only an axis at least twice the other, and at least 2.
  it('a wipe-in that never enlarges, or a scale that cannot be known, is not warned', () => {
    expect(about(prog([`group "W" at 100,50 pivot 0,0 { ${line} }`], 'object "W" {\n  scaleX = clamp(time / 0.25, 0, 1)\n}'))).toEqual([])
    expect(about(prog([`group "H" at 100,50 pivot 0,0 scale 0.2 { ${line} }`], 'object "H" {\n  scaleY = 0.6\n}'))).toEqual([])
    expect(about(prog([`group "M" at 100,50 pivot 0,0 { ${line} }`], 'object "M" {\n  scaleX = mouse.x\n}'))).toEqual([])
  })
})

// Found while measuring the path rule on real libraries: a curve short of a number (`C-5,-59 -5,-54 L…`)
// yields points that are not numbers. It still compiles — it always drew what it could — but it is said.
describe('checkProgram — path data that is only partly readable', () => {
  const prog = (d: string) => `size 300 200\nscene {\n  layer "c" {\n    path "${d}" fill #ee3333\n  }\n}\n`
  const about = (src: string) => checkProgram(src).diagnostics.filter((d) => /path data/.test(d.message)).map((d) => `${d.severity} ${d.line}: ${d.message}`)
  it('is warned, on its line, with the data', () => {
    expect(about(prog('M-5,2 L-4,2 L-4,-52 C-5,-59 -5,-54 L-5,2 Z'))).toEqual([expect.stringMatching(/^warning 4: .*path data.*M-5 2 L-4 2/)])
  })
  it('a well-formed path says nothing', () => {
    expect(about(prog('M0 0 C10 0 10 10 0 10 Z'))).toEqual([])
  })
})

// flatink/flatink#69 — a logo imported from SVG: the stem and the arms of a "k" are two contours of the
// same direction that overlap. SVG fills the overlap (nonzero); FlatKit's even-odd leaves a hole there, and
// nothing said so. A NESTED contour is the documented ring idiom: it stays silent.
describe('checkProgram — contours of the same direction that overlap (even-odd hole)', () => {
  const prog = (shape: string) => `size 300 300\nscene {\n  layer "c" {\n    ${shape}\n  }\n}\n`
  const about = (src: string) => checkProgram(src).diagnostics.filter((d) => /even-odd/.test(d.message)).map((d) => `${d.severity} ${d.line}: ${d.message}`)
  const SAME = 'M40 40 L200 40 L200 200 L40 200 Z M120 120 L280 120 L280 280 L120 280 Z'
  it('is warned, on its line, and names the word that fills it', () => {
    expect(about(prog(`path "${SAME}" fill #461FBF`))).toEqual([expect.stringMatching(/^warning 4: .*M40 40 L200 40.*`nonzero`/)])
  })
  it('says nothing once the shape is `nonzero`, or has no fill', () => {
    expect(about(prog(`path "${SAME}" fill #461FBF nonzero`))).toEqual([])
    expect(about(prog(`path "${SAME}" nofill stroke #461FBF 2`))).toEqual([])
  })
  it('a nested contour (the ring idiom) is not warned, whatever its direction', () => {
    expect(about(prog('path "M-30 -30L30 -30L30 30L-30 30Z M-15 -15L15 -15L15 15L-15 15Z" fill #cc3333'))).toEqual([])
    expect(about(prog('path "M-30 -30L30 -30L30 30L-30 30Z M-15 -15L-15 15L15 15L15 -15Z" fill #cc3333'))).toEqual([])
  })
  it('contours of opposite directions that overlap are a hole in SVG too: not warned', () => {
    expect(about(prog('path "M40 40 L200 40 L200 200 L40 200 Z M120 120 L120 280 L280 280 L280 120 Z" fill #461FBF'))).toEqual([])
  })
  it('contours that only touch, or lie apart, are not warned', () => {
    expect(about(prog('path "M0 0 L100 0 L100 100 L0 100 Z M100 0 L200 0 L200 100 L100 100 Z" fill #461FBF'))).toEqual([])
    expect(about(prog('path "M0 0 L50 0 L50 50 L0 50 Z M100 100 L150 100 L150 150 L100 150 Z" fill #461FBF'))).toEqual([])
  })
  it('curved contours are read as drawn (two discs that overlap)', () => {
    expect(about(prog('path "M50 100 A50 50 0 1 1 150 100 A50 50 0 1 1 50 100 Z M110 100 A50 50 0 1 1 210 100 A50 50 0 1 1 110 100 Z" fill #461FBF'))).toHaveLength(1)
  })
  // `--check` runs on sources nobody vetted (the MCP server): two contours of 20 000 points each would be
  // 400 million edge pairs. Past its budget the path is left unjudged — no warning, and no stall.
  it('a path too dense to compare is left unjudged, quickly', () => {
    const zig = (x0: number, n: number) => { const pts: string[] = []; for (let i = 0; i < n; i++) pts.push(`${x0 + (i % 2) * 300} ${i / 100}`); return `M${pts.join(' L')} L${x0 + 150} 400 Z` }
    const t = performance.now()
    expect(about(prog(`path "${zig(0, 20000)} ${zig(100, 20000)}" fill #461FBF`))).toEqual([])
    expect(performance.now() - t).toBeLessThan(4000)
  })
  it('in a symbol of a library too', () => {
    const lib = `symbol "K" {\n  layer "c" {\n    path "${SAME}" fill #461FBF\n  }\n}\n`
    expect(checkProgram(lib).diagnostics.filter((d) => /even-odd/.test(d.message))).toHaveLength(1)
  })
})
