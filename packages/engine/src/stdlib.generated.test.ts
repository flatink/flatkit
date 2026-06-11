import { describe, it, expect } from 'vitest'
import { PACKAGE_SOURCES } from './stdlib.sources'
import { PACKAGE_FUNCS } from './stdlib.generated'
import { resolvePackage, PACKAGES } from './stdlib'
import { parseUnits } from './dsl'
import { unitsToFunctions } from './scriptDoc'

// The runtime plays an already-compiled .flatpack: it must NOT bundle the DSL parser. The stdlib
// packages are therefore PRE-COMPILED (stdlib.generated.ts). This test guarantees the generated AST
// stays IN SYNC with the DSL sources — if stdlib.sources.ts is edited without regenerating, it fails.
describe('stdlib — pre-compiled AST in sync with the sources', () => {
  it('same packages in sources, generated and public API', () => {
    const fromSources = Object.keys(PACKAGE_SOURCES).sort()
    expect(Object.keys(PACKAGE_FUNCS).sort()).toEqual(fromSources)
    expect([...PACKAGES].sort()).toEqual(fromSources)
  })

  it('each generated package == re-parse of its DSL source (regenerate if this breaks)', () => {
    for (const [name, src] of Object.entries(PACKAGE_SOURCES)) {
      const reparsed = unitsToFunctions(parseUnits(src).units)
      expect(PACKAGE_FUNCS[name], `package "${name}" out of sync — run: pnpm --filter @flatkit/engine gen:stdlib`).toEqual(reparsed)
    }
  })

  it('resolvePackage returns the pre-compiled AST (same objects as PACKAGE_FUNCS)', () => {
    expect(resolvePackage('collision')).toBe(PACKAGE_FUNCS.collision)
    expect(resolvePackage('missing')).toEqual([])
  })

  it('every stdlib function is a value function (fn … = expr)', () => {
    for (const funcs of Object.values(PACKAGE_FUNCS)) {
      for (const f of funcs) {
        expect(f.kind).toBe('value')
        expect(typeof f.name).toBe('string')
        expect(Array.isArray(f.params)).toBe(true)
      }
    }
  })
})
