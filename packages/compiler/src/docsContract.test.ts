import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MATH_CTX } from '@flatkit/engine/expr'
import { checkProgram } from './check'

// Three questions asked by people writing real activities had no answer in the docs: in what order does a
// frame run, how long is a step, and which functions give the same bits on every engine (flatink/flatink#33
// #34 #36). The answers are facts about the engine, pinned by tests next to the code; these check that the
// pages STATE them, and keep stating them when the engine grows.
const docs = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs')
const read = (name: string) => readFileSync(join(docs, name), 'utf8')
/** The text of a `## Title` section, up to the next `## `. */
const section = (text: string, title: RegExp): string => {
  const m = title.exec(text)
  if (!m) return ''
  const rest = text.slice(m.index + m[0].length)
  const end = rest.search(/^## /m)
  return end < 0 ? rest : rest.slice(0, end)
}

describe('docs — how a frame runs', () => {
  const page = read('behavior-and-interactions.md')
  const s = section(page, /^## How a frame runs$/m)

  it('there is a section, and it gives the order', () => {
    expect(s, 'no "## How a frame runs" section').not.toBe('')
    // handlers, then the steps, then `at frame`, then the picture — in that order on the page.
    const at = (re: RegExp) => { const i = s.search(re); expect(i, `the section never mentions ${re}`).toBeGreaterThanOrEqual(0); return i }
    const order = [at(/handlers?/i), at(/`every frame`/), at(/`at frame/), at(/drawn|picture/i)]
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
  it('it says a step is 1/60 s whatever the timeline, and names `DT`', () => {
    expect(s).toMatch(/60 Hz|1\/60/)
    expect(s).toMatch(/`DT`/)
    expect(s).toMatch(/timeline/)
  })
  it('it says what happens when the display is slow', () => {
    expect(s).toMatch(/30 steps/)
    expect(s).toMatch(/0\.25/)
  })
  it('it warns that a handler reads a derived value as the last step left it', () => {
    expect(s).toMatch(/last step/i)
  })
  it('the gotchas page points at it', () => {
    expect(read('dsl-gotchas.md')).toMatch(/behavior-and-interactions\.md#how-a-frame-runs/)
  })
})

describe('docs — which functions are exact', () => {
  const page = read('expressions-and-stdlib.md')
  const s = section(page, /^## Determinism$/m)
  const names = (title: RegExp): string[] => {
    const m = title.exec(s)
    if (!m) return []
    const rest = s.slice(m.index + m[0].length)
    const end = rest.search(/\n- \*\*|\n\n/) // the bullet: up to the next one, or the blank line
    return [...(end < 0 ? rest : rest.slice(0, end)).matchAll(/`([A-Za-z_]\w*)`/g)].map((x) => x[1])
  }

  it('there is a section', () => {
    expect(s, 'no "## Determinism" section').not.toBe('')
  })
  it('EVERY built-in function is classified, exact or engine-dependent — a new one must be too', () => {
    const exact = new Set(names(/\*\*Exact/)), loose = new Set(names(/\*\*Engine-dependent/))
    for (const fn of Object.keys(MATH_CTX).filter((k) => typeof MATH_CTX[k] === 'function')) {
      expect(exact.has(fn) || loose.has(fn), `\`${fn}\` is in neither list of the Determinism section`).toBe(true)
      expect(exact.has(fn) && loose.has(fn), `\`${fn}\` is in both lists`).toBe(false)
    }
  })
  it('the functions ECMAScript leaves to the implementation are on the engine-dependent side', () => {
    const loose = new Set(names(/\*\*Engine-dependent/))
    for (const fn of ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'pow', 'exp', 'log', 'hypot']) expect(loose.has(fn), fn).toBe(true)
    for (const fn of ['sqrt', 'floor', 'round', 'abs', 'min', 'max', 'mod', 'clamp', 'lerp']) expect(loose.has(fn), fn).toBe(false)
  })
  it('it says how `%`, `round` and `random` behave for someone writing a replica', () => {
    expect(s).toMatch(/`%`/)
    expect(s).toMatch(/half/i) // round: halves go up
    expect(s).toMatch(/seed/i)
  })
})

// `DT` is a new name in a language where programs already exist: one that declared its own `DT` must be told.
describe('`DT` — a variable of that name is reported, not silently overridden', () => {
  it('`--check` says the variable is hidden by the constant', () => {
    const r = checkProgram('size 200 200\nvar DT = 0.02\nvar v = 0\nscene { layer "c" { group "G" at 100,100 { layer "a" { circle 0 0 10 fill #cc3333 } } } }\nevery frame { v = v + DT }\n')
    expect(r.report).toMatch(/variable "DT" is hidden by the constant DT/)
  })
})
