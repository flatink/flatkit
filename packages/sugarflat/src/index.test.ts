import { describe, it, expect } from 'vitest'
import { checkProgram } from '@flatkit/compiler'
import { desugar, ensureHeader, hasSizeHeader, ident, isIdent, gestures, sugarCard, GESTURES, ROLES, BLANK, GREYBOX, UnknownSugarError, MultipleGesturesError, DEFAULT_DOCUMENT, type Gesture, type Theme } from './index'
import { CONTRACTS } from './contracts/contracts'

/** A gesture that emits state + behavior and NOT ONE coordinate — the shape every real one must take. */
const counter: Gesture = {
  keyword: 'compte',
  summary: 'compte <name> { cible <n> }  -- tap a named item to count up to a target',
  expand: (name, body) => {
    const target = /cible\s+(\d+)/.exec(body)?.[1] ?? '1'
    const flatink = [
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
    return { flatink, meta: { keyword: 'compte', name, prompt: '', items: [], targets: [] } }
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
    const withHeader: Gesture = { ...counter, expand: (name) => ({ flatink: 'size 100 100\ntimeline 24 240\nscene { layer "a" { } }', meta: { keyword: 'compte', name, prompt: '', items: [], targets: [] } }) }
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

  // ⚠️ This test used to check that a gesture whose OWN EXPANSION contained `raw {}` had it unwrapped.
  // It read like coverage of "raw beside a gesture" and proved something else entirely, so the real
  // case — an author writing `raw {}` next to their block — was broken and silent: the expansion
  // compiled, `checkProgram` said ok, and the decor was simply not there.
  it('an author writing raw BESIDE a gesture keeps it, before or after the block', () => {
    const block = 'compte a {\n  cible 2\n}\n'
    const after = desugar(`${block}\nraw {\nobject "Bouton" { opacity = 0.5 }\n}\n`, { gestures: [counter] })
    expect(after.flatink).toContain('object "Bouton" { opacity = 0.5 }')
    const before = desugar(`raw {\nvar extra = 1\n}\n\n${block}`, { gestures: [counter] })
    expect(before.flatink).toContain('var extra = 1')
    // …and the expansion is still there beside it, in the author's order.
    expect(before.flatink.indexOf('var extra')).toBeLessThan(before.flatink.indexOf('object "Bouton"'))
  })

  it('plain FlatInk written beside a block travels too, not just `raw`', () => {
    const r = desugar('compte a {\n  cible 2\n}\n\nvar host = 7\n', { gestures: [counter] })
    expect(r.flatink).toContain('var host = 7')
  })

  // A gesture emits no appearance by design, so decor has exactly one place to go — inside the scene.
  // A second top-level `scene` block is a compile error, which left the escape hatch unable to reach it.
  it('`raw scene { … }` lands INSIDE the generated scene, which is where decor has to be', () => {
    const r = desugar('compte a {\n  cible 2\n}\n\nraw scene {\n  layer "bg" { rect 0 0 40 40 fill #123456 }\n}\n', { gestures: [counter] })
    const scene = r.flatink.slice(r.flatink.indexOf('scene {'), r.flatink.indexOf('object "Bouton"'))
    expect(scene).toContain('layer "bg"')
    expect(checkProgram(r.flatink).errors).toBe(0)
  })

  it('and a second gesture block is refused loudly rather than dropped', () => {
    const two = 'compte a {\n  cible 1\n}\n\ncompte b {\n  cible 2\n}\n'
    expect(() => desugar(two, { gestures: [counter] })).toThrow(MultipleGesturesError)
    expect(() => desugar(two, { gestures: [counter] })).toThrow(/only have one/)
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

// Reported after ten model-written activities went through the package: `place` parsed `prompt` and
// then dropped it on the floor, so the one piece of text a host must display was recoverable only by
// re-parsing the block by hand — a second parser waiting to drift from this one.
describe('desugar — the host gets what the gesture understood', () => {
  it.each(CONTRACTS.map((c) => [c.keyword, c.source] as const))('%s returns the prompt it parsed', (keyword, source) => {
    const { meta } = desugar(source)
    expect(meta, 'no meta at all').not.toBeNull()
    expect(meta!.keyword).toBe(keyword)
    expect(meta!.prompt.length, `${keyword} parsed a prompt and did not return it`).toBeGreaterThan(0)
  })

  it('the labels line up with the payload indices, so `{ item = 2 }` can be read back', () => {
    // The payloads are indices on purpose — they must not depend on what a theme drew. That only works
    // if the labels come back beside them.
    const { meta } = desugar(CONTRACTS[0].source)
    expect(meta!.items).toEqual(['cat', 'run', 'house', 'jump'])
    expect(meta!.targets).toEqual(['Nouns', 'Verbs'])
  })

  it('all three gestures write the prompt into the expansion too, no longer one of them silently', () => {
    for (const c of CONTRACTS) expect(desugar(c.source).flatink, c.keyword).toContain('// prompt:')
  })

  it('plain FlatInk has no block to have understood anything from', () => {
    expect(desugar('size 10 10\nscene { layer "a" { } }\n').meta).toBeNull()
  })
})

// Also reported, and measured: a prompt that gave only "space them out" produced overlapping hitboxes
// in 4 of 10 activities; the same prompt carrying the numbers, 0 of 10. The sizes were public the whole
// time — nothing told a prompt-writer to go and read them.
describe('the reference a model is prompted with carries the footprints', () => {
  it('every gesture summary states the size of what it places', () => {
    for (const g of GESTURES) {
      expect(g.summary, `${g.keyword} says nothing about footprints`).toMatch(/\d+x\d+/)
    }
  })

  it('sugarCard assembles grammar, footprints and the canvas in one pasteable block', () => {
    const card = sugarCard()
    for (const g of GESTURES) expect(card).toContain(g.keyword)
    for (const role of ROLES) expect(card, `no footprint for ${role}`).toMatch(new RegExp(`${role}: \\d+x\\d+`))
    expect(card).toMatch(/760x620/) // the canvas it is laying out on
    expect(card).toMatch(/raw \{/) // and the way out
  })

  it('it follows the theme, so a different look does not hand out stale numbers', () => {
    const wide: Theme = { ...GREYBOX, name: 'wide', size: () => ({ w: 300, h: 200 }) }
    expect(sugarCard({ theme: wide })).toMatch(/target: 300x200/)
    expect(sugarCard()).toMatch(/target: 208x118/)
  })
})

// Reported against 0.2.0. All three are defects in the fix that shipped an hour earlier, and each one
// was contradicted by this package's own documentation — the worst kind, because a reader trusts it.
describe('the escape hatch, as the README and sugarCard actually write it', () => {
  const block = 'compte a {\n  cible 2\n}\n'
  const run = (src: string) => desugar(src, { gestures: [counter] })

  it('`raw { … }` on ONE line is expanded — both docs write it that way', () => {
    // The old pattern demanded a newline after `{` and a closing brace in column 0, so the one-line
    // form travelled on to the compiler, which said `unexpected statement "raw"` — a sugar defect
    // described in FlatInk's vocabulary, exactly what UnknownSugarError was introduced to stop.
    const r = run(`${block}\nraw { var extra = 1 }\n`)
    expect(r.flatink).toContain('var extra = 1')
    expect(r.flatink).not.toMatch(/^raw\b/m)
  })

  it('the multi-line form still works, and both forms may sit side by side', () => {
    const r = run(`${block}\nraw { var one = 1 }\n\nraw {\n  var two = 2\n}\n`)
    expect(r.flatink).toContain('var one = 1')
    expect(r.flatink).toContain('var two = 2')
  })

  // A gesture emits no appearance, so a background is the FIRST thing any skin needs. Spliced on top,
  // an opaque full-canvas rect hides the whole activity while `checkProgram` reports it clean — ten
  // activities shipped that way and were read as a broken asset pipeline.
  it('`raw scene under { … }` is drawn BEHIND the gesture, `raw scene { … }` on top', () => {
    const r = run(`${block}\nraw scene under { layer "BG" { rect 0 0 40 40 fill #112233 } }\nraw scene { layer "BANNER" { rect 0 0 10 5 fill #ffffff } }\n`)
    const bg = r.flatink.indexOf('layer "BG"')
    const own = r.flatink.indexOf('group "Bouton"')
    const banner = r.flatink.indexOf('layer "BANNER"')
    expect(bg).toBeGreaterThan(-1)
    expect(bg).toBeLessThan(own) // behind
    expect(banner).toBeGreaterThan(own) // in front
    expect(checkProgram(r.flatink).errors).toBe(0)
  })

  it('`raw scene` with no gesture to splice into raises instead of vanishing', () => {
    expect(() => run('raw scene { layer "BG" { } }\n')).toThrow(/needs a gesture block/)
  })
})

describe('sugarCard teaches the hatch that can actually carry decor', () => {
  it('names all three forms, and says which one takes a background', () => {
    const card = sugarCard()
    expect(card).toMatch(/raw \{/)
    expect(card).toMatch(/raw scene \{/)
    expect(card).toMatch(/raw scene under \{/)
    expect(card).toMatch(/background/i)
  })

  it('the forms it prints are the forms that work', () => {
    // The card told a model to put decor in `raw { … }`, where a `layer` lands outside the scene and
    // errors. Whatever the card shows must survive a round trip.
    const src = `place p {\n  prompt "x"\n  target T at 200,400\n  item a -> T at 100,100\n}\n\nraw scene under { layer "BG" { rect 0 0 760 620 fill #112233 } }\n`
    expect(checkProgram(desugar(src).flatink).errors).toBe(0)
  })
})
