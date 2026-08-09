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
export { gestures, type GestureOptions } from './gestures'
export { BLANK, GREYBOX, type Role, type Theme } from './theme'

/** A sugar block: the keyword that opens it, and how it expands. */
export type Gesture = {
  /** The opening keyword, e.g. `tri`. Matched only at column 0, followed by a name and `{`. */
  keyword: string
  /** One line, for diagnostics and for the reference a model is prompted with. */
  summary: string
  /** `body` is the text between the braces; `name` the block's name. Returns `.flatink`. */
  expand: (name: string, body: string, doc: DocumentSpec) => string
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

const unwrapRaw = (src: string): string =>
  src.replace(RAW_BLOCK, (_m, body: string) => `// -- raw (escape hatch: verbatim FlatInk) --\n${body}`)

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
    const body = blockBody(src, open!.index + open![0].length - 1)
    return { flatink: ensureHeader(unwrapRaw(gesture.expand(name, body, doc)), doc), kind: gesture.keyword, expanded: true }
  }
  // A keyword that opens a block at column 0 and is NOT a FlatInk statement is a sugar block we do not
  // know — never a program. Say so here, with the list, rather than downstream in another vocabulary.
  if (keyword && !FLATINK_BLOCKS.has(keyword)) throw new UnknownSugarError(keyword, gestures.map((g) => g.keyword))

  const out = unwrapRaw(src)
  return { flatink: out, kind: out === src ? null : 'raw', expanded: out !== src }
}

/** Block keywords that belong to FlatINK itself — a source opening with one of these is a program. */
const FLATINK_BLOCKS = new Set(['scene', 'object', 'symbol', 'layer', 'group', 'match', 'each', 'states', 'params', 'when', 'every', 'repeat', 'fn', 'at'])

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
