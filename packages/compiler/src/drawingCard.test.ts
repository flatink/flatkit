import { describe, it, expect } from 'vitest'
import { drawingCard } from './drawingCard'
import { languageCard } from './languageCard'
import { checkProgram } from './check'
import { parseProgramFull } from '@flatkit/engine/flatFormat'

/** The ```flatink fences of the card — complete programs, meant to be compiled. */
function flatinkExamples(card: string): string[] {
  return [...card.matchAll(/```flatink\n([\s\S]*?)```/g)].map((m) => m[1])
}

describe('drawingCard', () => {
  const card = drawingCard()

  // The reason this card exists in the repo rather than in each consumer: a reference that is COPIED
  // drifts. The examples are compiled here, so the day the drawing grammar moves this test goes red —
  // instead of a silently wrong card teaching a model DSL that no longer parses.
  it('every example compiles, and passes --check without an error', () => {
    const examples = flatinkExamples(card)
    expect(examples.length).toBeGreaterThanOrEqual(4)
    for (const src of examples) {
      expect(() => parseProgramFull(src), src).not.toThrow()
      const r = checkProgram(src)
      expect(r.errors, `${src}\n${r.report}`).toBe(0)
    }
  })

  it('covers the drawing vocabulary that languageCard says nothing about', () => {
    // The measurement that opened the friction: languageCard is 100% behavior — an integrator asking a
    // model for decor handed it a reference with nothing about shapes, and what a model guesses in a DSL
    // does not compile. These are the words that were missing.
    const behavior = languageCard()
    // Measured on 0.23: these seven appear NOWHERE in the behavior card. A model asked for decor had to
    // invent them. They are the reason this card exists, so assert both halves of the claim.
    for (const word of ['path', 'stroke', 'linear', 'radial', 'filter', 'clip', 'mask']) {
      expect(behavior, `languageCard unexpectedly covers "${word}" — drop it from this list`).not.toMatch(new RegExp(`\\b${word}\\b`))
      expect(card, `drawingCard must document "${word}"`).toMatch(new RegExp(`\\b${word}\\b`))
    }
    // The rest the behavior card only NAMES in passing (`fill(n, v)`, "text / image", the `opacity`
    // channel) without ever saying how to draw one.
    for (const word of ['fill', 'layer', 'image', 'opacity', 'text']) {
      expect(card, `drawingCard must document "${word}"`).toMatch(new RegExp(`\\b${word}\\b`))
    }
  })

  it('states the word order, the rule broken most often', () => {
    expect(card).toMatch(/as/)
    expect(card).toMatch(/at/)
    expect(card).toMatch(/order/i)
  })

  it('stays system-prompt sized', () => {
    expect(card.length).toBeLessThan(6000) // languageCard is ~3.5k; the pair must still fit a prompt
  })
})
