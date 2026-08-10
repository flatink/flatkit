import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { checkProgram } from '@flatkit/compiler'
import { desugar, sugarCard } from './index'

// Three times running, this package's documentation promised a form its parser rejected: `raw { … }` on
// one line (which the README wrote that way), decor in a plain `raw` (which `sugarCard` taught), and a
// block written inline (which the README's compound example showed). Each was found by a consumer, not
// by us. The class of defect is "the docs and the code disagree", so the fix is a test that reads the
// docs — every sugar example we publish must desugar and compile.
const README = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'README.md'), 'utf8')

/** Fenced blocks that are sugar sources: they open a block or an escape hatch at column 0. */
function sugarExamples(text: string): string[] {
  return [...text.matchAll(/^```[a-z]*\n([\s\S]*?)^```/gm)]
    .map((m) => m[1])
    .filter((b) => /^(place|compose|steps|raw)\b/m.test(b) && !/^import /m.test(b))
}

describe('the documentation compiles', () => {
  const examples = sugarExamples(README)

  it('the README shows sugar, and every example of it round-trips', () => {
    expect(examples.length, 'no sugar example found — the extractor stopped matching').toBeGreaterThanOrEqual(2)
    for (const src of examples) {
      const out = desugar(src)
      const r = checkProgram(out.flatink)
      expect(r.report, `this README example does not compile:\n${src}\n${r.report}`).toBe('')
    }
  })

  it('and so does every example in the card a model is prompted with', () => {
    // `sugarCard()` is pasted into a prompt verbatim, so a form shown there is a form a model will
    // write. It taught `raw { layer … }` once, which lands outside the scene and errors.
    const card = sugarCard()
    for (const src of sugarExamples(`\`\`\`\n${card}\n\`\`\``)) {
      // The card's block sketches use placeholders (`<name>`, `…`), so they are read for SHAPE, not
      // compiled. What must round-trip are its escape-hatch lines, which are written out in full.
      for (const line of src.split('\n')) {
        if (!/^raw\b/.test(line) || line.includes('…')) continue
        const out = desugar(`place p {\n  prompt "x"\n  target T at 200,400\n  item a -> T at 100,100\n}\n\n${line}\n`)
        expect(checkProgram(out.flatink).errors, `the card teaches a form that errors:\n  ${line}`).toBe(0)
      }
    }
  })

  it('a block written on one line names the rule instead of "unrecognised line"', () => {
    // The grammar sketches show the shape inline, so it is the natural thing to copy.
    const inline = 'place p { prompt "x"  target T at 200,400  item a -> T at 100,100 }\n'
    expect(() => desugar(inline)).toThrow(/ONE per line/)
    expect(() => desugar(inline)).toThrow(/place p \{/) // and shows it laid out
  })
})
