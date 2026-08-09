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

/** `raw { … }` (both braces at column 0) passes through VERBATIM — the escape hatch, kept deliberately.
 *  A sugar that cannot be opted out of stops being scaffolding and becomes a cage: the previous
 *  generation of this idea flattened every activity into the same shape until the template was pulled
 *  apart. Anything a gesture writes must remain writable by hand, beside it. */
const RAW_BLOCK = /^raw[ \t]*\{\r?\n([\s\S]*?)\r?\n\}/gm

/** `raw scene { … }` — verbatim INSIDE the expansion's `scene`. A gesture emits no appearance by
 *  design, so this is the only route decor has: a second top-level `scene` block is a compile error,
 *  and without this the escape hatch cannot reach the one place a background has to sit. */
const RAW_SCENE = /^raw[ \t]+scene[ \t]*\{\r?\n([\s\S]*?)\r?\n\}/gm

const unwrapRaw = (src: string): string =>
  src.replace(RAW_BLOCK, (_m, body: string) => `// -- raw (escape hatch: verbatim FlatInk) --\n${body}`)

/** Pull every `raw scene { … }` body out of `text`, returning them and the text without them. */
function takeRawScene(text: string): { scene: string[]; rest: string } {
  const scene: string[] = []
  const rest = text.replace(RAW_SCENE, (_m, body: string) => { scene.push(body); return '' })
  return { scene, rest }
}

/** Insert lines just before the closing brace of the expansion's `scene { … }`. */
function spliceIntoScene(flatink: string, body: string[]): string {
  if (!body.length) return flatink
  const at = flatink.search(/^scene[ \t]*\{/m)
  if (at < 0) throw new Error('`raw scene { … }` has nowhere to go: this expansion emits no `scene` block — use a plain `raw { … }` instead.')
  const openBrace = flatink.indexOf('{', at)
  let depth = 1
  let i = openBrace + 1
  for (; i < flatink.length && depth > 0; i++) {
    if (flatink[i] === '{') depth++
    else if (flatink[i] === '}') depth--
  }
  const close = i - 1
  return `${flatink.slice(0, close)}  // -- raw scene (escape hatch: verbatim, inside the generated scene) --\n${body.join('\n')}\n${flatink.slice(close)}`
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
    const head = takeRawScene(before)
    const tail = takeRawScene(after)
    const expanded = spliceIntoScene(unwrapRaw(flatink), [...head.scene, ...tail.scene])
    const whole = [unwrapRaw(head.rest).trim(), expanded, unwrapRaw(tail.rest).trim()].filter(Boolean).join('\n\n')
    return { flatink: ensureHeader(whole, doc), kind: gesture.keyword, expanded: true, meta }
  }
  // A keyword that opens a block at column 0 and is NOT a FlatInk statement is a sugar block we do not
  // know — never a program. Say so here, with the list, rather than downstream in another vocabulary.
  if (keyword && !FLATINK_BLOCKS.has(keyword)) throw new UnknownSugarError(keyword, gestures.map((g) => g.keyword))

  const out = unwrapRaw(src)
  return { flatink: out, kind: out === src ? null : 'raw', expanded: out !== src, meta: null }
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
