import { describe, it, expect } from 'vitest'
import type { Doc, Group, Text, Item, Layer } from '@flatkit/types'
import { playHeadless } from '@flatkit/player/debug'
import { compileFlatpack } from './compile'
import { checkProgram } from './check'

// Reported by a consumer writing slides: a group that bears the same name as a DISPLAYED text lost its
// animation to the text, without a word. A text that has no `as "<id>"` is named by what it shows, so a
// caption reading "Titre" and a group "Titre" competed for `pose "Titre"` — and the text won (the last
// declared), the group was never posed, and `--check` said only that "Titre" is never drawn. For an
// `object` block it was the other way round: the first declared won. The name now always goes to the group.
const scene = (order: 'group-first' | 'text-first', rest: string) => {
  const g = '    group "Titre" at 50,100 { layer "c" { rect 0 0 40 40 fill #cc3333 } }'
  const t = '    text "Titre" at 200,20 size 24 color #000000 box 150 30'
  return `size 400 200\ntimeline 24 48\nscene {\n  layer "a" {\n${order === 'group-first' ? `${g}\n${t}` : `${t}\n${g}`}\n${rest}  }\n}\n`
}
const items = (doc: Doc): Item[] => doc.layers.flatMap((l: Layer) => l.items)
const group = (doc: Doc) => items(doc).find((i) => 'kind' in i && i.kind === 'group') as Group
const text = (doc: Doc) => items(doc).find((i) => 'kind' in i && i.kind === 'text') as Text

for (const order of ['group-first', 'text-first'] as const) {
  describe(`a group and a text that shows its name (${order})`, () => {
    it('`pose "Titre"` poses the GROUP', () => {
      const doc = compileFlatpack(scene(order, '    cel 0 tween { pose "Titre" at 50,100 }\n    cel 24 { pose "Titre" at 250,100 }\n'))
      const posed = doc.layers[0].cels!.flatMap((c) => c.poses.map((p) => p.id))
      expect(posed).toEqual([group(doc).id, group(doc).id])
    })
    it('`object "Titre"` binds the GROUP', () => {
      const doc = compileFlatpack(scene(order, '') + 'object "Titre" { x = 50 + 100 * clock }\n')
      expect(group(doc).expressions?.x).toBe('50 + 100 * clock')
      expect(text(doc).expressions).toBeUndefined()
    })
    it('`Titre.x` reads the GROUP', () => {
      const src = scene(order, '').replace('size 400 200', 'size 400 200\nvar seen = 0') + 'every frame { seen = Titre.x }\n'
      expect(playHeadless(compileFlatpack(src), [{ type: 'wait', frames: 1 }]).vars.seen).toBe(50)
    })
    it('nothing to warn about: the rule is fixed, whatever the order — measured on 13 slides of a consumer that bear such a pair', () => {
      expect(checkProgram(scene(order, '') + 'object "Titre" { x = 60 }\n').report).toBe('')
    })
  })
}

describe('what does not change', () => {
  it('a text that is ALONE with its name is still addressed by what it shows', () => {
    const doc = compileFlatpack('size 400 200\ntimeline 24 48\nscene {\n  layer "a" {\n    text "Bonjour" at 20,20 size 24 color #000000 box 150 30\n    cel 0 { pose "Bonjour" at 20,20 }\n    cel 24 { pose "Bonjour" at 200,20 }\n  }\n}\n')
    expect(doc.layers[0].cels![0].poses[0].id).toBe(text(doc).id)
  })
  it('a text with `as "<id>"` is addressed by its id, and shares nothing with a group of the name it shows', () => {
    const src = 'size 400 200\nscene {\n  layer "a" {\n    group "Titre" at 50,100 { layer "c" { rect 0 0 40 40 fill #cc3333 } }\n    text "Titre" as "legende" at 200,20 size 24 color #000000 box 150 30\n  }\n}\nobject "legende" { opacity = 0.5 }\n'
    const doc = compileFlatpack(src)
    expect(text(doc).expressions?.opacity).toBe('0.5')
  })
})

describe('the wrapper idiom is not a collision', () => {
  it('`group "Title" { … text "Title" … }` — a text in a group named after it — gets no warning', () => {
    const src = 'size 400 200\nscene {\n  layer "a" {\n    group "Title" at 64,80 { layer "c" { text "Title" at 0,0 size 24 color #000000 box 300 40 } }\n  }\n}\nobject "Title" { opacity = 0.5 }\n'
    expect(checkProgram(src).report).toBe('')
    expect(group(compileFlatpack(src)).expressions?.opacity).toBe('0.5')
  })
})
