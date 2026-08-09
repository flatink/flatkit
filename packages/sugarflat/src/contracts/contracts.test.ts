import { describe, it, expect } from 'vitest'
import { checkProgram } from '@flatkit/compiler'
import { playHeadless } from '@flatkit/player/debug'
import { desugar, GESTURES } from '../index'
import { CONTRACTS } from './contracts'

// The net for the rewrite. Each contract states what a gesture DOES — the events a learner's actions
// produce and the state left behind — never the DSL it writes. That is the whole point: the gestures
// are being stripped of their composition, so every text golden would go red without telling us whether
// the activity still works.
//
// The suite arms itself: contracts run against gestures that are REGISTERED. Until the port lands the
// run is empty, and the moment a gesture is added its contract executes.
describe('gesture contracts — behavior survives the rewrite', () => {
  const shipped = new Set(GESTURES.map((g) => g.keyword))
  const live = CONTRACTS.filter((c) => shipped.has(c.keyword))

  it('every contract names a gesture, a script and an outcome', () => {
    // Runs even when nothing is registered, so the fixtures cannot rot while the port is in progress.
    expect(CONTRACTS.length).toBeGreaterThanOrEqual(3)
    for (const c of CONTRACTS) {
      expect(c.source, `${c.keyword}: empty source`).toMatch(new RegExp(`^${c.keyword}\\b`))
      expect(c.script.length, `${c.keyword}: empty script`).toBeGreaterThan(0)
      expect(c.sends.length, `${c.keyword}: a contract with no expected event proves nothing`).toBeGreaterThan(0)
      expect(Object.keys(c.vars).length, `${c.keyword}: no expected state`).toBeGreaterThan(0)
    }
  })

  it('every shipped gesture has a contract (a gesture without one is untested behavior)', () => {
    const covered = new Set(CONTRACTS.map((c) => c.keyword))
    for (const keyword of shipped) expect(covered.has(keyword), `no contract for "${keyword}"`).toBe(true)
  })

  it.each(live.map((c) => [c.keyword, c] as const))('%s: expands clean, then behaves as contracted', (_kw, contract) => {
    const { flatink } = desugar(contract.source)

    // 1. The expansion is the artefact of record: it must be something the compiler has NOTHING to say
    //    about. A warning on generated DSL is a defect nobody is watching for.
    const check = checkProgram(flatink)
    expect(check.report, `${contract.keyword} expanded with diagnostics`).toBe('')
    expect(check.doc).not.toBeNull()

    // 2. And it must still do the job when a learner plays it.
    const result = playHeadless(check.doc!, contract.script)
    expect(result.sends.map((s) => s.name)).toEqual(contract.sends)
    for (const [name, value] of Object.entries(contract.vars)) {
      expect(result.vars[name], `${contract.keyword}: var ${name}`).toBeCloseTo(value, 5)
    }
  })
})
