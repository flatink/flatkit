import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EXPR_CHANNELS, OFFSET_CHANNELS } from '@flatkit/engine/timeline'

// The prompts were gitignored AND absent from the npm tarball, so an integrator who wanted to teach the
// DSL to a model had to copy the grammar by hand — and a copied reference diverges, silently, until the
// end user's compiler rejects the generated DSL. These assertions are the guard: renaming or dropping a
// prompt, or losing the `files` entry, must break a test rather than quietly un-ship the folder.
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const promptsDir = join(pkgDir, 'prompts')

const SHIPPED = ['README.md', 'flatink-core.md', 'flatink-lite.md', 'role-asset-creator.md', 'role-coder.md', 'role-motion-designer.md']

describe('prompts — shipped with the package', () => {
  it('every prompt is present', () => {
    for (const name of SHIPPED) expect(existsSync(join(promptsDir, name)), `${name} is missing`).toBe(true)
  })

  it('no prompt was added without being listed here (the list is the contract)', () => {
    expect(readdirSync(promptsDir).filter((f) => f.endsWith('.md')).sort()).toEqual([...SHIPPED].sort())
  })

  it('the folder is in the published `files`', () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { files: string[] }
    expect(pkg.files).toContain('prompts')
  })

  it('each prompt has content and points at the language it documents', () => {
    for (const name of SHIPPED) {
      const text = readFileSync(join(promptsDir, name), 'utf8')
      expect(text.length, `${name} is empty`).toBeGreaterThan(200)
      expect(text, `${name} never names FlatInk`).toMatch(/FlatInk/i)
    }
  })

  // The anti-drift net. These files teach the language to a model, and a reference that silently falls
  // behind is worse than no reference: it teaches the WORKAROUND for a gap the language has since closed.
  // That is exactly what happened — the additive `dx`/`dy` offsets shipped, and all three references kept
  // telling models to re-inject the base by hand. Adding a channel to the engine must break this test.
  const references = ['flatink-core.md', 'flatink-lite.md']
  const texts = () => references.map((n) => ({ name: n, text: readFileSync(join(promptsDir, n), 'utf8') }))

  it('the general references document every channel the engine exposes', () => {
    // The distinctive ones only: `x`/`y` as bare tokens appear on every other line, so asserting them
    // would prove nothing.
    for (const { name, text } of texts()) {
      for (const ch of EXPR_CHANNELS.filter((c) => c.length > 1)) {
        expect(text, `${name} never mentions the "${ch}" channel`).toMatch(new RegExp(`\\b${ch}\\b`))
      }
      // `dx`/`dy` need the CONTRACT, not the token: both files already contained "dx" as the argument of
      // `filter shadow <dx> <dy>` while teaching the workaround the offsets replace. Assert the semantics.
      expect(text, `${name} does not state the additive-offset contract (pos = at + (dx, dy))`)
        .toMatch(/at \+ \(dx, dy\)/)
      expect(OFFSET_CHANNELS).toEqual(['dx', 'dy']) // if the engine renames them, the line above is stale
    }
  })

  it('they name the monotone clock, not just the wrapping time', () => {
    // Capturing an instant on `time` is the silent trap `--check` now reports; a reference that only
    // names `time` walks a model straight into it.
    for (const { name, text } of texts()) {
      expect(text, `${name} never mentions \`clock\``).toMatch(/\bclock\b/)
    }
  })

  it('no reference still teaches re-injecting the base as THE answer to the absolute-channel gotcha', () => {
    // `x = $(X) + bump` is legitimate for a genuinely absolute position, but it must not be presented as
    // the fix for "my animation moved to the corner" — `dx`/`dy` is.
    for (const { name, text } of [...texts(), { name: 'role-coder.md', text: readFileSync(join(promptsDir, 'role-coder.md'), 'utf8') }]) {
      const gotcha = text.slice(text.search(/REPLACES?\b/))
      expect(gotcha.slice(0, 600), `${name} states the gotcha without offering dx/dy`).toMatch(/\bdx\b/)
    }
  })
})
