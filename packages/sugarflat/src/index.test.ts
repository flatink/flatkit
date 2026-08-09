import { describe, it, expect } from 'vitest'
import { checkProgram } from '@flatkit/compiler'
import { desugar, ensureHeader, hasSizeHeader, ident, isIdent, gestures, GESTURES, BLANK, GREYBOX, UnknownSugarError, DEFAULT_DOCUMENT, type Gesture } from './index'
import { CONTRACTS } from './contracts/contracts'

/** A gesture that emits state + behavior and NOT ONE coordinate — the shape every real one must take. */
const counter: Gesture = {
  keyword: 'compte',
  summary: 'compte <name> { cible <n> }  -- tap a named item to count up to a target',
  expand: (_name, body) => {
    const target = /cible\s+(\d+)/.exec(body)?.[1] ?? '1'
    return [
      'var total = 0',
      'var done = 0',
      'scene { layer "a" { group "Bouton" { layer "c" { rect 0 0 10 10 fill #ffffff } } } }',
      'object "Bouton" {',
      '  when clicked {',
      `    if done < 0.5 {`,
      '      total = total + 1',
      `      if total == ${target} {`,
      '        done = 1',
      '        send "completed"',
      '      }',
      '    }',
      '  }',
      '}',
    ].join('\n')
  },
}

describe('desugar — plain FlatInk passes through', () => {
  it('a program with no sugar block is returned untouched', () => {
    const src = 'size 200 200\nscene { layer "a" { rect 0 0 10 10 fill #ff0000 } }\n'
    const r = desugar(src, { gestures: [counter] })
    expect(r.flatink).toBe(src)
    expect(r.expanded).toBe(false)
    expect(r.kind).toBeNull()
  })

  it('a program opening on a FlatInk block is never mistaken for sugar', () => {
    const src = 'scene { layer "a" { rect 0 0 10 10 fill #ff0000 } }\n'
    expect(() => desugar(src, { gestures: [counter] })).not.toThrow()
  })
})

// Friction 5: an unrecognised block returned `{ expanded: false, error: null }` and the author's text
// travelled on as if it were FlatInk, to fail a hundred lines downstream on messages that only speak
// FlatInk. A block nobody claims is a hard stop, and the message lists what IS claimed.
describe('desugar — an unknown block is a hard error, never a silent pass-through', () => {
  it('raises, names the keyword, and lists the known gestures', () => {
    const src = 'trier mon_activite {\n  item a\n}\n'
    expect(() => desugar(src, { gestures: [counter] })).toThrow(UnknownSugarError)
    expect(() => desugar(src, { gestures: [counter] })).toThrow(/unknown sugar block "trier"/)
    expect(() => desugar(src, { gestures: [counter] })).toThrow(/compte/) // what IS available
  })

  it('and says so even when no gesture is registered at all', () => {
    expect(() => desugar('tri x {\n}\n', { gestures: [] })).toThrow(/\(none registered\)/)
  })
})

// Friction 1, the costliest: `size` is the format's REQUIRED first line, the compiler silently defaults
// it when absent, and the previous sugar never emitted it — on its whole corpus, for months. Everything
// past the real board width was clipped with nothing to say so.
describe('desugar — the required header is always emitted', () => {
  it('an expansion with no header gets `size` and `timeline`', () => {
    const { flatink } = desugar('compte a {\n  cible 3\n}\n', { gestures: [counter] })
    expect(flatink.startsWith(`size ${DEFAULT_DOCUMENT.width} ${DEFAULT_DOCUMENT.height}`)).toBe(true)
    expect(flatink).toMatch(/^timeline 24 120$/m)
  })

  it('the document is overridable, and its dimensions are readable rather than buried', () => {
    const { flatink } = desugar('compte a {\n  cible 3\n}\n', { gestures: [counter], document: { width: 480, height: 320, fps: 30, durationFrames: 300 } })
    expect(flatink.startsWith('size 480 320')).toBe(true)
    expect(flatink).toMatch(/^timeline 30 300$/m)
  })

  it('a header the gesture already wrote is not duplicated', () => {
    const withHeader: Gesture = { ...counter, expand: () => 'size 100 100\ntimeline 24 240\nscene { layer "a" { } }' }
    const { flatink } = desugar('compte a {\n}\n', { gestures: [withHeader] })
    expect(flatink.match(/^size /gm)).toHaveLength(1)
    expect(flatink.match(/^timeline /gm)).toHaveLength(1)
  })

  it('ensureHeader is idempotent', () => {
    const once = ensureHeader('scene { }')
    expect(ensureHeader(once)).toBe(once)
    expect(hasSizeHeader(once)).toBe(true)
  })
})

// The escape hatch, kept deliberately: a sugar that cannot be opted out of stops being scaffolding and
// becomes a template — which is how a previous generation of this idea made every activity look alike.
describe('desugar — the `raw { … }` escape hatch', () => {
  it('passes its body through verbatim, and works with no gesture at all', () => {
    const src = 'raw {\nobject "Custom" { opacity = 1 }\n}\n'
    const r = desugar(src, { gestures: [counter] })
    expect(r.flatink).toContain('object "Custom" { opacity = 1 }')
    expect(r.flatink).not.toContain('raw {')
    expect(r.kind).toBe('raw')
  })

  it('works BESIDE a gesture, so an author can add to what the sugar wrote', () => {
    const g: Gesture = { ...counter, expand: (_n, body) => `${counter.expand('x', body, DEFAULT_DOCUMENT)}\nraw {\nobject "Bouton" { opacity = 0.5 }\n}` }
    const { flatink } = desugar('compte a {\n  cible 2\n}\n', { gestures: [g] })
    expect(flatink).toContain('object "Bouton" { opacity = 0.5 }')
    expect(flatink).not.toContain('raw {')
  })
})

// THE guarantee of this package. An expansion that merely "compiles" is not enough: a warning is the
// language telling us the output is wrong in a way that still runs, and generated DSL is exactly where
// nobody is watching. Zero warnings, or it is a bug in the gesture.
describe('desugar — every expansion passes checkProgram with ZERO warnings', () => {
  it('the reference gesture expands to a clean program', () => {
    const { flatink } = desugar('compte a {\n  cible 3\n}\n', { gestures: [counter] })
    const r = checkProgram(flatink)
    expect(r.report).toBe('')
    expect(r.errors).toBe(0)
    expect(r.warnings).toBe(0)
  })

  // Guard for the port to come: every SHIPPED gesture must state what it is and expand to something the
  // compiler has nothing to say about. The loop is empty until the gestures land, and arms itself the
  // moment one is registered — a gesture added without a fixture here fails on the first line.
  it.each(GESTURES.map((g) => [g.keyword, g] as const))('the shipped gesture %s is documented and expands clean', (_kw, gesture) => {
    expect(gesture.summary.length).toBeGreaterThan(20)
    expect(gesture.summary).toContain(gesture.keyword)
    const fixture = CONTRACTS.find((c) => c.keyword === gesture.keyword)
    expect(fixture, `no contract for the "${gesture.keyword}" gesture — add one beside it`).toBeDefined()
    const r = checkProgram(desugar(fixture!.source).flatink)
    expect(r.report).toBe('')
    expect(r.warnings).toBe(0)
  })
})

// The claim that makes "no visual opinion" checkable rather than promised: expand every gesture with a
// theme that draws NOTHING, and the output must not carry one colour, one font or one stroke. If a
// gesture ever hard-codes a look, this goes red on the line that did it.
describe('gestures carry no appearance of their own', () => {
  const APPEARANCE = /#[0-9a-fA-F]{3,8}\b|\bfill\b|\bstroke\b|\bfont\b|\bcolor\b|\bopacity\s+[\d.]/

  it.each(CONTRACTS.map((c) => [c.keyword, c.source] as const))('%s emits none under the BLANK theme', (_kw, source) => {
    const { flatink } = desugar(source, { gestures: gestures({ theme: BLANK }) })
    const offending = flatink.split('\n').filter((l) => APPEARANCE.test(l))
    expect(offending, `these lines decide what things look like:\n${offending.join('\n')}`).toEqual([])
  })

  it('and the greybox theme is what puts it back', () => {
    const { flatink } = desugar(CONTRACTS[0].source, { gestures: gestures({ theme: GREYBOX }) })
    expect(APPEARANCE.test(flatink)).toBe(true)
  })
})

describe('ident — a human label becomes a usable FlatInk identifier', () => {
  it('folds accents instead of letting the lexer stop at them', () => {
    // Accented literals are written as \u escapes so the repo's English-only guard can still scan this
    // file. Written with its accent, `chene` became `var chene-with-circumflex X`, which the lexer reads
    // as `neX`: two variables where the author declared one, and not a word of diagnostic.
    expect(ident('ch\u00eane')).toBe('chene')  // 'chene' with a circumflex
    expect(ident('V\u00e9g\u00e9taux')).toBe('Vegetaux')
  })

  it('replaces everything else, and never starts with a digit', () => {
    expect(ident('21 janvier 1793')).toBe('n21_janvier_1793')
    expect(ident('Bastille-juillet')).toBe('Bastille_juillet')
  })

  it('is stable and idempotent — the sugar and the author must agree on the name', () => {
    expect(ident(ident('ch\u00eane'))).toBe(ident('ch\u00eane'))
    expect(isIdent('chene')).toBe(true)
    expect(isIdent('ch\u00eane')).toBe(false)
  })

  it('an identifier it produces is accepted by the compiler', () => {
    const name = ident('21 janvier 1793')
    const r = checkProgram(`size 100 100\nvar ${name} = 0\nscene { layer "a" { group "G" { layer "c" { rect 0 0 5 5 fill #fff } } } }\nobject "G" { opacity = ${name} }\n`)
    expect(r.errors).toBe(0)
  })
})
