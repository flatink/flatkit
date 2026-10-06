import { describe, it, expect } from 'vitest'
import { checkProgram } from '@flatkit/compiler'
import { desugar, ensureHeader, hasSizeHeader, ident, isIdent, gestures, sugarCard, GESTURES, ROLES, BLANK, GREYBOX, UnknownSugarError, DuplicateBlockError, DEFAULT_DOCUMENT, type Gesture, type Theme } from './index'
import { CONTRACTS } from './contracts/contracts'

/** A gesture that emits state + behavior and NOT ONE coordinate — the shape every real one must take. */
const counter: Gesture = {
  keyword: 'compte',
  summary: 'compte <name> { cible <n> }  -- tap a named item to count up to a target',
  expand: (name, body, _doc, ctx) => {
    const target = /cible\s+(\d+)/.exec(body)?.[1] ?? '1'
    const p = ctx.prefix
    return {
      vars: [`var ${p}total = 0`, `var ${ctx.doneVar} = 0`],
      layers: [`  layer "${p}l" { group "${p}Bouton" { layer "c" { rect 0 0 10 10 fill #ffffff } } }`],
      behavior: [
        `object "${p}Bouton" {`,
        '  when clicked {',
        `    if ${ctx.doneVar} < 0.5 {`,
        `      ${p}total = ${p}total + 1`,
        `      if ${p}total == ${target} {`,
        `        ${ctx.doneVar} = 1`,
        `        send "part", { block = ${ctx.index} }`,
        '      }',
        '    }',
        '  }',
        '}',
      ],
      meta: { keyword: 'compte', name, prompt: '', items: [], targets: [], objects: [`${p}Bouton`], doneVar: ctx.doneVar },
    }
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

  it('the header appears exactly once, however many blocks there are', () => {
    // Gestures return PARTS now, not whole programs — which is precisely what stops two blocks from
    // contributing two headers, two scenes, or two of anything else the format allows only once.
    const { flatink } = desugar('compte a {\n  cible 1\n}\n\ncompte b {\n  cible 2\n}\n', { gestures: [counter] })
    expect(flatink.match(/^size /gm)).toHaveLength(1)
    expect(flatink.match(/^timeline /gm)).toHaveLength(1)
    expect(flatink.match(/^scene \{/gm)).toHaveLength(1)
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
    const after = desugar(`${block}\nraw {\nobject "a_Bouton" { opacity = 0.5 }\n}\n`, { gestures: [counter] })
    expect(after.flatink).toContain('object "a_Bouton" { opacity = 0.5 }')
    const before = desugar(`raw {\nvar extra = 1\n}\n\n${block}`, { gestures: [counter] })
    expect(before.flatink).toContain('var extra = 1')
    // …and the expansion is still there beside it, in the author's order.
    expect(before.flatink.indexOf('var extra')).toBeLessThan(before.flatink.indexOf('object "a_Bouton"'))
  })

  it('plain FlatInk written beside a block travels too, not just `raw`', () => {
    const r = desugar('compte a {\n  cible 2\n}\n\nvar host = 7\n', { gestures: [counter] })
    expect(r.flatink).toContain('var host = 7')
  })

  // A gesture emits no appearance by design, so decor has exactly one place to go — inside the scene.
  // A second top-level `scene` block is a compile error, which left the escape hatch unable to reach it.
  it('`raw scene { … }` lands INSIDE the generated scene, which is where decor has to be', () => {
    const r = desugar('compte a {\n  cible 2\n}\n\nraw scene {\n  layer "bg" { rect 0 0 40 40 fill #123456 }\n}\n', { gestures: [counter] })
    const scene = r.flatink.slice(r.flatink.indexOf('scene {'), r.flatink.indexOf('object "a_Bouton"'))
    expect(scene).toContain('layer "bg"')
    expect(checkProgram(r.flatink).errors).toBe(0)
  })

  it('two blocks share one document, one scene, one header', () => {
    const two = 'compte a {\n  cible 1\n}\n\ncompte b {\n  cible 2\n}\n'
    const r = desugar(two, { gestures: [counter] })
    expect(r.meta.map((m) => m.name)).toEqual(['a', 'b'])
    expect(r.kind).toBe('compte+compte')
    expect(checkProgram(r.flatink).errors).toBe(0)
  })

  it('two blocks with the SAME name are refused — every name they emit would collide', () => {
    const clash = 'compte a {\n  cible 1\n}\n\ncompte a {\n  cible 2\n}\n'
    expect(() => desugar(clash, { gestures: [counter] })).toThrow(DuplicateBlockError)
    expect(() => desugar(clash, { gestures: [counter] })).toThrow(/own name/)
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
// flatink/flatink#57 — accessibility: GREYBOX wrote its labels at 14-16 px; the stories' rule is 20 px at
// least. The footprints stay (a drop box is layout: bigger ones would overlap existing activities).
describe('GREYBOX — every label is at least 20 px, within the same footprints', () => {
  it('for every role', () => {
    for (const role of ROLES) {
      const sizes = GREYBOX.draw(role, 'Label').flatMap((l) => [...l.matchAll(/\bsize (\d+)/g)].map((m) => Number(m[1])))
      expect(sizes.length, role).toBeGreaterThan(0)
      expect(Math.min(...sizes), role).toBeGreaterThanOrEqual(20)
    }
    expect(GREYBOX.size('item')).toEqual({ w: 92, h: 92 })
    expect(GREYBOX.size('target')).toEqual({ w: 208, h: 118 })
  })
})

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
    expect(meta, 'no meta at all').toHaveLength(1)
    expect(meta[0].keyword).toBe(keyword)
    expect(meta[0].prompt.length, `${keyword} parsed a prompt and did not return it`).toBeGreaterThan(0)
  })

  it('the labels line up with the payload indices, so `{ item = 2 }` can be read back', () => {
    // The payloads are indices on purpose — they must not depend on what a theme drew. That only works
    // if the labels come back beside them.
    const { meta } = desugar(CONTRACTS[0].source)
    expect(meta[0].items).toEqual(['cat', 'run', 'house', 'jump'])
    expect(meta[0].targets).toEqual(['Nouns', 'Verbs'])
  })

  it('all three gestures write the prompt into the expansion too, no longer one of them silently', () => {
    for (const c of CONTRACTS) expect(desugar(c.source).flatink, c.keyword).toContain('// prompt:')
  })

  it('plain FlatInk has no block to have understood anything from', () => {
    expect(desugar('size 10 10\nscene { layer "a" { } }\n').meta).toEqual([])
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
    const own = r.flatink.indexOf('group "a_Bouton"')
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

// Found by the smoke test that installs the PUBLISHED package and runs the documented example — the one
// place a defect in the docs and a defect in the code meet.
describe('top-level raw lands where its statements are legal', () => {
  const block = 'compte a {\n  cible 2\n}\n'
  const run = (src: string) => desugar(src, { gestures: [counter] })

  it('`var` written after the block still compiles — it is a HEADER declaration', () => {
    // `var` after `scene` is a parse error, and the escape hatch put it exactly there. `object` and `fn`
    // are legal on either side, so the header position is the only one where all of it works.
    const r = run(`${block}\nraw { var extra = 1 }\n`)
    expect(r.flatink.indexOf('var extra = 1')).toBeLessThan(r.flatink.indexOf('scene {'))
    expect(checkProgram(r.flatink).errors).toBe(0)
  })

  it('an `object` in raw is accepted too, moved or not — behavior binds by name', () => {
    const r = run(`${block}\nraw { object "a_Bouton" { opacity = 0.5 } }\n`)
    expect(checkProgram(r.flatink).errors).toBe(0)
    expect(r.flatink).toContain('opacity = 0.5')
  })

  it('the one-line body is not indented by the braces that hugged it', () => {
    const r = run(`${block}\nraw { var extra = 1 }\n`)
    expect(r.flatink).toMatch(/^var extra = 1$/m) // not " var extra = 1"
  })
})

// flatink/flatink#54 — `ident` keeps letters and digits, so labels that differ only by a sign share an
// identifier: `-1` and `+1` both became `p_I_1`, and `< 1`, `= 1`, `> 1` all became `p_T__1`. Variables
// and groups were declared twice and the activity broke, with nothing pointing at the labels.
describe('place — labels that fold to the same identifier', () => {
  const objects = (src: string) => desugar(src).meta[0].objects
  it('items: each gets its own object, the first keeping the plain name', () => {
    const src = 'place p {\n  prompt "x"\n  target A at 200,470\n  item "−1" -> A at 150,150\n  item "+1" -> A at 300,150\n}\n'
    expect(objects(src)).toEqual(['p_TA', 'p_I_1', 'p_I_1_2'])
    expect(checkProgram(ensureHeader(desugar(src).flatink)).errors).toBe(0)
  })
  it('targets: each gets its own object, and an item still reaches the one it names', () => {
    const src = 'place p {\n  prompt "x"\n  target "< 1" at 100,470\n  target "= 1" at 300,470\n  target "> 1" at 500,470\n  item a -> "= 1" at 150,150\n  item b -> "> 1" at 300,150\n}\n'
    const r = desugar(src)
    expect(r.meta[0].objects).toEqual(['p_T__1', 'p_T__1_2', 'p_T__1_3', 'p_Ia', 'p_Ib'])
    // The handler that PLACES an item (the one guarded by `Placed`) is the one for the target it names.
    expect(r.flatink).toMatch(/when dropped on p_T__1_2 at pointer \{\n {4}if p_IaPlaced/)
    expect(r.flatink).toMatch(/when dropped on p_T__1_3 at pointer \{\n {4}if p_IbPlaced/)
    expect(checkProgram(ensureHeader(r.flatink)).errors).toBe(0)
  })
  it('an item may still name its target by a spelling that folds to the same identifier, when only one target does', () => {
    const src = 'place p {\n  target "V\u00e9g\u00e9taux" at 200,400\n  item a -> Vegetaux at 100,100\n}\n'
    expect(desugar(src).flatink).toContain('when dropped on p_TVegetaux at pointer')
  })
  it('the SAME target label twice is an error: an item naming it could mean either', () => {
    expect(() => desugar('place p {\n  target A at 100,470\n  target A at 300,470\n  item a -> A at 150,150\n}\n')).toThrow(/two targets.*"A"/)
  })
  it('labels that do not collide keep the names they always had', () => {
    expect(objects('place p {\n  target T at 200,400\n  item a -> T at 100,100\n  item b -> T at 200,100\n}\n')).toEqual(['p_TT', 'p_Ia', 'p_Ib'])
  })
})

// Two findings of a review of the keyboard way into `place` (0.36) and of the Tab order across blocks.
describe('place / steps / compose — picking and the Tab order', async () => {
  const { playHeadless } = await import('@flatkit/player/debug')
  const play = (src: string, g: unknown[]) => {
    const c = checkProgram(ensureHeader(desugar(src).flatink))
    expect(c.errors).toBe(0)
    return playHeadless(c.doc!, g as never)
  }
  it('an item picked, then DRAGGED onto its target, stays there when another target is tapped', () => {
    const place = 'place p {\n  target A at 150,470\n  target B at 450,470\n  item a -> A at 100,150\n  item b -> B at 300,150\n}\n'
    const r = play(place, [{ type: 'tap', target: 'p_Ia' }, { type: 'drag', source: 'p_Ia', target: 'p_TA' }, { type: 'tap', target: 'p_TB' }, { type: 'wait', frames: 2 }])
    expect(r.sends.map((s) => s.name)).toEqual(['correct'])
    expect(r.vars.p_IaPlaced).toBe(1)
    expect(r.vars.p_sel).toBe(0)
  })
  it('Tab goes through the blocks in their order, whatever their kind', () => {
    const src = 'compose c {\n  total 30\n  chip 10 at 100,100\n  chip 20 at 300,100\n}\n'
      + 'steps s {\n  step "one" at 100,300\n  step "two" at 300,300\n  step "three" at 500,300\n  step "four" at 700,300\n}\n'
      + 'place p {\n  target A at 150,470\n  item a -> A at 100,550\n}\n'
    const doc = checkProgram(ensureHeader(desugar(src).flatink)).doc!
    const order = (name: string): number => {
      const find = (items: unknown[]): number | undefined => { for (const it of items as Array<Record<string, unknown>>) { if (it.name === name) return (it.focusable as { order?: number } | undefined)?.order; if (Array.isArray(it.layers)) for (const l of it.layers as Array<{ items: unknown[] }>) { const o = find(l.items); if (o !== undefined) return o } } return undefined }
      for (const l of doc.layers) { const o = find(l.items); if (o !== undefined) return o }
      return Number.NaN
    }
    const seq = ['c_C0', 'c_C1', 's_S0', 's_S3', 'p_Ia', 'p_TA'].map(order)
    expect(seq.every(Number.isFinite)).toBe(true)
    expect(seq).toEqual([...seq].sort((a, b) => a - b))
    expect(order('s_S0')).toBeLessThan(order('s_S1')) // a sequence keeps its cards in order
  })
})

describe('the gestures, played — flatink/flatink #55 #56 #58', async () => {
  const { playHeadless } = await import('@flatkit/player/debug')
  const run = (src: string, g: unknown[]) => {
    const c = checkProgram(ensureHeader(desugar(src).flatink))
    expect(c.errors).toBe(0)
    return playHeadless(c.doc!, g as never)
  }
  const steps = 'steps s {\n  step "one" at 100,300\n  step "two" at 300,300\n  step "three" at 500,300\n}\n'
  // #56 — the targets of `place` had one fixed size (208x118 under GREYBOX): five of them could not stand in a
  // row on a 760 px scene (a number line). A size per target, or one for the whole block.
  it('place: a target takes its own size, or the block\'s — drop box and drawing alike', () => {
    const src = 'place p {\n  targets size 120,80\n  target A at 100,300\n  target B at 260,300 size 60,60\n  item a -> A at 100,100\n  item b -> B at 300,100\n}\n'
    const c = checkProgram(ensureHeader(desugar(src).flatink))
    expect(c.errors).toBe(0)
    const box = (name: string) => (c.doc!.layers.flatMap((l) => l.items) as Array<{ name: string; hitbox?: { w: number; h: number } }>).find((it) => it.name === name)?.hitbox
    expect([box('p_TA'), box('p_TB')]).toEqual([{ w: 120, h: 80 }, { w: 60, h: 60 }])
    expect(desugar(src).flatink).toMatch(/rect -56 -36 112 72/) // GREYBOX draws within the size it was given
    const r = run(src, [{ type: 'drag', source: 'p_Ib', target: 'p_TB' }, { type: 'drag', source: 'p_Ia', target: 'p_TA' }])
    expect(r.sends.map((s) => s.name)).toEqual(['correct', 'correct', 'part', 'completed'])
  })
  it('place: a malformed size is refused, with the rule', () => {
    expect(() => desugar('place p {\n  target A at 100,300 size big\n  item a -> A at 100,100\n}\n')).toThrow(/size/)
  })

  // #55 — `compose`: decimals were refused ("unrecognised line: total 3.7"), a chip could only show its raw
  // value, and nothing told the learner where they stood.
  it('compose: decimal values add up exactly, float noise included', () => {
    const src = 'compose c {\n  total 0.3\n  chip 0.1 at 100,100\n  chip 0.2 at 300,100\n}\n'
    const r = run(src, [{ type: 'tap', target: 'c_C0' }, { type: 'tap', target: 'c_C1' }])
    expect(r.sends.map((s) => s.name)).toEqual(['correct', 'correct', 'part', 'completed']) // 0.1 + 0.2 is not 0.3 in floats
    const over = run(src, [{ type: 'tap', target: 'c_C1' }, { type: 'tap', target: 'c_C1' }])
    expect(over.sends.map((s) => s.name)).toEqual(['correct', 'incorrect'])
  })
  it('compose: a chip shows its label, or its value with the block\'s unit', () => {
    const out = desugar('compose c {\n  unit "c"\n  total 250\n  chip 200 "2 €" at 100,100\n  chip 50 at 300,100\n}\n').flatink
    expect(out).toMatch(/text "2 €"/)
    expect(out).toMatch(/text "50 c"/)
  })
  it('compose: `counter at x,y` shows the running total, which the theme draws (and BLANK does not)', () => {
    const src = 'compose c {\n  total 2.5\n  chip 0.5 at 100,100\n  chip 2 at 300,100\n  counter at 400,300\n}\n'
    const out = desugar(src).flatink
    expect(out).toMatch(/group "c_Total" at 400,300/)
    expect(out).toMatch(/text "\{\} \/ 2.5"[^\n]*bind "c_total" decimals 1/)
    expect(checkProgram(ensureHeader(out)).errors).toBe(0)
    const blank = desugar(src, { gestures: gestures({ theme: BLANK }) }).flatink
    expect(blank).toMatch(/group "c_Total"/)
    expect(blank).not.toMatch(/text |#[0-9a-f]{3}/)
  })

  // #58 — a step tapped out of order did nothing and sent nothing: an activity could not count mistakes.
  it('steps: a step AHEAD of the current one sends `incorrect`; a step already done stays silent', () => {
    const r = run(steps, [{ type: 'tap', target: 's_S2' }, { type: 'tap', target: 's_S0' }, { type: 'tap', target: 's_S0' }, { type: 'tap', target: 's_S1' }, { type: 'tap', target: 's_S2' }, { type: 'tap', target: 's_S1' }])
    expect(r.sends.map((s) => `${s.name}${s.fields?.item !== undefined ? ':' + s.fields.item : ''}`)).toEqual(['incorrect:2', 'step:0', 'step:1', 'step:2', 'part', 'completed'])
  })
})

// flatink/flatink#39 — the inputs every activity rewrote by hand (the kit's "briques"): − / + buttons that
// repeat while held, a slider. They are CONTROLS: they write a value, they have no "done", and they do not
// hold back the document's `completed`.
describe('controls — stepper', async () => {
  const { playHeadless } = await import('@flatkit/player/debug')
  const run = (src: string, g: unknown[]) => {
    const c = checkProgram(ensureHeader(desugar(src).flatink))
    expect(c.errors, c.report).toBe(0)
    return playHeadless(c.doc!, g as never)
  }
  const st = 'stepper etoiles {\n  min 0\n  max 5\n  start 2\n  minus at 100,200\n  plus at 300,200\n  counter at 200,200\n}\n'
  const tap = (t: string) => ({ type: 'tap', target: t })

  it('one tap, one step — and the value stays within its bounds', () => {
    expect(run(st, [tap('etoiles_Plus')]).vars.etoiles_value).toBe(3)
    expect(run(st, [tap('etoiles_Minus'), tap('etoiles_Minus'), tap('etoiles_Minus')]).vars.etoiles_value).toBe(0)
    const r = run(st, [tap('etoiles_Plus'), tap('etoiles_Plus'), tap('etoiles_Plus'), tap('etoiles_Plus')])
    expect(r.vars.etoiles_value).toBe(5)
    expect(r.sends.map((s) => `${s.name}:${s.fields?.value}`)).toEqual(['change:3', 'change:4', 'change:5']) // nothing sent once at the bound
  })
  it('held, it steps at once, then repeats after 0.4 s every 0.12 s', () => {
    const hold = (frames: number) => run('stepper n {\n  min 0\n  max 100\n  minus at 100,200\n  plus at 300,200\n}\n',
      [{ type: 'down', x: 300, y: 200 }, { type: 'wait', frames }, { type: 'up', x: 300, y: 200 }, { type: 'wait', frames: 30 }]).vars.n_value
    expect(hold(12)).toBe(1) // 0.2 s: the first step only
    expect(hold(60)).toBeGreaterThanOrEqual(5) // 1 s: 1 + about five repeats (0.4, 0.52, 0.64, 0.76, 0.88, 1.0)
    expect(hold(60)).toBeLessThanOrEqual(7)
  })
  it('a decimal step adds up exactly', () => {
    const src = 'stepper v {\n  min 0\n  max 1\n  step 0.1\n  minus at 100,200\n  plus at 300,200\n}\n'
    expect(run(src, [tap('v_Plus'), tap('v_Plus'), tap('v_Plus')]).vars.v_value).toBe(0.3)
  })
  it('is a control: it has no end, and does not hold back `completed`', () => {
    const { meta } = desugar(st)
    expect(meta[0]).toMatchObject({ keyword: 'stepper', control: true })
    const both = st + 'compose c {\n  total 10\n  chip 10 at 100,400\n}\n'
    expect(run(both, [tap('c_C0')]).sends.map((s) => s.name)).toEqual(['correct', 'part', 'completed'])
    expect(run(st, [tap('etoiles_Plus')]).sends.map((s) => s.name)).toEqual(['change']) // alone: never `completed`
  })
  it('draws nothing of its own (BLANK), and names what a skin needs', () => {
    const blank = desugar(st, { gestures: gestures({ theme: BLANK }) })
    expect(blank.flatink).not.toMatch(/#[0-9a-f]{3}|font /)
    expect(blank.meta[0].objects).toEqual(['etoiles_Minus', 'etoiles_Plus', 'etoiles_Value'])
  })
  it('a missing bound or button is refused, with the rule', () => {
    expect(() => desugar('stepper n {\n  min 0\n  minus at 1,1\n  plus at 2,2\n}\n')).toThrow(/max/)
    expect(() => desugar('stepper n {\n  min 0\n  max 5\n  plus at 2,2\n}\n')).toThrow(/minus/)
    expect(() => desugar('stepper n {\n  min 5\n  max 0\n  minus at 1,1\n  plus at 2,2\n}\n')).toThrow(/min.*max/)
  })
})

describe('controls — slider', async () => {
  const { playHeadless } = await import('@flatkit/player/debug')
  const run = (src: string, g: unknown[]) => {
    const c = checkProgram(ensureHeader(desugar(src).flatink))
    expect(c.errors, c.report).toBe(0)
    return playHeadless(c.doc!, g as never)
  }
  const sl = (extra = '') => `slider volume {\n  min 0\n  max 1\n  step 0.25\n  start 0.5\n  rail 160,170 to 360,170\n${extra}}\n`

  it('a press on the rail jumps there; a drag follows; the value snaps to its step', () => {
    expect(run(sl(), [{ type: 'tap', x: 310, y: 170 }]).vars.volume_value).toBe(0.75)
    expect(run(sl(), [{ type: 'tap', x: 300, y: 170 }]).vars.volume_value).toBe(0.75) // 0.7 snaps to 0.75
    const r = run(sl(), [{ type: 'down', x: 170, y: 170 }, { type: 'move', x: 250, y: 170 }, { type: 'move', x: 420, y: 190 }, { type: 'up', x: 420, y: 190 }])
    expect(r.vars.volume_value).toBe(1) // past the end: clamped; off the rail: still followed
    expect(r.sends.map((s) => `${s.name}:${s.fields?.value}`)).toEqual(['change:1']) // once, at the release
  })
  it('a release where it started sends nothing', () => {
    expect(run(sl(), [{ type: 'tap', x: 260, y: 170 }]).sends).toEqual([])
  })
  it('a vertical rail: the first point is the minimum', () => {
    const src = 'slider charge {\n  min 0\n  max 10\n  rail 100,300 to 100,100\n}\n'
    expect(run(src, [{ type: 'tap', x: 100, y: 150 }]).vars.charge_value).toBe(8) // 7.5 -> the step is 1
    expect(run(src, [{ type: 'tap', x: 100, y: 300 }]).vars.charge_value).toBe(0)
  })
  it('the handle stands where the value is', () => {
    const c = checkProgram(ensureHeader(desugar(sl()).flatink))
    const r = playHeadless(c.doc!, [{ type: 'tap', x: 360, y: 170 }, { type: 'wait', frames: 1 }] as never)
    expect(r.vars.volume_value).toBe(1)
    expect(desugar(sl()).flatink).toMatch(/object "volume_Handle" \{[^}]*x = 160 \+ \(360 - 160\) \* \(volume_value - 0\) \/ \(1 - 0\)/)
  })
  it('optional − / + ends step it, as a stepper does — the keyboard way in', () => {
    const r = run(sl('  minus at 110,170\n  plus at 410,170\n'), [{ type: 'tap', target: 'volume_Plus' }, { type: 'tap', target: 'volume_Plus' }, { type: 'tap', target: 'volume_Minus' }])
    expect(r.vars.volume_value).toBe(0.75)
    expect(r.sends.map((s) => s.name)).toEqual(['change', 'change', 'change'])
  })
  it('is a control, draws nothing of its own, and names its parts', () => {
    const blank = desugar(sl('  counter at 260,230\n'), { gestures: gestures({ theme: BLANK }) })
    expect(blank.meta[0]).toMatchObject({ keyword: 'slider', control: true, objects: ['volume_Rail', 'volume_Handle', 'volume_Value'] })
    expect(blank.flatink).not.toMatch(/#[0-9a-f]{3}|font /)
  })
  it('expands with no warning at all, with or without its ends', () => {
    for (const extra of ['', '  minus at 110,170\n  plus at 410,170\n  counter at 260,240\n']) expect(checkProgram(ensureHeader(desugar(sl(extra)).flatink)).diagnostics).toEqual([])
  })
  it('a rail that is neither horizontal nor vertical, or a missing one, is refused', () => {
    expect(() => desugar('slider v {\n  min 0\n  max 1\n  rail 0,0 to 100,50\n}\n')).toThrow(/horizontal or vertical/)
    expect(() => desugar('slider v {\n  min 0\n  max 1\n}\n')).toThrow(/rail/)
  })
})
