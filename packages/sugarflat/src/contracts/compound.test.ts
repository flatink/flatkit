import { describe, it, expect } from 'vitest'
import { checkProgram } from '@flatkit/compiler'
import { playHeadless } from '@flatkit/player/debug'
import { desugar } from '../index'

// The reason gestures return parts instead of programs. A document has exactly one `scene`, one header
// and one behavior half; composing by concatenating whole programs was never going to work.
const SRC = `place words {
  prompt "Put each word under its part of speech"
  target Nouns at 200,200
  item cat -> Nouns at 120,80
}

compose coins {
  prompt "Make exactly 150"
  total 150
  chip 50  at 200,500
  chip 100 at 420,500
}

raw scene under { layer "bg" { rect 0 0 760 620 fill #112233 } }
raw {
var lives = 3
object "words_TNouns" { opacity = lives > 0 ? 1 : 0.3 }
}
`

describe('a document holding two blocks', () => {
  const r = desugar(SRC)

  it('is one program: one header, one scene, and it compiles clean', () => {
    expect(r.flatink.match(/^size /gm)).toHaveLength(1)
    expect(r.flatink.match(/^scene \{/gm)).toHaveLength(1)
    const check = checkProgram(r.flatink)
    expect(check.report).toBe('')
  })

  it('reports each block, in document order', () => {
    expect(r.meta.map((m) => `${m.keyword}:${m.name}`)).toEqual(['place:words', 'compose:coins'])
    expect(r.meta[0].objects).toContain('words_TNouns')
    expect(r.meta[1].objects).toEqual(['coins_C0', 'coins_C1'])
  })

  it('keeps their state apart — both gestures declare a `done`, and neither wins', () => {
    expect(r.meta[0].doneVar).toBe('words_done')
    expect(r.meta[1].doneVar).toBe('coins_done')
    expect(r.flatink).toMatch(/^var words_done = 0$/m)
    expect(r.flatink).toMatch(/^var coins_done = 0$/m)
  })

  it('top-level raw travels too, and can bind to a name the block emitted', () => {
    expect(r.flatink).toMatch(/^var lives = 3$/m)
    expect(r.flatink).toContain('object "words_TNouns" { opacity = lives > 0 ? 1 : 0.3 }')
  })

  it('the decor is behind BOTH blocks, not just the first', () => {
    const bg = r.flatink.indexOf('layer "bg"')
    expect(bg).toBeLessThan(r.flatink.indexOf('words_targets'))
    expect(bg).toBeLessThan(r.flatink.indexOf('coins_chips'))
  })

  // The semantic decision, and the one worth testing rather than asserting in a comment: finishing one
  // block is `part`; `completed` belongs to the DOCUMENT and fires once, when every block is done.
  it('finishing ONE block emits `part` and NOT `completed`', () => {
    const doc = checkProgram(r.flatink).doc!
    const res = playHeadless(doc, [
      { type: 'drag', source: 'words_Icat', target: 'words_TNouns' },
      { type: 'wait', frames: 2 },
    ])
    expect(res.sends.map((s) => s.name)).toEqual(['correct', 'part'])
    expect(res.vars.words_done).toBe(1)
    expect(res.vars.coins_done).toBe(0)
  })

  it('finishing BOTH emits `completed`, once', () => {
    const doc = checkProgram(r.flatink).doc!
    const res = playHeadless(doc, [
      { type: 'drag', source: 'words_Icat', target: 'words_TNouns' },
      { type: 'tap', target: 'coins_C1' },
      { type: 'tap', target: 'coins_C0' },
      { type: 'wait', frames: 30 },
    ])
    const names = res.sends.map((s) => s.name)
    expect(names.filter((n) => n === 'part')).toHaveLength(2)
    expect(names.filter((n) => n === 'completed')).toHaveLength(1) // not once per frame
    expect(names[names.length - 1]).toBe('completed')
  })

  it('every payload names its block, so a host can tell them apart', () => {
    const doc = checkProgram(r.flatink).doc!
    const res = playHeadless(doc, [
      { type: 'drag', source: 'words_Icat', target: 'words_TNouns' },
      { type: 'tap', target: 'coins_C1' },
      { type: 'wait', frames: 2 },
    ])
    const correct = res.sends.filter((s) => s.name === 'correct')
    expect(correct.map((s) => (s.fields as Record<string, number>).block)).toEqual([0, 1])
  })
})

// flatink/flatink#59 — the elements always stood where the author wrote them, so playing an activity
// again was not a new attempt. `shuffle` swaps their places when the activity loads, drawing from
// `random()`: reproducible under a seed (a replayed test), different from one learner's run to the next.
describe('shuffle — the things the learner picks from swap places at load', () => {
  const place = (shuffle: boolean) => `place p {\n  prompt "x"\n${shuffle ? '  shuffle\n' : ''}  target A at 150,470\n  target B at 450,470\n  item a -> A at 100,150\n  item b -> B at 300,150\n  item c -> A at 500,150\n  item d -> B at 700,150\n}\n`
  const ITEMS = ['p_Ia', 'p_Ib', 'p_Ic', 'p_Id']
  const docOf = (src: string) => { const c = checkProgram(desugar(src).flatink); expect(c.errors).toBe(0); return c.doc! }
  const layout = (src: string, ids: string[], seed: number, x = (id: string) => `${id}X`) => { const v = playHeadless(docOf(src), [], { seed }).vars; return ids.map((id) => v[x(id)] as number) }

  it('place: the items end up on the declared spots, in another order', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 8; seed++) {
      const xs = layout(place(true), ITEMS, seed)
      expect([...xs].sort((a, b) => a - b)).toEqual([100, 300, 500, 700])
      seen.add(xs.join(','))
    }
    expect(seen.size).toBeGreaterThan(1)
  })
  it('the same seed lays them out the same way', () => {
    expect(layout(place(true), ITEMS, 5)).toEqual(layout(place(true), ITEMS, 5))
  })
  it('without `shuffle` nothing moves and the program draws nothing at random', () => {
    expect(layout(place(false), ITEMS, 5)).toEqual([100, 300, 500, 700])
    expect(desugar(place(false)).flatink).not.toContain('random')
    expect(desugar(place(false)).meta[0].shuffle).toBeUndefined()
    expect(desugar(place(true)).meta[0].shuffle).toBe(true)
  })
  it('the activity still plays: each item goes from where it now stands to its target', () => {
    const res = playHeadless(docOf(place(true)), [
      { type: 'drag', source: 'p_Ia', target: 'p_TA' }, { type: 'drag', source: 'p_Ib', target: 'p_TB' },
      { type: 'drag', source: 'p_Ic', target: 'p_TA' }, { type: 'drag', source: 'p_Id', target: 'p_TB' },
      { type: 'wait', frames: 3 },
    ], { seed: 3 })
    expect(res.sends.map((s) => s.name)).toEqual(['correct', 'correct', 'correct', 'correct', 'part', 'completed'])
  })
  it('a wrong drop sends the item back to the spot the shuffle gave it', () => {
    const doc = docOf(place(true))
    const home = playHeadless(doc, [], { seed: 3 }).vars
    const after = playHeadless(doc, [{ type: 'drag', source: 'p_Ia', target: 'p_TB' }], { seed: 3 })
    expect(after.sends.map((s) => s.name)).toEqual(['incorrect'])
    expect([after.vars.p_IaX, after.vars.p_IaY]).toEqual([home.p_IaX, home.p_IaY])
  })
  it('steps: the cards swap places, the ORDER of the sequence does not', () => {
    const src = 'steps s {\n  shuffle\n  step "one" at 100,300\n  step "two" at 300,300\n  step "three" at 500,300\n}\n'
    const seen = new Set<string>()
    for (let seed = 1; seed <= 8; seed++) {
      const v = playHeadless(docOf(src), [], { seed }).vars
      const xs = v.s_sx as number[]
      expect([...xs].sort((a, b) => a - b)).toEqual([100, 300, 500])
      seen.add(xs.join(','))
    }
    expect(seen.size).toBeGreaterThan(1)
    const res = playHeadless(docOf(src), [{ type: 'tap', target: 's_S0' }, { type: 'tap', target: 's_S1' }, { type: 'tap', target: 's_S2' }, { type: 'wait', frames: 3 }], { seed: 2 })
    expect(res.sends.map((s) => s.name)).toEqual(['step', 'step', 'step', 'part', 'completed'])
  })
  it('compose: the chips swap places and still add up', () => {
    const src = 'compose c {\n  shuffle\n  total 30\n  chip 10 at 100,300\n  chip 20 at 300,300\n  chip 5 at 500,300\n}\n'
    const res = playHeadless(docOf(src), [{ type: 'tap', target: 'c_C0' }, { type: 'tap', target: 'c_C1' }, { type: 'wait', frames: 3 }], { seed: 4 })
    expect(res.sends.map((s) => s.name)).toEqual(['correct', 'correct', 'part', 'completed'])
    expect([...(res.vars.c_sx as number[])].sort((a, b) => a - b)).toEqual([100, 300, 500])
  })
})

// flatink/flatink#60 — the sugar gestures could only be played with a pointer: the one screen of a story
// that did not pass the keyboard test. Every element is now `focusable`, and `place` has a second way in:
// pick an item (Enter, or a tap), then pick its target.
describe('keyboard — the gestures are played with Tab and Enter', () => {
  const docOf = (src: string) => { const c = checkProgram(desugar(src).flatink); expect(c.errors).toBe(0); return c.doc! }
  const tab = { type: 'key', name: 'Tab' } as const, enter = { type: 'key', name: 'Enter' } as const
  const names = (res: { sends: { name: string }[] }) => res.sends.map((s) => s.name)

  it('compose: Tab to a chip, Enter to tap it', () => {
    const doc = docOf('compose c {\n  total 30\n  chip 10 at 100,300\n  chip 20 at 300,300\n}\n')
    expect(names(playHeadless(doc, [tab, enter, tab, enter, { type: 'wait', frames: 3 }]))).toEqual(['correct', 'correct', 'part', 'completed'])
  })
  it('steps: the cards are walked in the order of the sequence', () => {
    const doc = docOf('steps s {\n  step "one" at 100,300\n  step "two" at 300,300\n  step "three" at 500,300\n}\n')
    expect(names(playHeadless(doc, [tab, enter, tab, enter, tab, enter, { type: 'wait', frames: 3 }]))).toEqual(['step', 'step', 'step', 'part', 'completed'])
  })
  const place = 'place p {\n  target A at 150,470\n  target B at 450,470\n  item a -> A at 100,150\n  item b -> B at 300,150\n}\n'
  it('place: Enter picks the focused item, Enter on a target puts it there', () => {
    // tab order: the items (a, b), then the targets (A, B)
    const res = playHeadless(docOf(place), [tab, enter, tab, tab, enter, { type: 'wait', frames: 2 }])
    expect(names(res)).toEqual(['correct'])
    expect([res.vars.p_IaPlaced, res.vars.p_sel]).toEqual([1, 0])
  })
  it('place: the wrong target answers `incorrect` and lets go of the item', () => {
    const res = playHeadless(docOf(place), [tab, enter, tab, tab, tab, enter, { type: 'wait', frames: 2 }]) // a, then B
    expect(names(res)).toEqual(['incorrect'])
    expect([res.vars.p_IaPlaced, res.vars.p_sel]).toEqual([0, 0])
  })
  it('place: a target clicked with nothing picked does nothing', () => {
    const res = playHeadless(docOf(place), [tab, tab, tab, enter, { type: 'wait', frames: 2 }])
    expect(names(res)).toEqual([])
  })
  it('place: tap an item, then tap its target — the same path, with a finger', () => {
    const res = playHeadless(docOf(place), [{ type: 'tap', target: 'p_Ib' }, { type: 'tap', target: 'p_TB' }, { type: 'wait', frames: 2 }])
    expect(names(res)).toEqual(['correct'])
    expect(res.vars.p_IbPlaced).toBe(1)
  })
  it('place: dragging still works, and both ways finish the block', () => {
    const res = playHeadless(docOf(place), [{ type: 'drag', source: 'p_Ia', target: 'p_TA' }, { type: 'tap', target: 'p_Ib' }, { type: 'tap', target: 'p_TB' }, { type: 'wait', frames: 3 }])
    expect(names(res)).toEqual(['correct', 'correct', 'part', 'completed'])
  })
})
