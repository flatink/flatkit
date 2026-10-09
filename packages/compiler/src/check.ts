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
import type { Action, Doc, Layer } from '@flatkit/types'
import { canWait, MAX_TASKS } from '@flatkit/engine/actions'
import { isGroup, isText } from '@flatkit/engine/layers'
import { forEachAction } from './docWalk'
import { declarationLines, lineIndex } from './sourceLines'
import type { TextEdit } from '@flatkit/engine/dsl'
import { FlatSyntaxError, parseFlatLib, behaviorDiagnostics, duplicateBindingDiagnostics, objectTargetDiagnostics, sceneOnlyUnitDiagnostics, itemOnlyUnitDiagnostics } from '@flatkit/engine/flatFormat'
import { compileFlatpack, type MediaMap } from './compile'
import { lintDoc } from './programDoc'

/** One diagnostic, positioned in the AUTHOR'S source. `scope` is `scene` or `object "Name"`. `fix` is
 *  present only when the repair is MECHANICAL -- see `TextEdit`. */
export type CheckDiagnostic = { scope: string; line: number; col: number; severity: 'error' | 'warning'; message: string; fix?: TextEdit }

export type CheckOptions = {
  /** Text of each `.flat` symbol library the program draws on — the CLI auto-discovers them beside the file. */
  assetSrcs?: string[]
  /** A name for each of them, in the same order (a file name, say) — what a warning about two libraries
   *  calls them. Without it they are numbered: `library 1`, `library 2`. */
  assetNames?: string[]
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
    .map(({ scope, diag }) => ({ scope, line: diag.line, col: diag.col, severity: diag.severity === 'warning' ? 'warning' as const : 'error' as const, message: diag.message, ...(diag.fix ? { fix: diag.fix } : {}) }))
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

/** 1-based line of the first match of `re` in `src`, or 1. */
const lineOf = (src: string, re: RegExp): number => { const m = re.exec(src); return m ? lineIndex(src)(m.index) : 1 }
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Behavior that compiles and can never happen (flatink/flatink#67): an `at frame` the playhead never
 * enters (between two whole frames, or past the last one), a `sound` of an asset nobody declared, a
 * `text("…")` naming no text (it sent `""`).
 */
function unreachableBehaviorDiagnostics(doc: Doc, src: string): CheckDiagnostic[] {
  const out: CheckDiagnostic[] = []
  for (const t of [doc.timeline, ...doc.symbols.map((s) => s.timeline)]) {
    if (!t) continue
    const last = Math.ceil(t.durationFrames) - 1
    for (const fa of t.frameActions ?? []) {
      const why = !Number.isInteger(fa.frame) ? 'the playhead only enters WHOLE frames' : fa.frame > last ? `the last frame is ${last} (frames count from 0 on a ${t.durationFrames}-frame timeline)` : ''
      if (why) out.push({ scope: 'scene', line: lineOf(src, new RegExp(`^[ \\t]*at[ \\t]+frame[ \\t]+${escapeRe(String(fa.frame))}\\b`, 'm')), col: 1, severity: 'warning', message: `\`at frame ${fa.frame}\` never runs: ${why}` })
    }
  }
  const assets = new Set((doc.assets ?? []).map((a) => a.id))
  const texts = new Set<string>()
  const walk = (layers: Layer[]) => { for (const l of layers) for (const it of l.items) { if (isText(it)) { texts.add(it.id); texts.add(it.name) } if (isGroup(it)) walk(it.layers) } }
  walk(doc.layers)
  for (const sym of doc.symbols) walk(sym.layers)
  const seen = new Set<string>()
  forEachAction(doc, (a) => {
    if (a.do === 'sound' && !assets.has(a.assetId) && !seen.has(`s${a.assetId}`)) {
      seen.add(`s${a.assetId}`)
      out.push({ scope: 'scene', line: lineOf(src, new RegExp(`\\bsound[ \\t]+"${escapeRe(a.assetId)}"`)), col: 1, severity: 'error', message: `sound "${a.assetId}": no asset "${a.assetId}" is declared — it plays nothing. Declare it: \`asset "${a.assetId}" "<file>.mp3" sound\`` })
    }
    if (a.do === 'send' && a.payload?.kind === 'text' && !texts.has(a.payload.itemId) && !seen.has(`t${a.payload.itemId}`)) {
      const id = a.payload.itemId
      seen.add(`t${id}`)
      out.push({ scope: 'scene', line: lineOf(src, new RegExp(`\\btext\\(\\s*"${escapeRe(id)}"`)), col: 1, severity: 'error', message: `text("${id}"): no text "${id}" (id or name) in the scene or its symbols — it would send "". Name the text: \`text "…" at x,y as "${id}"\`` })
    }
  })
  return out
}

/**
 * Where a Doc-level warning's SUBJECT is written. Those passes reason on the Doc, which has no positions, so
 * they said `1:1` (flatink/flatink#68, from #64): the message names its subject, and the subject has one
 * spelling in the source. Unrecognised, or not found: undefined, and the warning keeps `1:1`.
 */
function locateDocWarning(message: string, src: string): number | undefined {
  const e = escapeRe
  // A declaration is looked up in an index built ONCE for the source: one regex scan per warning made ten
  // thousand unused variables cost seconds.
  const byDecl: [RegExp, 'vars' | 'fns'][] = [
    [/^global variable "([^"]+)" never used/, 'vars'],
    [/^variable "([^"]+)" is hidden by/, 'vars'],
    [/^[\w.]+\(\) is hidden by the variable "([^"]+)"/, 'vars'],
    [/^fn ([\w.]+) is hidden/, 'fns'],
    [/^parameter "[^"]+" of fn ([\w.]+)/, 'fns'],
  ]
  for (const [re, kind] of byDecl) {
    const m = re.exec(message)
    if (m) return declarationLines(src)[kind].get(m[1]!)
  }
  const rules: [RegExp, (m: RegExpExecArray) => RegExp][] = [
    [/^"([^"]+)" is stretched along one axis/, (m) => new RegExp(`\\b(?:group|as)[ \\t]+"${e(m[1]!)}"`)],
    [/^path data starting "([^"]+)" is only partly readable/, (m) => new RegExp(`\\bpath[ \\t]+"\\s*[Mm]\\s*${(m[1]!.match(/-?[\d.]+/g) ?? []).map(e).join('[\\s,A-Za-z]+')}(?![\\d.])`)],
    [/^path starting "([^"]+)": two of its contours/, (m) => new RegExp(`\\bpath[ \\t]+"\\s*[Mm]\\s*${(m[1]!.match(/-?[\d.]+/g) ?? []).map(e).join('[\\s,A-Za-z]+')}(?![\\d.])`)],
    [/^each "([^"]+)":/, (m) => new RegExp(`\\beach[ \\t]+"${e(m[1]!)}"`)],
    [/^unknown drop zone "([^"]+)"/, (m) => new RegExp(`when[ \\t]+dropped[ \\t]+on[ \\t]+"?${e(m[1]!)}\\b`)],
    [/^instance "([^"]+)":/, (m) => new RegExp(`\\binstance[ \\t]+"[^"]*"[ \\t]+as[ \\t]+"${e(m[1]!)}"|\\binstance[ \\t]+"${e(m[1]!)}"(?![ \\t]+as\\b)`)],
    [/^([A-Za-z_]\w*)\.([A-Za-z_]\w*) = …:/, (m) => new RegExp(`\\b${e(m[1]!)}\\.${e(m[2]!)}[ \\t]*=(?!=)`)],
    [/^no instance named "[^"]+" in the scene — `([A-Za-z_]\w*)\.([A-Za-z_]\w*) = …`/, (m) => new RegExp(`\\b${e(m[1]!)}\\.${e(m[2]!)}[ \\t]*=(?!=)`)],
    [/^polyline: "([^"]+)"/, (m) => new RegExp(`\\bpolyline\\b[^\\n]*\\b${e(m[1]!)}\\b`)],
    [/^(spring|smooth) (\w+):/, (m) => new RegExp(`\\b${m[1]}[ \\t]+${e(m[2]!)}\\b`)],
    [/^"([^"]+)" is captured on `time`/, (m) => new RegExp(`\\b${e(m[1]!)}[ \\t]*=[ \\t]*time\\b`)],
  ]
  for (const [re, where] of rules) {
    const m = re.exec(message)
    if (!m) continue
    const at = where(m).exec(src)
    return at ? lineIndex(src)(at.index) : undefined
  }
  return undefined
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
  for (const { scope, diag } of duplicateBindingDiagnostics(src)) push({ scope, line: diag.line, col: diag.col, severity: diag.severity === 'error' ? 'error' : 'warning', message: diag.message })
  for (const d of unreachableBehaviorDiagnostics(doc, src)) push(d)
  for (const d of loopedWaitDiagnostics(doc, src)) push(d)
  const waiting = waitingHandlers(doc)
  if (waiting > MAX_TASKS) push({ scope: 'scene', line: 1, col: 1, severity: 'warning', message: `${waiting} handlers hold a \`wait\`: the player keeps at most ${MAX_TASKS} of them waiting at once — past that the one that has waited longest is dropped, and its end never runs` })
  for (const { scope, diag } of lintDoc(doc, src)) push({ scope, ...(diag.line === 1 && diag.col === 1 ? { line: locateDocWarning(diag.message, src) ?? 1 } : { line: diag.line }), col: diag.col, severity: diag.severity === 'warning' ? 'warning' : 'error', message: diag.message, ...(diag.fix ? { fix: diag.fix } : {}) })
  // Collapse LAST: the same "unexpected statement" is reported by the source pass and by the Doc lint,
  // so folding one of them alone leaves the other's copy behind.
  return collapseMissingScene(out, src)
}

/**
 * Two LIBRARIES that declare one symbol name: the last one read is the one instanced, and the other is
 * shadowed without a word. `flatc` reads every `.flat` of the program's folder, so which one is "last" is a
 * matter of file names. A warning, not an error: the pack is well-formed, and a folder may hold a variant on
 * purpose. Silent when the program declares the name itself — its own symbol is the one instanced, and that
 * override is the documented one. `doc` is the compiled program (its own symbols come after the libraries').
 */
export function libraryNameDiagnostics(libs: { name: string; symbols: string[] }[], doc?: Doc, src = ''): CheckDiagnostic[] {
  if (libs.length < 2) return []
  const own = new Set(doc ? doc.symbols.slice(libs.reduce((n, l) => n + l.symbols.length, 0)).map((s) => s.name) : [])
  const declaredBy = new Map<string, string[]>()
  for (const lib of libs) for (const name of new Set(lib.symbols)) declaredBy.set(name, [...(declaredBy.get(name) ?? []), lib.name])
  const out: CheckDiagnostic[] = []
  for (const [name, by] of declaredBy) {
    if (by.length < 2 || own.has(name)) continue
    const at = src ? new RegExp(`\\binstance[ \\t]+"${escapeRe(name)}"`).exec(src) : null
    out.push({ scope: doc ? 'scene' : 'libraries', line: at ? lineIndex(src)(at.index) : 1, col: 1, severity: 'warning',
      message: `symbol "${name}" is declared by ${by.slice(0, -1).join(', ')} and ${by.at(-1)} — ${by.at(-1)} is the one instanced (the last one read), the other is never drawn. Rename one of the two, or keep a single library for that name` })
  }
  return out
}

/**
 * An `at frame <n>` script that waits longer than a lap of the timeline: the playhead is back on frame n
 * before it is through, and a handler triggered again while it waits STARTS OVER — so what follows the wait
 * never runs, and nothing says so. Only what is certain is reported: the literal durations, and a scene that
 * never holds nor moves its playhead (a `pause` or a `go to` anywhere, and the lap is no longer the period).
 */
function loopedWaitDiagnostics(doc: Doc, src: string): CheckDiagnostic[] {
  const tl = doc.timeline
  const scripts = (tl?.frameActions ?? []).filter((fa) => canWait(fa.actions))
  if (!tl || !scripts.length || !(tl.fps > 0)) return []
  let steered = false
  forEachAction(doc, (a) => { if (a.do === 'pause' || a.do === 'gotoFrame' || a.do === 'gotoLabel') steered = true })
  if (steered) return []
  const lap = tl.durationFrames / tl.fps
  const out: CheckDiagnostic[] = []
  for (const fa of scripts) {
    let waited = 0
    for (const a of fa.actions) if (a.do === 'wait' && /^\s*\d*\.?\d+\s*$/.test(a.seconds)) waited += Number(a.seconds)
    if (!(waited > lap)) continue
    out.push({ scope: 'scene', line: lineOf(src, new RegExp(`\\bat[ \\t]+frame[ \\t]+${fa.frame}\\b`)), col: 1, severity: 'warning',
      message: `at frame ${fa.frame}: it waits ${+waited.toFixed(2)} s, the timeline loops every ${+lap.toFixed(2)} s — the playhead is back on frame ${fa.frame} before the script is through, and a handler triggered again while it waits starts over: what follows the \`wait\` never runs. Hold the playhead (\`pause\`), lengthen the timeline, or start the sequence from \`when loaded\`` })
  }
  return out
}

/** How many handlers of the Doc may wait: object events, `when loaded` and `at frame` scripts. */
function waitingHandlers(doc: Doc): number {
  const lists: Action[][] = (doc.interactions ?? []).map((i) => i.actions)
  for (const t of [doc.timeline, ...doc.symbols.map((s) => s.timeline)]) {
    if (t?.onLoad) lists.push(t.onLoad)
    for (const fa of t?.frameActions ?? []) lists.push(fa.actions)
  }
  return lists.filter(canWait).length
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
  // One library cannot clash with another: it is not read a second time just to learn its names.
  const libs = (opts.assetSrcs?.length ?? 0) < 2 ? [] : opts.assetSrcs!.map((lib, i) => ({ name: opts.assetNames?.[i] ?? `library ${i + 1}`, symbols: librarySymbolNames(lib) }))
  return tally([...libraryNameDiagnostics(libs, doc, src), ...programDiagnostics(doc, src)], doc)
}

/** The symbol names a library declares (it has compiled already; a library that does not parse names none). */
function librarySymbolNames(lib: string): string[] {
  try { return parseFlatLib(lib).symbols.map((s) => s.name) } catch { return [] }
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
    // A position this text cannot honour is SKIPPED, never applied blind. The diagnostics may have been
    // stored, replayed against a file that moved on, or built by a consumer -- and a non-positive column
    // reaches `slice` as an offset FROM THE END, which silently truncates the line instead of failing.
    if (!Number.isInteger(e.line) || !Number.isInteger(e.endLine) || !Number.isInteger(e.col) || !Number.isInteger(e.endCol)) continue
    if (e.line < 1 || e.col < 1 || e.endCol < 1 || e.endLine > lines.length) continue
    if (e.endLine < e.line || (e.endLine === e.line && e.endCol < e.col)) continue
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

/** Applies the mechanical repairs until nothing is left to apply, and returns the FINAL text. Pure: it
 *  takes a `recheck` and never touches the filesystem, which is the whole guarantee -- the caller writes
 *  once, at the end, a text this loop has already re-checked. Writing each pass and reverting on failure
 *  would leave a window where the author's file holds a version we already know we do not want.
 *
 *  It ITERATES because repairing one error unmasks the next (a run-on interactor line swallows the
 *  statements under it), and it accepts a pass only if the error count strictly DROPS -- except that the
 *  count legitimately RISES on the first pass of a source that did not parse at all, where a single error
 *  was all that was visible. That case never reaches here: it is handled before the Doc exists. */
export function repairLoop(
  src: string,
  diagnostics: CheckDiagnostic[],
  recheck: (candidate: string) => CheckDiagnostic[],
  maxPasses = 5,
): { text: string; applied: number; first: number; errors: number } {
  const errs = (ds: CheckDiagnostic[]) => ds.filter((d) => d.severity === 'error').length
  const first = errs(diagnostics)
  let text = src, applied = 0, errors = first, current = diagnostics
  for (let pass = 0; pass < maxPasses; pass++) {
    const step = applyFixes(text, current)
    if (!step.applied) break
    let after: CheckDiagnostic[]
    try { after = recheck(step.text) } catch { break } // the repair broke the parse outright -> keep the last accepted text
    if (errs(after) >= errors) break
    text = step.text; applied += step.applied; errors = errs(after); current = after
  }
  return { text, applied, first, errors }
}
