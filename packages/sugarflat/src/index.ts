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
import { ident } from './ident'

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
  /** The block's name — also the prefix on every name it emits. */
  name: string
  /** The learner's instruction, verbatim. Drawn by the host or a theme — never by the gesture. */
  prompt: string
  /** Labels in payload order: `{ block = b, item = 2 }` is `blocks[b].items[2]`. */
  items: string[]
  /** Target labels, in the order they were declared. Empty when the gesture has none. */
  targets: string[]
  /** Every object id it emitted, prefixed — what a skin binds to, without having to guess the scheme. */
  objects: string[]
  /** The variable that turns 1 when this block is finished. */
  doneVar: string
}

/** Where a block sits in the document. Names are prefixed so two blocks never collide. */
export type GestureContext = {
  /** 0-based position, and the `block` field of every payload it sends. */
  index: number
  /** `<name>_` — put it in front of every var and every object id. */
  prefix: string
  /** The variable to set to 1 when the block is done; the document watches it. */
  doneVar: string
}

/** What a gesture returns: PARTS, never a finished program — a document has exactly one `scene`. */
export type Expansion = {
  /** `var` declarations. They go in the header, where `var` is legal. */
  vars: string[]
  /** Layer statements, indented for the inside of `scene { … }`. */
  layers: string[]
  /** `object` blocks and scene-wide handlers. */
  behavior: string[]
  meta: GestureMeta
}

/** A sugar block: the keyword that opens it, and how it expands. */
export type Gesture = {
  /** The opening keyword, e.g. `place`. Matched only at column 0, followed by a name and `{`. */
  keyword: string
  /** One line, for diagnostics and for the reference a model is prompted with. */
  summary: string
  /** `body` is the text between the braces; `name` the block's name. */
  expand: (name: string, body: string, doc: DocumentSpec, ctx: GestureContext) => Expansion
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
  /** What each block understood, in document order: `{ block = 2 }` refers to `meta[2]`. Empty when
   *  nothing was expanded, since there is no block to have understood anything from. */
  meta: GestureMeta[]
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
    const raw = text.slice(openBrace + 1, end)
    // One-line form (`raw { var x = 1 }`) keeps the spaces that hugged the braces; the multi-line form
    // keeps its own indentation, which is the author's.
    const body = raw.includes('\n') ? raw.replace(/^\r?\n/, '').replace(/\r?\n[ \t]*$/, '') : raw.trim()
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

/** Raised when two blocks share a name — every name they emit would collide. */
export class DuplicateBlockError extends Error {
  constructor(name: string) {
    super(`two blocks are both named "${name}" — the name prefixes every variable and object a block emits, so they would overwrite each other. Give each block its own name.`)
    this.name = 'DuplicateBlockError'
  }
}

/** One gesture block found in the source, with its span so the text around it can be recovered. */
type Found = { gesture: Gesture; name: string; body: string; start: number; end: number }

/** Every gesture block in `src`, in document order. */
function findBlocks(src: string, gestures: Gesture[]): Found[] {
  const re = new RegExp(BLOCK_OPEN.source, 'gm')
  const found: Found[] = []
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const gesture = gestures.find((g) => g.keyword === m![1])
    if (!gesture) {
      // A keyword that opens a block at column 0 and is neither sugar nor FlatInk is a block we do not
      // know — say so with the list, rather than downstream in another vocabulary.
      if (m[1] !== 'raw' && !FLATINK_BLOCKS.has(m[1])) throw new UnknownSugarError(m[1], gestures.map((g) => g.keyword))
      continue
    }
    const braceAt = m.index + m[0].length - 1
    const close = blockEnd(src, braceAt)
    if (close < 0) break
    found.push({ gesture, name: m[2] ?? m[3] ?? gesture.keyword, body: src.slice(braceAt + 1, close), start: m.index, end: close + 1 })
    re.lastIndex = close + 1
  }
  return found
}

/**
 * Assemble the blocks into ONE program.
 *
 * A document has exactly one `scene`, one header and one behavior half, so composing gestures is not a
 * matter of concatenating their output — it is a matter of never producing whole programs in the first
 * place. Each block contributes parts; this puts them in the three places the format has.
 *
 * Two things the assembly decides, and they are the reason "several blocks" is a design and not a loop:
 *
 *   • **Names are prefixed by the block's name, always** — including when a document holds one block.
 *     Prefixing only on collision would mean the same source compiles to different names depending on
 *     whether a sibling exists, so a skin written against one block would break the day a second arrived.
 *     Every id is in `meta[].objects`, so nothing has to be guessed.
 *   • **`completed` belongs to the DOCUMENT.** Each block emits `part` with its own index when its
 *     portion is finished; `completed` fires once, when every block is done. With a single block the two
 *     coincide, which is what `completed` always meant.
 */
function assemble(blocks: { expansion: Expansion }[], under: string[], over: string[], doc: DocumentSpec): string {
  const out: string[] = [`size ${doc.width} ${doc.height}`, `timeline ${doc.fps} ${doc.durationFrames}`]
  const done = blocks.map((b) => b.expansion.meta.doneVar)
  if (done.length) out.push('var allDone = 0')
  for (const b of blocks) out.push(...b.expansion.vars)

  out.push('', 'scene {')
  if (under.length) out.push('  // -- raw scene under (verbatim, drawn BEHIND every block) --', ...under)
  for (const b of blocks) out.push(...b.expansion.layers)
  if (over.length) out.push('  // -- raw scene (verbatim, drawn ON TOP of every block) --', ...over)
  out.push('}', '')

  for (const b of blocks) out.push(...b.expansion.behavior)
  // `completed` = the whole document. One block: it fires the moment that block does, which is what it
  // has always meant. Several: only once all of them have. The `allDone` guard matters -- an unguarded
  // `send` inside `every frame` would emit it again on every frame for the rest of the session.
  if (done.length) {
    out.push('every frame {', '  if allDone < 0.5 {', `    if ${done.join(' + ')} >= ${done.length} {`, '      allDone = 1', '      send "completed"', '    }', '  }', '}')
  }
  return out.join('\n')
}

/** Block keywords that belong to FlatINK itself — a source opening with one of these is a program. */
const FLATINK_BLOCKS = new Set(['scene', 'object', 'symbol', 'layer', 'group', 'match', 'each', 'states', 'params', 'when', 'every', 'repeat', 'fn', 'at'])

/**
 * Expand a sugar source into `.flatink`.
 *
 * Plain FlatInk passes through untouched. A block nobody claims RAISES rather than passing through: a
 * silent fall-through sent the author's block downstream as if it were FlatInk, to fail a hundred lines
 * later on messages that only talk about FlatInk.
 *
 * A document may hold SEVERAL blocks. They are laid out in the order they are written, each keeps its own
 * state under its own name, and each emits `part` when its portion is finished; `completed` fires once,
 * when every block is done.
 *
 * ```ts
 * import { desugar } from '@flatkit/sugarflat'
 * import { checkProgram } from '@flatkit/compiler'
 *
 * const { flatink, meta } = desugar(srcFromAnLLM)
 * const { ok, report } = checkProgram(flatink)   // the expansion is the artefact of record
 * ```
 */
export function desugar(src: string, opts: DesugarOptions = {}): DesugarResult {
  const doc = opts.document ?? DEFAULT_DOCUMENT
  const gestures = opts.gestures ?? GESTURES

  const found = findBlocks(src, gestures)
  if (!found.length) {
    // Plain FlatInk, plus any `raw { … }` used on its own. `raw scene` has no generated scene to splice
    // into here, so it would silently vanish -- say so instead.
    const parts = takeRaw(src)
    if (parts.over.length || parts.under.length) {
      throw new Error('`raw scene { … }` needs a gesture block to splice into — this source has none. Write a plain `scene { … }` yourself.')
    }
    const out = [parts.rest.trim(), ...(parts.top.length ? [RAW_NOTE, ...parts.top] : [])].filter(Boolean).join('\n')
    return { flatink: parts.top.length ? out : src, kind: parts.top.length ? 'raw' : null, expanded: parts.top.length > 0, meta: [] }
  }

  const seen = new Set<string>()
  for (const b of found) {
    const key = ident(b.name)
    if (seen.has(key)) throw new DuplicateBlockError(b.name)
    seen.add(key)
  }

  // Everything OUTSIDE the blocks travels with them: `raw` in its three forms, and any plain FlatInk the
  // author wrote beside them. Dropping it made the escape hatch a no-op -- decor was written, the
  // expansion compiled, `checkProgram` said ok, and nothing was there.
  const outside: RawParts = { top: [], over: [], under: [], rest: '' }
  const absorb = (text: string) => {
    const part = takeRaw(text)
    outside.top.push(...part.top)
    outside.over.push(...part.over)
    outside.under.push(...part.under)
    outside.rest += part.rest
  }
  let cursor = 0
  for (const b of found) { absorb(src.slice(cursor, b.start)); cursor = b.end }
  absorb(src.slice(cursor))

  const blocks = found.map((b, index) => {
    const prefix = `${ident(b.name)}_`
    return { expansion: b.gesture.expand(b.name, b.body, doc, { index, prefix, doneVar: `${prefix}done` }) }
  })

  // Top-level content goes in the HEADER position, wherever the author wrote it: `var` (like `asset`,
  // `use`, `def`) is a header declaration and a parse error after `scene`, while `object`/`fn` are legal
  // on either side. Moving an `object` up changes nothing -- behavior binds by name, not by position.
  const header = [outside.rest.trim(), ...(outside.top.length ? [RAW_NOTE, ...outside.top] : [])].filter(Boolean).join('\n')
  const program = assemble(blocks, outside.under, outside.over, doc)
  return {
    flatink: ensureHeader(header ? `${header}\n\n${program}` : program, doc),
    kind: found.map((b) => b.gesture.keyword).join('+'),
    expanded: true,
    meta: blocks.map((b) => b.expansion.meta),
  }
}
