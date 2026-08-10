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
import type { TextEdit } from '@flatkit/engine/dsl'
import { FlatSyntaxError, behaviorDiagnostics, duplicateBindingDiagnostics, objectTargetDiagnostics, sceneOnlyUnitDiagnostics, itemOnlyUnitDiagnostics } from '@flatkit/engine/flatFormat'
import { compileFlatpack, type MediaMap } from './compile'
import { lintDoc } from './programDoc'

/** One diagnostic, positioned in the AUTHOR'S source. `scope` is `scene` or `object "Name"`. `fix` is
 *  present only when the repair is MECHANICAL -- see `TextEdit`. */
export type CheckDiagnostic = { scope: string; line: number; col: number; severity: 'error' | 'warning'; message: string; fix?: TextEdit }

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
  return [...behaviorDiagnostics(src), ...objectTargetDiagnostics(src), ...sceneOnlyUnitDiagnostics(src), ...itemOnlyUnitDiagnostics(src)]
    .map(({ scope, diag }) => ({ scope, line: diag.line, col: diag.col, severity: 'error' as const, message: diag.message, ...(diag.fix ? { fix: diag.fix } : {}) }))
}

/** Statements that belong to the COMPOSITION half — they are only legal inside `scene { … }`. */
const COMPOSITION = new Set(['group', 'layer', 'rect', 'circle', 'ellipse', 'path', 'text', 'image', 'instance', 'mask'])

const UNEXPECTED = /^unexpected statement "([a-z]+)"/

/**
 * One missing `scene { … }` produces one error per composition line — measured at 72 on a 75-line file,
 * and not one of them contains the word `scene`. Every message is accurate: at that point `group` really
 * is not expected. But they describe the SYMPTOM, and the repair pass they are fed cannot infer the cause
 * from seventy-two of them, so it returns the same program. Collapse them into the cause, once.
 *
 * Only when the block is genuinely absent — with a `scene` present, each precise position is what helps.
 */
function collapseMissingScene(diagnostics: CheckDiagnostic[], src: string): CheckDiagnostic[] {
  if (/^[ \t]*scene[ \t]*\{/m.test(src)) return diagnostics
  const stray = diagnostics.filter((d) => COMPOSITION.has(UNEXPECTED.exec(d.message)?.[1] ?? ''))
  if (!stray.length) return diagnostics
  // Once composition is loose at the root, every parse-level complaint in that scope is a knock-on of
  // the same omission — the braces the block would have owned, the lines it would have contained.
  // Semantic findings (an unknown variable, a dead global) are NOT knock-ons and are left alone.
  const knockOn = diagnostics.filter((d) => d.severity === 'error' && /^unexpected statement |^declaration expected/.test(d.message))
  const words = [...new Set(stray.map((d) => UNEXPECTED.exec(d.message)![1]))]
  const first = stray[0]
  const cause: CheckDiagnostic = {
    scope: first.scope,
    line: first.line,
    col: first.col,
    severity: 'error',
    message:
      `${words.map((w) => `\`${w}\``).join(', ')} ${words.length > 1 ? 'are SCENE declarations' : 'is a SCENE declaration'}, ` +
      `and this program has no \`scene { … }\` block. Composition lives inside it; everything after it is behavior. ` +
      `Wrap the ${stray.length} statement(s) it rejected: \`scene {\\n  layer "art" { … }\\n}\`.`,
  }
  return [cause, ...diagnostics.filter((d) => !knockOn.includes(d))]
}

/** `size W H` declared anywhere at the start of a line — the program's canvas. */
const SIZE_HEADER = /^[ \t]*size[ \t]+-?[\d.]+[ \t]+-?[\d.]+/m

/**
 * A program that never declares `size`. The line is REQUIRED by the format, yet the compiler defaults it
 * to 800x600 without a word — so a document laid out for another canvas is drawn on the wrong one and
 * everything past its edge is clipped away in silence. That silence is not theoretical: a generator
 * omitted the line across its entire corpus for months, undetected. A WARNING rather than an error,
 * because checking a fragment on its own is a legitimate thing to do.
 */
function missingSizeDiagnostic(src: string, doc: Doc): CheckDiagnostic | null {
  if (SIZE_HEADER.test(src)) return null
  return {
    scope: 'scene',
    line: 1,
    col: 1,
    severity: 'warning',
    message: `no \`size W H\` line — it is the REQUIRED first statement of a program, and this document silently defaults to ${doc.width}x${doc.height}. Anything laid out past that edge is clipped with nothing to say so. Declare the canvas you drew for.`,
  }
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
  const noSize = missingSizeDiagnostic(src, doc)
  if (noSize) push(noSize)
  for (const { scope, diag } of duplicateBindingDiagnostics(src)) push({ scope, line: diag.line, col: diag.col, severity: 'warning', message: diag.message })
  for (const { scope, diag } of lintDoc(doc, src)) push({ scope, line: diag.line, col: diag.col, severity: diag.severity === 'warning' ? 'warning' : 'error', message: diag.message, ...(diag.fix ? { fix: diag.fix } : {}) })
  // Collapse LAST: the same "unexpected statement" is reported by the source pass and by the Doc lint,
  // so folding one of them alone leaves the other's copy behind.
  return collapseMissingScene(out, src)
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
    // A `FlatSyntaxError` knows where it happened and sometimes how to repair itself; anything else still
    // lands at the top of the file rather than inventing coordinates.
    const f = e instanceof FlatSyntaxError ? e : null
    return tally([{ scope: 'scene', line: f?.line ?? 1, col: f?.col ?? 1, severity: 'error', message: `compile error: ${(e as Error).message}`, ...(f?.fix ? { fix: f.fix } : {}) }], null)
  }
  return tally(programDiagnostics(doc, src), doc)
}

/** Applies every MECHANICAL repair a diagnostic carries, and returns the new source with how many landed.
 *  Bottom-up so earlier positions stay valid, and overlapping edits are skipped rather than merged --
 *  two fixes touching one line means at least one was computed against text the other rewrote.
 *
 *  A multi-line replacement inherits the INDENTATION of the line it replaces: the parser knows the shape
 *  of the repair, not how deep the author nests. This is the one rule to know about the output.
 *
 *  Meant to run BEFORE handing a failing program back to a model: a missing comma should not cost a whole
 *  regeneration. Re-check the result -- `applyFixes` never claims the program is now valid, only that the
 *  edits it knew about were applied. */
export function applyFixes(src: string, diagnostics: CheckDiagnostic[]): { text: string; applied: number } {
  const lines = src.split('\n')
  const edits = diagnostics
    .map((d) => d.fix)
    .filter((f): f is TextEdit => !!f)
    .sort((a, b) => b.line - a.line || b.col - a.col)
  let applied = 0
  const touched = new Set<number>()
  for (const e of edits) {
    if (e.line < 1 || e.endLine > lines.length) continue
    let overlaps = false
    for (let l = e.line; l <= e.endLine; l++) if (touched.has(l)) overlaps = true
    if (overlaps) continue
    const indent = /^[ \t]*/.exec(lines[e.line - 1])![0]
    const body = e.replacement.split('\n').map((l, i) => (i === 0 ? l : indent + l)).join('\n')
    const head = lines[e.line - 1].slice(0, e.col - 1)
    const tail = lines[e.endLine - 1].slice(e.endCol - 1)
    lines.splice(e.line - 1, e.endLine - e.line + 1, ...(head + body + tail).split('\n'))
    for (let l = e.line; l <= e.endLine; l++) touched.add(l)
    applied++
  }
  return { text: lines.join('\n'), applied }
}
