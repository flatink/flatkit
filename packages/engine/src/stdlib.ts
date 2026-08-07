// ─────────────────────────────────────────────────────────────────────────────
//  stdlib.ts — the EMBEDDED standard library of importable "packages".
//
//  A program does `use "collision"` to make reusable functions (`fn …`) available. v1: EMBEDDED
//  packages (defined here in DSL) — works in the editor AND the CLI, with no filesystem. Coming later:
//  local file packages + symbols + registry + namespacing.
//
//  PURE module. Packages are PRE-COMPILED (DSL → AST) in stdlib.generated.ts → the runtime consumes
//  them without embedding the DSL parser. Source of truth: stdlib.sources.ts; regenerate after a change:
//  `pnpm --filter @flatkit/engine gen:stdlib`.
// ─────────────────────────────────────────────────────────────────────────────
import type { FuncDef } from '@flatkit/types'
import { PACKAGE_FUNCS } from './stdlib.generated'

/** Does an embedded package with this name exist? */
export const hasPackage = (name: string): boolean => name in PACKAGE_FUNCS

/** Names of the available embedded packages. */
export const PACKAGES: string[] = Object.keys(PACKAGE_FUNCS)

/** Functions of an embedded package (empty if unknown). Pre-compiled AST, no analysis at runtime. */
export function resolvePackage(name: string): FuncDef[] {
  return PACKAGE_FUNCS[name] ?? []
}

/** Functions available via a list of imports: each function is exposed BARE (`boxHit`) AND QUALIFIED
 *  (`collision.boxHit`). The bare name of the same symbol across packages = last wins; the qualified
 *  name disambiguates. */
export function importedFunctions(imports: string[] | undefined): FuncDef[] {
  const out: FuncDef[] = []
  for (const pkg of imports ?? []) for (const f of resolvePackage(pkg)) {
    out.push(f, { ...f, name: `${pkg}.${f.name}` }) // bare and qualified pkg.fn names
  }
  return out
}

/** Names (bare + qualified) of a package's functions — for the linter. */
export function packageFunctionNames(name: string): string[] {
  return resolvePackage(name).flatMap((f) => [f.name, `${name}.${f.name}`])
}

/** Bare function name → the package(s) that provide it. Built once. */
const BY_FUNCTION: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>()
  for (const pkg of PACKAGES) for (const f of resolvePackage(pkg)) {
    const at = m.get(f.name)
    if (at) at.push(pkg)
    else m.set(f.name, [pkg])
  }
  return m
})()

/** The package that UNIQUELY provides a bare function name — for auto-import on first use. `undefined` if
 *  no package provides it, or if several do (ambiguous: the author must pick with an explicit `use`). */
export function providingPackage(name: string): string | undefined {
  const pkgs = BY_FUNCTION.get(name)
  return pkgs && pkgs.length === 1 ? pkgs[0] : undefined
}
