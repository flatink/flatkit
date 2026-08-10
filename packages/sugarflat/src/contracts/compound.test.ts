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
