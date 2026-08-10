// ─────────────────────────────────────────────────────────────────────────────
//  @flatkit/sugarflat — declarative sugar for FlatInk.
//
//  A compact block expands into INSPECTABLE `.flatink`. The expansion is the artefact of record: the
//  sugar is an authoring tool, never a runtime, and anything it writes can be written by hand instead.
//
//  WHY IT LIVES IN THIS REPO. Not to put authoring opinions into the language — it is a separate
//  package, out of the lockstep group, and `@flatkit/compiler` never depends on it. It lives here so
//  the two move together: a grammar change breaks these tests in the same CI run. That is the whole
//  argument, and it was demonstrated rather than argued — the previous out-of-tree sugar never emitted
//  the format's REQUIRED `size` line, on its entire corpus, for months, unnoticed.
//
//  THE LINE THIS PACKAGE DOES NOT CROSS: no visual opinion. A gesture emits state and behavior; it
//  never emits a coordinate, a colour or a font. The language already ships interaction opinions
//  (`drag`, `when dropped on … at pointer`, `hitbox`, `match`, `feedback`, `spring`) — what it has
//  never shipped is a look, and a sugar that shipped one would hand every activity the same face.
// ─────────────────────────────────────────────────────────────────────────────
import { DEFAULT_DOCUMENT, ensureHeader, type DocumentSpec } from './document'
import { gestures } from './gestures'

export { DEFAULT_DOCUMENT, ensureHeader, hasSizeHeader, hasTimelineHeader, type DocumentSpec } from './document'
export { ident, isIdent } from './ident'
export { gestures, sugarCard, type GestureOptions } from './gestures'
export { BLANK, GREYBOX, ROLES, type Role, type Theme } from './theme'

/**
 * What a gesture parsed out of the author's block, beside the DSL it wrote.
 *
 * A host needs this. The expansion deliberately carries no text a host can read back — the prompt is the
 * learner's instruction and the payloads are indices (`send "correct", { item = 2 }`), so without the
 * labels there is nothing to display and nothing to map an index onto. Re-parsing the block by hand to
 * recover data the package already parsed is not an integration; it is a second parser waiting to drift.
 */
export type GestureMeta = {
  keyword: string
  /** The block's name. */
  name: string
  /** The learner's instruction, verbatim. Drawn by the host or a theme — never by the gesture. */
  prompt: string
  /** Labels in payload order: `{ item = 2 }` is `items[2]`. */
  items: string[]
  /** Target labels, in the order they were declared. Empty when the gesture has none. */
  targets: string[]
}

/** What a gesture returns: the DSL, and what it understood. */
export type Expansion = { flatink: string; meta: GestureMeta }

/** A sugar block: the keyword that opens it, and how it expands. */
export type Gesture = {
  /** The opening keyword, e.g. `place`. Matched only at column 0, followed by a name and `{`. */
  keyword: string
  /** One line, for diagnostics and for the reference a model is prompted with. */
  summary: string
  /** `body` is the text between the braces; `name` the block's name. */
  expand: (name: string, body: string, doc: DocumentSpec) => Expansion
}

export type DesugarOptions = {
  /** The canvas + timeline the expansion targets. */
  document?: DocumentSpec
  /** Gestures to recognise. Defaults to the registered set. */
  gestures?: Gesture[]
}

export type DesugarResult = {
  /** The expanded (or passed-through) FlatInk. */
  flatink: string
  /** Which gesture matched — `raw` for an escape-only source, `null` for plain FlatInk. */
  kind: string | null
  expanded: boolean
  /** What the gesture understood: the prompt and the labels behind the payload indices. `null` when
   *  nothing was expanded, since there is no block to have understood anything from. */
  meta: GestureMeta | null
}

/** Raised when a source opens a block that looks like sugar but no gesture claims it. */
export class UnknownSugarError extends Error {
  constructor(readonly keyword: string, known: string[]) {
    super(
      `unknown sugar block "${keyword}" — no gesture claims it, so nothing was expanded. ` +
      `Known blocks: ${known.length ? known.join(', ') : '(none registered)'}. ` +
      `If this is meant to be plain FlatInk, it is not: "${keyword}" is not a FlatInk statement either.`,
    )
    this.name = 'UnknownSugarError'
  }
}

/** The gestures this package ships, drawn by the default theme. Each entry is a public promise. */
export const GESTURES: Gesture[] = gestures()

/** A block opens at column 0: `<keyword> <name> {`. The name may be quoted (so it can hold spaces). */
const BLOCK_OPEN = /^([a-zA-Z][\w-]*)[ \t]+(?:"([^"]+)"|([^\s{"]+))[ \t]*\{/m

/**
 * The escape hatch, in three forms. A sugar that cannot be opted out of stops being scaffolding and
 * becomes a cage: the previous generation of this idea flattened every activity into the same shape
 * until the template was pulled apart. Anything a gesture writes must remain writable by hand, beside it.
 *
 *   raw { … }              verbatim at TOP LEVEL — header (`asset`, `var`, `fn`) and `object` blocks
 *   raw scene { … }        verbatim inside the generated scene, ON TOP of it — banners, overlays
 *   raw scene under { … }  verbatim inside the generated scene, UNDERNEATH it — backgrounds
 *
 * `under` is not a nicety. A gesture emits no appearance by design, so a background is the FIRST thing
 * any skin needs — and spliced on top, an opaque full-canvas rect hides the entire activity while
 * `checkProgram` reports a clean program. Ten activities shipped that way, read as broken assets.
 */
const RAW_OPEN = /^raw(?:[ \t]+scene(?:[ \t]+(under))?)?[ \t]*\{/gm

type RawParts = { top: string[]; over: string[]; under: string[]; rest: string }

/**
 * Pull every `raw …` block out of `text`. Brace-counted rather than line-anchored, so the one-line form
 * works — the README and `sugarCard()` both write `raw { … }` on one line, and a regex demanding a
 * newline after `{` left the keyword to travel on to the compiler, which reported `unexpected statement
 * "raw"`: a sugar defect described in FlatInk's vocabulary, the very thing `UnknownSugarError` fixed.
 */
function takeRaw(text: string): RawParts {
  const out: RawParts = { top: [], over: [], under: [], rest: '' }
  let cursor = 0
  RAW_OPEN.lastIndex = 0
  for (let m = RAW_OPEN.exec(text); m; m = RAW_OPEN.exec(text)) {
    const openBrace = m.index + m[0].length - 1
    const end = blockEnd(text, openBrace)
    if (end < 0) break // unbalanced: leave it alone, the compiler will say so
    const body = text.slice(openBrace + 1, end).replace(/^\r?\n/, '').replace(/\r?\n[ \t]*$/, '')
    const bucket = m[0].includes('scene') ? (m[1] ? out.under : out.over) : out.top
    bucket.push(body)
    out.rest += text.slice(cursor, m.index)
    cursor = end + 1
    RAW_OPEN.lastIndex = cursor
  }
  out.rest += text.slice(cursor)
  return out
}

/** Index of the `}` closing the brace at `openBrace`, or -1 if unbalanced. */
function blockEnd(text: string, openBrace: number): number {
  let depth = 1
  for (let i = openBrace + 1; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return i
  }
  return -1
}

const RAW_NOTE = '// -- raw (escape hatch: verbatim FlatInk) --'

/** Splice verbatim bodies into the generated `scene`: `under` first (drawn behind), `over` last. */
function spliceIntoScene(flatink: string, under: string[], over: string[]): string {
  if (!under.length && !over.length) return flatink
  const at = flatink.search(/^scene[ \t]*\{/m)
  if (at < 0) throw new Error('`raw scene { … }` has nowhere to go: this expansion emits no `scene` block — use a plain `raw { … }` instead.')
  const openBrace = flatink.indexOf('{', at)
  const close = blockEnd(flatink, openBrace)
  const head = under.length ? `\n  // -- raw scene under (verbatim, drawn BEHIND the gesture) --\n${under.join('\n')}` : ''
  const tail = over.length ? `  // -- raw scene (verbatim, drawn ON TOP of the gesture) --\n${over.join('\n')}\n` : ''
  return `${flatink.slice(0, openBrace + 1)}${head}${flatink.slice(openBrace + 1, close)}${tail}${flatink.slice(close)}`
}

/** Raised when a source holds more than one gesture block. */
export class MultipleGesturesError extends Error {
  constructor(first: string, second: string) {
    super(
      `two gesture blocks in one source ("${first}" and "${second}") — a document holds ONE. Each gesture ` +
      'emits its own `scene`, and a program may only have one, so the second cannot be merged in. ' +
      'Split them into two documents, or write the extra part by hand in `raw { … }` / `raw scene { … }`.',
    )
    this.name = 'MultipleGesturesError'
  }
}

/**
 * Expand a sugar source into `.flatink`.
 *
 * Plain FlatInk passes through untouched. A source whose first block matches no gesture RAISES rather
 * than passing through: a silent fall-through sent the author's block downstream as if it were FlatInk,
 * to fail a hundred lines later on messages that only talk about FlatInk.
 *
 * ```ts
 * import { desugar } from '@flatkit/sugarflat'
 * import { checkProgram } from '@flatkit/compiler'
 *
 * const { flatink } = desugar(srcFromAnLLM)
 * const { ok, report } = checkProgram(flatink)   // the expansion is the artefact of record
 * ```
 */
export function desugar(src: string, opts: DesugarOptions = {}): DesugarResult {
  const doc = opts.document ?? DEFAULT_DOCUMENT
  const gestures = opts.gestures ?? GESTURES

  const open = BLOCK_OPEN.exec(src)
  const keyword = open?.[1]
  const gesture = keyword ? gestures.find((g) => g.keyword === keyword) : undefined

  if (gesture) {
    const name = open?.[2] ?? open?.[3] ?? gesture.keyword
    const braceAt = open!.index + open![0].length - 1
    const body = blockBody(src, braceAt)
    // Everything OUTSIDE the block travels with the expansion. Dropping it made the escape hatch — the
    // one guard-rail this package rests on — a no-op beside a gesture: an author wrote decor, the
    // expansion compiled, `checkProgram` said ok, and nothing was there.
    const before = src.slice(0, open!.index)
    const after = src.slice(braceAt + 1 + body.length + 1)
    const other = findGesture(before + '\n' + after, gestures)
    if (other) throw new MultipleGesturesError(gesture.keyword, other)

    const { flatink, meta } = gesture.expand(name, body, doc)
    const head = takeRaw(before)
    const tail = takeRaw(after)
    const expanded = spliceIntoScene(flatink, [...head.under, ...tail.under], [...head.over, ...tail.over])
    const topLevel = (p: RawParts) => [p.rest.trim(), ...(p.top.length ? [RAW_NOTE, ...p.top] : [])].filter(Boolean).join('\n')
    const whole = [topLevel(head), expanded, topLevel(tail)].filter(Boolean).join('\n\n')
    return { flatink: ensureHeader(whole, doc), kind: gesture.keyword, expanded: true, meta }
  }
  // A keyword that opens a block at column 0 and is NOT a FlatInk statement is a sugar block we do not
  // know — never a program. Say so here, with the list, rather than downstream in another vocabulary.
  // `raw` is this package's own keyword, handled below.
  if (keyword && keyword !== 'raw' && !FLATINK_BLOCKS.has(keyword)) throw new UnknownSugarError(keyword, gestures.map((g) => g.keyword))

  // No gesture: plain FlatInk, plus any `raw { … }` the author used on its own. `raw scene` has no
  // generated scene to splice into here, so it would silently vanish — say so instead.
  const parts = takeRaw(src)
  if (parts.over.length || parts.under.length) {
    throw new Error('`raw scene { … }` needs a gesture block to splice into — this source has none. Write a plain `scene { … }` yourself.')
  }
  const out = [parts.rest.trim(), ...(parts.top.length ? [RAW_NOTE, ...parts.top] : [])].filter(Boolean).join('\n')
  return { flatink: parts.top.length ? out : src, kind: parts.top.length ? 'raw' : null, expanded: parts.top.length > 0, meta: null }
}

/** Block keywords that belong to FlatINK itself — a source opening with one of these is a program. */
const FLATINK_BLOCKS = new Set(['scene', 'object', 'symbol', 'layer', 'group', 'match', 'each', 'states', 'params', 'when', 'every', 'repeat', 'fn', 'at'])

/** The keyword of the first gesture block in `text`, if any — used to refuse a second one loudly. */
function findGesture(text: string, gestures: Gesture[]): string | null {
  const re = new RegExp(BLOCK_OPEN.source, 'gm')
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (gestures.some((g) => g.keyword === m![1])) return m[1]
  }
  return null
}

/** Text between the braces opened at `openIndex`, brace-counting so nested blocks survive. */
function blockBody(src: string, openIndex: number): string {
  let depth = 1
  let i = openIndex + 1
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') depth--
  }
  return src.slice(openIndex + 1, depth === 0 ? i - 1 : src.length)
}
