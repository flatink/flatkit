// ─────────────────────────────────────────────────────────────────────────────
//  check.ts — `flatc --check`, as a function.
//
//  The compiled `Doc` is NOT enough to validate a program. Two whole classes of error live in the
//  SOURCE and are gone by the time the Doc exists:
//    • statements the parser DROPS (an unknown top-level statement, a malformed line inside a block) —
//      a text that is not FlatInk at all compiles to an empty Doc that nothing distinguishes from a
//      valid one;
//    • an `object "X" { … }` block that binds to NOTHING (X is a shape, a layer, or absent) — the
//      binding simply never lands, and the Doc holds no trace of the attempt.
//  Both are source-level passes (`behaviorDiagnostics`, `objectTargetDiagnostics`) that the CLI ran and
//  no public call could reach: an integrator validating in a service got a verdict weaker than the same
//  file checked at the prompt, and had to shell out to `flatc` to get the real one.
//
//  `checkProgram(src)` runs the WHOLE pass — source in, diagnostics out, no filesystem, no subprocess.
//  The CLI calls the same function, so the two cannot drift.
// ─────────────────────────────────────────────────────────────────────────────
import type { Doc } from '@flatkit/types'
import { behaviorDiagnostics, objectTargetDiagnostics } from '@flatkit/engine/flatFormat'
import { compileFlatpack, type MediaMap } from './compile'
import { lintDoc } from './programDoc'

/** One diagnostic, positioned in the AUTHOR'S source. `scope` is `scene` or `object "Name"`. */
export type CheckDiagnostic = { scope: string; line: number; col: number; severity: 'error' | 'warning'; message: string }

export type CheckOptions = {
  /** Text of each `.flat` symbol library the program draws on — the CLI auto-discovers them beside the file. */
  assetSrcs?: string[]
  /** Declared media, by path (only affects the returned Doc; diagnostics do not depend on it). */
  media?: MediaMap
}

export type CheckResult = {
  /** `false` as soon as one diagnostic is an error — the exit code of `flatc --check`. Warnings do not block. */
  ok: boolean
  errors: number
  warnings: number
  diagnostics: CheckDiagnostic[]
  /** The diagnostics as `flatc` prints them (`''` when there is nothing to say). */
  report: string
  /** The compiled program, or `null` if the parser rejected the source outright. */
  doc: Doc | null
}

const line1 = (d: CheckDiagnostic): string => `[${d.scope}] ${d.line}:${d.col}: ${d.severity}: ${d.message}`

/** The diagnostics as `flatc` prints them: one `[scope] line:col: level: message` per line. */
export const formatDiagnostics = (diagnostics: CheckDiagnostic[]): string => diagnostics.map(line1).join('\n')

/** The two SOURCE-level passes, which read the author's text rather than the compiled Doc. Always errors. */
function sourceDiagnostics(src: string): CheckDiagnostic[] {
  return [...behaviorDiagnostics(src), ...objectTargetDiagnostics(src)]
    .map(({ scope, diag }) => ({ scope, line: diag.line, col: diag.col, severity: 'error' as const, message: diag.message }))
}

/**
 * Every diagnostic of a program that HAS compiled: the source-level passes, then the semantic lint of the
 * whole Doc (read against `src`, so positions point into the author's file). Exact-duplicate lines are
 * dropped — a scene parse error is legitimately seen by both paths, which now both read the source.
 */
export function programDiagnostics(doc: Doc, src: string): CheckDiagnostic[] {
  const out: CheckDiagnostic[] = []
  const seen = new Set<string>()
  const push = (d: CheckDiagnostic) => { const k = line1(d); if (!seen.has(k)) { seen.add(k); out.push(d) } }
  for (const d of sourceDiagnostics(src)) push(d)
  for (const { scope, diag } of lintDoc(doc, src)) push({ scope, line: diag.line, col: diag.col, severity: diag.severity === 'warning' ? 'warning' : 'error', message: diag.message })
  return out
}

const tally = (diagnostics: CheckDiagnostic[], doc: Doc | null): CheckResult => {
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  return { ok: errors === 0, errors, warnings: diagnostics.length - errors, diagnostics, report: formatDiagnostics(diagnostics), doc }
}

/**
 * Check a `.flatink` program — the same pass as `flatc --check`, on a string. Never throws: a source the
 * parser rejects outright comes back as a diagnostic with `doc: null`, not an exception.
 *
 * ```ts
 * const { ok, report } = checkProgram(srcFromAnLLM)
 * if (!ok) regenerate(report) // the report is the repair prompt
 * ```
 */
export function checkProgram(src: string, opts: CheckOptions = {}): CheckResult {
  let doc: Doc
  try {
    doc = compileFlatpack(src, opts.assetSrcs ?? [], opts.media ?? {})
  } catch (e) {
    // The parser gives up without a position (it stops at the offending token, not at a line) — report it
    // at the top of the file rather than inventing coordinates.
    return tally([{ scope: 'scene', line: 1, col: 1, severity: 'error', message: `compile error: ${(e as Error).message}` }], null)
  }
  return tally(programDiagnostics(doc, src), doc)
}
