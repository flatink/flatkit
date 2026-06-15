// ─────────────────────────────────────────────────────────────────────────────
//  dsl.ts — "FlatInk Script" textual language (parser + printer).
//
//  This is the 1:1 TEXTUAL SURFACE of the declarative model (actions.ts + expressions).
//  Designed to be "kid-friendly but realistic" (close to JS): braces for blocks,
//  a real `=`, readable keywords. NO `eval`: expressions (condition, value,
//  channel binding) are captured as RAW TEXT and validated elsewhere by
//  compileExpr (cf. linter, batch L3). PURE and isolated module (like booleanOps):
//  it depends only on the TYPES from actions.ts and the expression channels.
//
//  Two levels:
//   • body  = list of `Action` (play / pause / go to / assignment / if / repeat)
//             — reused in every block body (event, if, repeat, frame).
//   • unit  = top-level declaration (`ScriptUnit`): event (hat),
//             frame actions, label, channel binding, variable declaration.
//
//  Round-trip guaranteed at the MODEL level: parseUnits(printUnits(u)).units ≡ u.
// ─────────────────────────────────────────────────────────────────────────────
import { SEND_EVENT_NAME, type Action, type FuncDef } from './actions'
import { EXPR_CHANNELS, type ExprChannel } from './timeline'

// ── Intermediate representation (independent of the Doc) ──────────────────────
/** Trigger event (hat). `enter`/`leave` = hover enter/leave. */
export type ScriptEvent = 'click' | 'enter' | 'leave' | 'press' | 'release' | 'drag' | 'longpress' | 'load' | 'enterFrame'

/** A top-level declaration in a code "file". */
export type ScriptUnit =
  | { kind: 'event'; event: ScriptEvent; body: Action[] } // when clicked { … }
  | { kind: 'frameActions'; frame: number; body: Action[] } // at frame 30 { … }
  | { kind: 'label'; frame: number; name: string } // label 30 "checkpoint"
  | { kind: 'binding'; channel: ExprChannel; expr: string } // rotation = time * 2
  | { kind: 'declare'; name: string; value: number | number[] } // let score = 0 · let grid = fill(9,1)
  | { kind: 'each'; symbol: string; as: string; bindings: { channel: ExprChannel; expr: string }[] } // each "Brick" as i { opacity = bricks[i] }
  | { kind: 'func'; func: FuncDef } // fn dist(a,b) = … · fn launch() { … }
  | { kind: 'use'; name: string } // use "collision" — imports a package
  // "move" interactor (cf. RFC interactors): moves the object to the mouse, writes the position into explicit
  // variables. `drag x, y` (2 axes) · `dragX x` · `dragY y`. Slots: confine (zone) / snap (grid).
  | { kind: 'interactor'; axis: 'xy' | 'x' | 'y' | 'turn' | 'turnDeg' | 'trace' | 'reveal' | 'link'; varX?: string; varY?: string; varT?: string; confine?: string; grid?: number; enabled?: string; pivot?: { x: number; y: number } }
  | { kind: 'drop'; over: string; atPointer?: boolean; body: Action[] } // when dropped on Zone [at pointer] { … } — released over a named zone

/** Parse diagnostic (1-based line/column, message text). Missing `severity` = error. */
export type Diagnostic = { line: number; col: number; message: string; severity?: 'error' | 'warning' }

/**
 * Site annotated with its source position, for the linter (batch L3): an expression to
 * validate via compileExpr, or a label cited by `go to "…"`. The `units` do not
 * carry positions (clean model); the `sites` bridge that gap.
 */
export type Site =
  | { kind: 'expr'; text: string; line: number; col: number }
  | { kind: 'label-ref'; name: string; line: number; col: number }

export type ParseResult = { units: ScriptUnit[]; diagnostics: Diagnostic[]; sites: Site[] }

// ─────────────────────────────────────────────────────────────────────────────
//  PRINTER (model → text)
// ─────────────────────────────────────────────────────────────────────────────
const INDENT = '  '
const EVENT_HEAD: Record<ScriptEvent, string> = {
  click: 'when clicked',
  enter: 'when hovered',
  leave: 'when unhovered',
  press: 'when pressed',
  release: 'when released',
  drag: 'when dragged',
  longpress: 'when held',
  load: 'when loaded',
  enterFrame: 'every frame',
}

const quote = (s: string) => '"' + s.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`) + '"'
const playSuffix = (p?: boolean) => (p === true ? ' and play' : p === false ? ' and pause' : '')

function printAction(a: Action, depth: number): string {
  const ind = INDENT.repeat(depth)
  switch (a.do) {
    case 'play':
      return ind + 'play'
    case 'pause':
      return ind + 'pause'
    case 'gotoFrame':
      return ind + `go to frame ${a.frame}` + playSuffix(a.play)
    case 'gotoLabel':
      return ind + `go to ${quote(a.label)}` + playSuffix(a.play)
    case 'setVar':
      return ind + `${a.name} = ${a.value}`
    case 'setIndex':
      return ind + `set ${a.name}[${a.index}] = ${a.value}`
    case 'setParam':
      return ind + `${a.target}.${a.param} = ${a.value}`
    case 'if': {
      let s = ind + `if ${a.cond} ` + block(a.then, depth)
      if (a.else) s += ` else ` + block(a.else, depth)
      return s
    }
    case 'repeat':
      return ind + `repeat ${a.count} times ` + block(a.body, depth)
    case 'repeatRange':
      return ind + `repeat ${a.var} from ${a.from} to ${a.to} ` + block(a.body, depth)
    case 'call':
      return ind + `${a.name}(${a.args.join(', ')})`
    case 'send': {
      let s = ind + `send ${quote(a.event)}`
      if (a.payload) s += a.payload.kind === 'expr' ? `, ${a.payload.expr}` : `, text(${quote(a.payload.itemId)})`
      return s
    }
    case 'sound':
      return ind + `sound ${quote(a.assetId)}`
  }
}

/** Value of a `let`: number, or array (uniform → `fill(n, v)`, otherwise literal `[a, b, …]`). */
function printValue(v: number | number[]): string {
  if (!Array.isArray(v)) return String(v)
  if (v.length >= 2 && v.every((x) => x === v[0])) return `fill(${v.length}, ${v[0]})`
  return `[${v.join(', ')}]`
}

/** Renders a `{ … }` block; empty = compact `{}` to avoid a blank line. */
function block(actions: Action[], depth: number): string {
  if (actions.length === 0) return '{}'
  const body = actions.map((a) => printAction(a, depth + 1)).join('\n')
  return `{\n${body}\n${INDENT.repeat(depth)}}`
}

function printUnit(u: ScriptUnit): string {
  switch (u.kind) {
    case 'event':
      return EVENT_HEAD[u.event] + ' ' + block(u.body, 0)
    case 'frameActions':
      return `at frame ${u.frame} ` + block(u.body, 0)
    case 'label':
      return `label ${u.frame} ${quote(u.name)}`
    case 'binding':
      return `${u.channel} = ${u.expr}`
    case 'declare':
      return `let ${u.name} = ${printValue(u.value)}`
    case 'each': {
      const body = u.bindings.length
        ? `{\n${u.bindings.map((b) => INDENT + `${b.channel} = ${b.expr}`).join('\n')}\n}`
        : '{}'
      return `each ${quote(u.symbol)} as ${u.as} ` + body
    }
    case 'func': {
      const sig = `fn ${u.func.name}(${u.func.params.join(', ')})`
      return u.func.kind === 'value' ? `${sig} = ${u.func.expr}` : `${sig} ` + block(u.func.body, 0)
    }
    case 'use':
      return `use ${quote(u.name)}`
    case 'interactor': {
      const enabledSlot = u.enabled ? [INDENT + `enabled ${u.enabled}`] : []
      const block = (head: string, slots: string[]) => (slots.length ? `${head} {\n${slots.join('\n')}\n}` : head)
      if (u.axis === 'turn' || u.axis === 'turnDeg') return block(`${u.axis} ${u.varX} around ${u.pivot?.x ?? 0},${u.pivot?.y ?? 0}`, [...(u.grid !== undefined ? [INDENT + `snap ${u.grid}`] : []), ...enabledSlot])
      if (u.axis === 'trace') return block(`trace ${u.varX} along ${u.confine}`, [...(u.grid !== undefined ? [INDENT + `tolerance ${u.grid}`] : []), ...enabledSlot])
      if (u.axis === 'reveal') return block(`reveal ${u.varX}`, [...(u.grid !== undefined ? [INDENT + `brush ${u.grid}`] : []), ...enabledSlot])
      if (u.axis === 'link') return block(`link ${u.varX}, ${u.varY}, ${u.varT} to ${u.confine}`, [...enabledSlot])
      const kw = u.axis === 'x' ? 'dragX' : u.axis === 'y' ? 'dragY' : 'drag'
      const vars = u.axis === 'x' ? u.varX! : u.axis === 'y' ? u.varY! : `${u.varX}, ${u.varY}`
      return block(`${kw} ${vars}`, [...(u.confine ? [INDENT + `confine to ${u.confine}`] : []), ...(u.grid !== undefined ? [INDENT + `snap ${u.grid}`] : []), ...enabledSlot])
    }
    case 'drop':
      return `when dropped on ${u.over}${u.atPointer ? ' at pointer' : ''} ` + block(u.body, 0)
  }
}

/** A "block" unit spans several lines ({ … }) → we space it out; declarations/bindings/
 *  labels fit on one line → we stack them with no blank line (otherwise the code looks gappy). */
const isBlockUnit = (u: ScriptUnit): boolean =>
  u.kind === 'event' || u.kind === 'frameActions' || u.kind === 'each' || u.kind === 'drop' || (u.kind === 'func' && u.func.kind === 'proc') || (u.kind === 'interactor' && (!!u.confine || u.grid !== undefined || !!u.enabled))

/**
 * Prints a list of units as DSL source. A blank line between two units ONLY if one of the
 * two is a block (event / frame actions); single lines (let/binding/label) stay
 * stuck together for a compact, readable rendering.
 */
export function printUnits(units: ScriptUnit[]): string {
  if (units.length === 0) return ''
  let out = printUnit(units[0])
  for (let i = 1; i < units.length; i++) {
    out += (isBlockUnit(units[i]) || isBlockUnit(units[i - 1]) ? '\n\n' : '\n') + printUnit(units[i])
  }
  return out + '\n'
}

// ─────────────────────────────────────────────────────────────────────────────
//  PARSER (text → model)  — recursive descent, error-tolerant.
// ─────────────────────────────────────────────────────────────────────────────
const ID = /[A-Za-z0-9_]/
const MAX_FILL = 100_000 // bound for `fill(n, v)` → no giant array
const isChannel = (s: string): s is ExprChannel => (EXPR_CHANNELS as string[]).includes(s)
const stripComment = (s: string) => {
  const i = s.indexOf('//')
  return i >= 0 ? s.slice(0, i) : s
}

type Mark = { i: number; line: number; col: number }

class Parser {
  private i = 0
  private line = 1
  private col = 1
  readonly diags: Diagnostic[] = []
  readonly sites: Site[] = []
  constructor(private readonly s: string) {}

  /** Records an expression to validate, at the position `m` where it starts. */
  private exprSite(text: string, m: Mark) {
    if (text) this.sites.push({ kind: 'expr', text, line: m.line, col: m.col })
  }

  // ── cursor primitives ──
  private eof() {
    return this.i >= this.s.length
  }
  private peek() {
    return this.s[this.i]
  }
  private at(o: number) {
    return this.s[this.i + o]
  }
  private next() {
    const c = this.s[this.i++]
    if (c === '\n') {
      this.line++
      this.col = 1
    } else this.col++
    return c
  }
  private mark(): Mark {
    return { i: this.i, line: this.line, col: this.col }
  }
  private reset(m: Mark) {
    this.i = m.i
    this.line = m.line
    this.col = m.col
  }
  private err(message: string, m?: Mark) {
    this.diags.push({ line: m?.line ?? this.line, col: m?.col ?? this.col, message })
  }

  // ── whitespace / comments ──
  private skipSpace() {
    while (!this.eof()) {
      const c = this.peek()
      if (c === ' ' || c === '\t' || c === '\r') this.next()
      else break
    }
  }
  private skipWs() {
    for (;;) {
      const c = this.peek()
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') this.next()
      else if (c === '/' && this.at(1) === '/') {
        while (!this.eof() && this.peek() !== '\n') this.next()
      } else break
    }
  }
  private skipLine() {
    while (!this.eof() && this.peek() !== '\n') this.next()
    if (!this.eof()) this.next()
  }

  // ── token reading ──
  private word(): string {
    this.skipSpace()
    let w = ''
    while (!this.eof() && ID.test(this.peek())) w += this.next()
    return w
  }
  /** Reads a gesture OUTPUT: an identifier `name`, or an array element `name[<idx>]` (BALANCED
   *  scan of the index — the natural form under `each`, e.g. `drag hx[i], hy[i]`). */
  private outVar(): string {
    const name = this.word()
    if (!name) return ''
    this.skipSpace()
    if (this.peek() !== '[') return name
    this.next() // [
    let idx = '', depth = 1
    for (;;) {
      if (this.eof() || this.peek() === '\n') { this.err('"]" expected after the output index'); break }
      const c = this.peek()
      if (c === ']') { depth--; if (depth === 0) { this.next(); break } }
      else if (c === '[') depth++
      idx += this.next()
    }
    return `${name}[${idx.trim()}]`
  }
  private peekWord(): string {
    const m = this.mark()
    const w = this.word()
    this.reset(m)
    return w
  }
  private number(): number | null {
    this.skipSpace()
    let raw = ''
    if (this.peek() === '-') raw += this.next()
    let digits = false
    while (!this.eof() && /[0-9]/.test(this.peek())) {
      raw += this.next()
      digits = true
    }
    if (this.peek() === '.') {
      raw += this.next()
      while (!this.eof() && /[0-9]/.test(this.peek())) {
        raw += this.next()
        digits = true
      }
    }
    return digits ? Number(raw) : null
  }
  /** Arguments of a call `(a, b, …)`: split on depth-0 commas (nested parentheses OK). */
  private callArgs(): string[] {
    this.next() // consume "("
    const args: string[] = []
    let depth = 0
    let cur = ''
    for (;;) {
      if (this.eof() || this.peek() === '\n') { this.err('")" expected'); break }
      const c = this.peek()
      if (depth === 0 && c === ')') { this.next(); break }
      if (depth === 0 && c === ',') { this.next(); if (cur.trim()) args.push(cur.trim()); cur = ''; continue }
      if (c === '(') depth++
      else if (c === ')') depth--
      cur += this.next()
    }
    if (cur.trim()) args.push(cur.trim())
    return args
  }

  /** Initial value of a global `let`: number, array literal `[a, b, …]`, or `fill(n, v)`. */
  private declareValue(m: Mark): number | number[] | null {
    this.skipSpace()
    if (this.peek() === '[') { // literal [a, b, c]
      this.next()
      const arr: number[] = []
      for (;;) {
        this.skipSpace()
        if (this.peek() === ']') { this.next(); break }
        const n = this.number()
        if (n === null) { this.err('number expected in the array', m); return null }
        arr.push(n)
        this.skipSpace()
        if (this.peek() === ',') { this.next(); continue }
        if (this.peek() === ']') { this.next(); break }
        this.err('"," or "]" expected in the array', m)
        return null
      }
      return arr
    }
    if (this.peekWord() === 'fill') { // fill(n, v) → array of n copies of v
      this.word()
      if (!this.eat('(')) { this.err('"(" expected after "fill"', m); return null }
      const n = this.number()
      this.skipSpace()
      this.eat(',')
      const val = this.number()
      this.skipSpace()
      if (!this.eat(')')) { this.err('")" expected after "fill(n, v"', m); return null }
      if (n === null || val === null) { this.err('"fill(n, v)" expects two numbers', m); return null }
      return Array<number>(Math.max(0, Math.min(MAX_FILL, Math.floor(n)))).fill(val)
    }
    return this.number() // scalar (null if absent)
  }

  private string(): string | null {
    this.skipSpace()
    if (this.peek() !== '"') {
      this.err('quoted string expected')
      return null
    }
    this.next()
    let v = ''
    while (!this.eof()) {
      const c = this.next()
      if (c === '"') return v
      if (c === '\n') break
      if (c === '\\' && !this.eof()) {
        const n = this.next()
        v += n === 'n' ? '\n' : n
      } else v += c
    }
    this.err('unterminated string')
    return v
  }
  private eat(ch: string): boolean {
    this.skipSpace()
    if (this.peek() === ch) {
      this.next()
      return true
    }
    return false
  }

  // ── end of line for a simple statement ──
  private endStatement() {
    this.skipSpace()
    if (this.peek() === '/' && this.at(1) === '/') while (!this.eof() && this.peek() !== '\n') this.next()
    if (this.eof()) return
    const c = this.peek()
    if (c === '\n') {
      this.next()
      return
    }
    if (c === '}') return
    this.err('end of line expected')
    this.skipLine()
  }

  /** Captures the text up to `{` (block header); cursor left on `{`. */
  private header(): string | null {
    let raw = ''
    while (!this.eof()) {
      const c = this.peek()
      if (c === '{') return stripComment(raw).trim()
      if (c === '\n') break
      raw += this.next()
    }
    this.err('"{" expected')
    return null
  }
  /** Index of the first level-0 `=` that is NOT a comparator (==, !=, <=, >=), or -1.
   *  A sign of a 2nd assignment/action stuck on the same line (e.g. `x = 1  y = 2`). */
  private strayAssignIndex(expr: string): number {
    let depth = 0
    for (let i = 0; i < expr.length; i++) {
      const c = expr[i]
      if (c === '(' || c === '[') depth++
      else if (c === ')' || c === ']') depth--
      else if (c === '"') { i++; while (i < expr.length && expr[i] !== '"') i++ }
      else if (c === '=' && depth === 0) {
        const prev = expr[i - 1], next = expr[i + 1]
        if (prev === '=' || prev === '!' || prev === '<' || prev === '>' || next === '=') continue
        return i
      }
    }
    return -1
  }
  /** Diagnoses a 2nd assignment stuck inside an expression; returns true if detected. */
  private flagStrayAssign(expr: string, pos: Mark, kind: string): boolean {
    const eq = this.strayAssignIndex(expr)
    if (eq < 0) return false
    this.err(`${kind}: one action per line — unexpected "=" (separate them with a line break)`, { i: pos.i + eq, line: pos.line, col: pos.col + eq })
    return true
  }
  /** Captures an expression up to the end of line (or `}`). */
  private lineExpr(): string {
    let raw = ''
    while (!this.eof()) {
      const c = this.peek()
      if (c === '\n' || c === '}') break
      raw += this.next()
    }
    return stripComment(raw).trim()
  }
  private expectBrace(): boolean {
    this.skipWs()
    if (this.peek() === '{') {
      this.next()
      return true
    }
    this.err('"{" expected')
    return false
  }

  // ── body of a block: list of actions up to `}` ──
  private body(): Action[] {
    const out: Action[] = []
    for (;;) {
      this.skipWs()
      if (this.eof()) {
        this.err('missing "}"')
        break
      }
      if (this.peek() === '}') {
        this.next()
        break
      }
      const a = this.statement()
      if (a) out.push(a)
    }
    return out
  }

  private statement(): Action | null {
    const m = this.mark()
    const w = this.word()
    switch (w) {
      case 'play':
        this.endStatement()
        return { do: 'play' }
      case 'pause':
        this.endStatement()
        return { do: 'pause' }
      case 'go':
        return this.goStatement()
      case 'if':
        return this.ifStatement()
      case 'repeat':
        return this.repeatStatement()
      case 'send': {
        // Reserved keyword. Back-compat: `send` used as a variable/function stays an assignment.
        this.skipSpace()
        const c = this.peek()
        if (c === '=' || c === '(' || c === '[' || c === '.') return this.assignStatement('send', m)
        return this.sendStatement(m)
      }
      case 'sound': {
        // Reserved keyword. Back-compat: `sound` used as a variable/function stays an assignment.
        this.skipSpace()
        const c = this.peek()
        if (c === '=' || c === '(' || c === '[' || c === '.') return this.assignStatement('sound', m)
        const assetId = this.string()
        if (assetId === null) { this.skipLine(); return null }
        this.endStatement()
        return { do: 'sound', assetId }
      }
      case 'when':
      case 'every':
      case 'at':
        this.err(`"${w} …" is an event: it cannot be inside another block`, m)
        this.recoverBlockOrLine()
        return null
      case 'let':
      case 'set': // `set` = optional assignment prefix (useful mainly for the indexed form: set arr[i] = …)
        return this.assignStatement(this.word(), m)
      case '':
        this.err('statement expected', m)
        this.skipLine()
        return null
      default:
        return this.assignStatement(w, m)
    }
  }

  /** `name = <expr>` → setVar, or `name[<idx>] = <expr>` → setIndex (the `let` init is handled upstream). */
  private assignStatement(name: string, m: Mark): Action | null {
    if (!name) {
      this.err('variable name expected', m)
      this.skipLine()
      return null
    }
    this.skipSpace()
    if (this.peek() === '.') { // `Name.param = value` (set an instance's exposed param) OR qualified call `pkg.proc(args)`
      this.next()
      const suffix = this.word()
      this.skipSpace()
      if (this.peek() === '=') { // <Instance>.<param> = value — value may be a state NAME or an expression
        if (!suffix) { this.err('parameter name expected after "."', m); this.skipLine(); return null }
        this.next()
        this.skipSpace()
        const value = this.lineExpr()
        if (!value) { this.err('value (state name or expression) expected after "="', m); return null }
        this.endStatement() // NB: value not lint-checked as an expression — it may be a bare state name, resolved at runtime
        return { do: 'setParam', target: name, param: suffix, value }
      }
      if (!suffix || this.peek() !== '(') { this.err('"(" expected for a qualified call "pkg.proc(…)" or "=" for "Name.param = value"', m); this.skipLine(); return null }
      const args = this.callArgs()
      for (const a of args) this.exprSite(a, m)
      this.endStatement()
      return { do: 'call', name: name + '.' + suffix, args }
    }
    if (this.peek() === '(') { // procedure call: name(args)
      const args = this.callArgs()
      for (const a of args) this.exprSite(a, m)
      this.endStatement()
      return { do: 'call', name, args }
    }
    if (this.peek() === '[') { // indexed assignment: name[<idx>] = <expr>
      this.next()
      const ipos = this.mark()
      // BALANCED scan: tracks bracket depth → a nested index (`occ[sl[i + 1]]`) is
      // captured whole, not truncated at the first `]` (otherwise a silent miscompile — RETRO EDU bug).
      let idx = '', depth = 1
      for (;;) {
        if (this.eof() || this.peek() === '\n') { this.err('"]" expected after the index', m); this.skipLine(); return null }
        const c = this.peek()
        if (c === ']') { depth--; if (depth === 0) { this.next(); break } }
        else if (c === '[') depth++
        idx += this.next()
      }
      idx = stripComment(idx).trim()
      if (!idx) { this.err('index expected between "[ ]"', m); this.skipLine(); return null }
      this.exprSite(idx, ipos)
      if (!this.eat('=')) { this.err(`"=" expected after "${name}[…]"`, m); this.skipLine(); return null }
      this.skipSpace()
      const vpos = this.mark()
      const value = this.lineExpr()
      if (!value) { this.err('expression expected after "="', m); return null }
      this.exprSite(value, vpos)
      this.endStatement()
      return { do: 'setIndex', name, index: idx, value }
    }
    if (!this.eat('=')) {
      this.err(`"=" expected after "${name}"`, m)
      this.skipLine()
      return null
    }
    this.skipSpace()
    const pos = this.mark()
    const value = this.lineExpr()
    if (!value) {
      this.err('expression expected after "="', m)
      return null
    }
    if (this.flagStrayAssign(value, pos, 'assignment')) { this.endStatement(); return null }
    this.exprSite(value, pos)
    this.endStatement()
    return { do: 'setVar', name, value }
  }

  /** Lookahead: is what follows a `text(…)` call (identifier "text" followed by a "(")? */
  private peekIsTextCall(): boolean {
    const save = this.mark()
    const w = this.word()
    this.skipSpace()
    const yes = w === 'text' && this.peek() === '('
    this.reset(save)
    return yes
  }

  /** `send "event"` · `send "event", <expr>` · `send "event", text("itemId")` → emits to the host. */
  private sendStatement(m: Mark): Action | null {
    this.skipSpace()
    if (this.peek() !== '"') { this.err('quoted event name expected after "send"', m); this.skipLine(); return null }
    const npos = this.mark()
    const name = this.string()
    if (name === null) { this.skipLine(); return null }
    let valid = true
    if (name === '') { this.err('empty event name', npos); valid = false }
    else if (!SEND_EVENT_NAME.test(name)) {
      this.err(`invalid event name "${name}" (letters, digits, "_", "-"; starts with a letter or "_"; 64 characters max)`, npos)
      valid = false
    }
    this.skipSpace()
    if (this.peek() !== ',') { // bare form, no payload
      this.endStatement()
      return valid ? { do: 'send', event: name } : null
    }
    this.next() // consume ","
    this.skipSpace()
    if (this.peekIsTextCall()) { // text payload: text("itemId")
      const tm = this.mark()
      this.word() // consume "text"
      this.eat('(')
      this.skipSpace()
      if (this.peek() !== '"') { this.err('text() expects a string literal: text("textId")', tm); this.skipLine(); return null }
      const itemId = this.string()
      if (itemId === null) { this.skipLine(); return null }
      this.skipSpace()
      if (this.peek() === ',') { this.err('text() expects a single argument', tm); this.skipLine(); return null }
      if (!this.eat(')')) { this.err('")" expected after "text("…""', tm); this.skipLine(); return null }
      this.endStatement()
      return valid ? { do: 'send', event: name, payload: { kind: 'text', itemId } } : null
    }
    // numeric payload: standard DSL expression (validated by the linter via exprSite)
    const pos = this.mark()
    const expr = this.lineExpr()
    if (!expr) { this.err('expression or "text("…")" expected after ","', m); return null }
    // Footgun: `send "evt", x = 1` would capture `x = 1` as the payload → we reject it explicitly.
    if (this.flagStrayAssign(expr, pos, '"send" payload')) { this.endStatement(); return null }
    this.exprSite(expr, pos)
    this.endStatement()
    return valid ? { do: 'send', event: name, payload: { kind: 'expr', expr } } : null
  }

  private goStatement(): Action | null {
    const m = this.mark()
    if (this.word() !== 'to') {
      this.err('"to" expected after "go"', m)
      this.skipLine()
      return null
    }
    this.skipSpace()
    if (this.peek() === '"') {
      const pos = this.mark()
      const label = this.string()
      if (label === null) {
        this.skipLine()
        return null
      }
      this.sites.push({ kind: 'label-ref', name: label, line: pos.line, col: pos.col })
      const play = this.andPlay()
      this.endStatement()
      return { do: 'gotoLabel', label, ...(play === undefined ? {} : { play }) }
    }
    const w = this.word()
    if (w === 'frame') {
      const n = this.number()
      if (n === null) {
        this.err('frame number expected after "frame"', m)
        this.skipLine()
        return null
      }
      const play = this.andPlay()
      this.endStatement()
      return { do: 'gotoFrame', frame: n, ...(play === undefined ? {} : { play }) }
    }
    this.err('"frame N" or a label "name" expected after "go to"', m)
    this.skipLine()
    return null
  }

  /** Optional suffix `and play` / `and pause`. */
  private andPlay(): boolean | undefined {
    const m = this.mark()
    if (this.word() !== 'and') {
      this.reset(m)
      return undefined
    }
    const w = this.word()
    if (w === 'play') return true
    if (w === 'pause') return false
    this.err('"play" or "pause" expected after "and"', m)
    this.reset(m)
    return undefined
  }

  private ifStatement(): Action | null {
    this.skipSpace()
    const m = this.mark()
    const cond = this.header()
    if (cond === null) {
      this.recoverBlockOrLine()
      return null
    }
    if (cond) {this.exprSite(cond, m)}
    else {this.err('empty condition', m)}
    if (!this.expectBrace()) return null
    const then = this.body()
    // optional `else { … }` and `else if … { … }`
    const save = this.mark()
    if (this.peekWord() === 'else') {
      this.word()
      // `else if` sugar: we nest a full `if` as the only action of the `else` body
      // (equivalent to `else { if … { … } }`, without the pyramid of braces).
      if (this.peekWord() === 'if') {
        this.word()
        const elif = this.ifStatement()
        return { do: 'if', cond, then, else: elif ? [elif] : [] }
      }
      if (!this.expectBrace()) return { do: 'if', cond, then }
      const els = this.body()
      return { do: 'if', cond, then, else: els }
    }
    this.reset(save)
    return { do: 'if', cond, then }
  }

  private repeatStatement(): Action | null {
    this.skipSpace()
    const m = this.mark()
    const head = this.header()
    if (head === null) {
      this.recoverBlockOrLine()
      return null
    }
    // Indexed form: `repeat <i> from <A> to <B>` (inclusive).
    const range = /^([A-Za-z_]\w*)\s+from\s+(.+?)\s+to\s+(.+)$/.exec(head)
    if (range) {
      const from = range[2].trim()
      const to = range[3].trim()
      this.exprSite(from, m)
      this.exprSite(to, m)
      if (!this.expectBrace()) return null
      return { do: 'repeatRange', var: range[1], from, to, body: this.body() }
    }
    // Bounded form: `repeat <n> times`.
    let count = head
    if (/(^|\s)times$/.test(head)) count = head.replace(/\s*times\s*$/, '').trim()
    else this.err('"<n> times" or "<i> from <A> to <B>" expected after "repeat"', m)
    if (count) {this.exprSite(count, m)} else {
      this.err('missing repetition count', m)
      count = '0'
    }
    if (!this.expectBrace()) return null
    return { do: 'repeat', count, body: this.body() }
  }

  /** Error recovery: skips a `{…}` block if there is one, otherwise the line. */
  private recoverBlockOrLine() {
    this.skipWs()
    if (this.peek() === '{') {
      let depth = 0
      do {
        const c = this.next()
        if (c === '{') depth++
        else if (c === '}') depth--
      } while (!this.eof() && depth > 0)
    } else this.skipLine()
  }

  // ── "unit" level (top level of a file) ──
  parse(): ScriptUnit[] {
    const units: ScriptUnit[] = []
    for (;;) {
      this.skipWs()
      if (this.eof()) break
      const u = this.unit()
      if (u) units.push(u)
    }
    return units
  }

  private unit(): ScriptUnit | null {
    const m = this.mark()
    const w = this.word()
    switch (w) {
      case 'when': {
        const e = this.word()
        if (e === 'dropped') { // when dropped on <Zone> { … }
          if (this.word() !== 'on') { this.err('"when dropped on <Zone> { … }" expected', m); this.recoverBlockOrLine(); return null }
          const over = this.word()
          if (!over) { this.err('zone name expected after "dropped on"', m); this.recoverBlockOrLine(); return null }
          // `at pointer` (optional): tests the POINTER position against the zone (not the object's center).
          let atPointer = false
          if (this.peekWord() === 'at') { this.word(); if (this.word() !== 'pointer') { this.err('"at pointer" expected after the zone name', m); this.recoverBlockOrLine(); return null } atPointer = true }
          if (!this.expectBrace()) return null
          return { kind: 'drop', over, ...(atPointer ? { atPointer: true } : {}), body: this.body() }
        }
        const ev: ScriptEvent | null =
          e === 'clicked' ? 'click' : e === 'hovered' ? 'enter' : e === 'unhovered' ? 'leave'
          : e === 'pressed' ? 'press' : e === 'released' ? 'release' : e === 'dragged' ? 'drag' : e === 'held' ? 'longpress'
          : e === 'loaded' ? 'load' : null
        if (!ev) {
          this.err(`unknown event "when ${e}" (clicked, hovered, unhovered, pressed, released, dragged, held, loaded)`, m)
          this.recoverBlockOrLine()
          return null
        }
        if (!this.expectBrace()) return null
        return { kind: 'event', event: ev, body: this.body() }
      }
      case 'every': {
        if (this.word() !== 'frame') {
          this.err('"every frame { … }" expected', m)
          this.recoverBlockOrLine()
          return null
        }
        if (!this.expectBrace()) return null
        return { kind: 'event', event: 'enterFrame', body: this.body() }
      }
      case 'at': {
        if (this.word() !== 'frame') {
          this.err('"at frame N { … }" expected', m)
          this.recoverBlockOrLine()
          return null
        }
        const n = this.number()
        if (n === null) {
          this.err('frame number expected after "at frame"', m)
          this.recoverBlockOrLine()
          return null
        }
        if (!this.expectBrace()) return null
        return { kind: 'frameActions', frame: n, body: this.body() }
      }
      case 'use': {
        const name = this.string()
        if (name === null) { this.skipLine(); return null }
        this.endStatement()
        return { kind: 'use', name }
      }
      case 'drag':
      case 'dragX':
      case 'dragY': {
        const axis = w === 'dragX' ? 'x' : w === 'dragY' ? 'y' : 'xy'
        const v1 = this.outVar()
        if (!v1) { this.err(`variable name expected after "${w}"`, m); this.recoverBlockOrLine(); return null }
        let varX: string | undefined
        let varY: string | undefined
        if (axis === 'xy') {
          if (!this.eat(',')) { this.err('"," expected: drag x, y', m); this.recoverBlockOrLine(); return null }
          const v2 = this.outVar()
          if (!v2) { this.err('second variable expected: drag x, y', m); this.recoverBlockOrLine(); return null }
          varX = v1
          varY = v2
        } else if (axis === 'x') varX = v1
        else varY = v1
        let confine: string | undefined
        let grid: number | undefined
        let enabled: string | undefined
        this.skipSpace()
        if (this.peek() === '{') { // optional slots: { confine to Zone · snap N · enabled <expr> }
          this.next()
          for (;;) {
            this.skipWs()
            if (this.eof()) { this.err('missing "}"', m); break }
            if (this.peek() === '}') { this.next(); break }
            const sm = this.mark()
            const slot = this.word()
            if (slot === 'confine') {
              if (this.word() !== 'to') { this.err('"confine to <Zone>" expected', sm); this.skipLine(); continue }
              const obj = this.word()
              if (!obj) { this.err('zone name expected after "confine to"', sm); this.skipLine(); continue }
              confine = obj
            } else if (slot === 'snap') {
              const n = this.number()
              if (n === null) { this.err('value expected after "snap"', sm); this.skipLine(); continue }
              grid = n
            } else if (slot === 'enabled') { // dynamic lock: drag active iff the expression is true
              this.skipSpace()
              const epos = this.mark()
              const ex = this.lineExpr()
              if (!ex) { this.err('expression expected after "enabled"', sm); this.skipLine(); continue }
              this.exprSite(ex, epos)
              enabled = ex
            } else { this.err(`unknown slot "${slot}" (expected: confine, snap, enabled)`, sm); this.skipLine(); continue }
            this.endStatement()
          }
        } else {
          this.endStatement()
        }
        return { kind: 'interactor', axis, varX, varY, confine, grid, ...(enabled ? { enabled } : {}) }
      }
      case 'turn':
      case 'turnDeg': {
        // `turn <angle> around <x>,<y> [{ snap N · enabled <expr> }]` — rotation at the pointer around a pivot.
        // `turn` writes RADIANS (pairs with the `rotation` channel); `turnDeg` writes DEGREES (pairs with `rotationDeg`).
        // (At the OBJECT/unit level these are keywords; inside an action body they stay variables.)
        const v = this.outVar()
        if (!v) { this.err('variable name (angle) expected after "turn"', m); this.recoverBlockOrLine(); return null }
        if (this.word() !== 'around') { this.err('"turn <angle> around <x>,<y>" expected', m); this.recoverBlockOrLine(); return null }
        const px = this.number()
        this.skipSpace()
        if (px === null || !this.eat(',')) { this.err('pivot expected: around <x>,<y>', m); this.recoverBlockOrLine(); return null }
        const py = this.number()
        if (py === null) { this.err('pivot expected: around <x>,<y>', m); this.recoverBlockOrLine(); return null }
        let grid: number | undefined
        let enabled: string | undefined
        this.skipSpace()
        if (this.peek() === '{') { // slots: { snap N · enabled <expr> }
          this.next()
          for (;;) {
            this.skipWs()
            if (this.eof()) { this.err('missing "}"', m); break }
            if (this.peek() === '}') { this.next(); break }
            const sm = this.mark()
            const slot = this.word()
            if (slot === 'snap') { const n = this.number(); if (n === null) { this.err('value expected after "snap"', sm); this.skipLine(); continue } grid = n }
            else if (slot === 'enabled') { this.skipSpace(); const epos = this.mark(); const ex = this.lineExpr(); if (!ex) { this.err('expression expected after "enabled"', sm); this.skipLine(); continue } this.exprSite(ex, epos); enabled = ex }
            else { this.err(`unknown slot "${slot}" (expected: snap, enabled)`, sm); this.skipLine(); continue }
            this.endStatement()
          }
        } else this.endStatement()
        return { kind: 'interactor', axis: w === 'turnDeg' ? 'turnDeg' : 'turn', varX: v, pivot: { x: px, y: py }, ...(grid !== undefined ? { grid } : {}), ...(enabled ? { enabled } : {}) }
      }
      case 'trace': {
        // `trace <progress> along <Path> [{ tolerance N · enabled <expr> }]` — follows a path with the finger.
        const v = this.outVar()
        if (!v) { this.err('variable name (progress) expected after "trace"', m); this.recoverBlockOrLine(); return null }
        if (this.word() !== 'along') { this.err('"trace <progress> along <Path>" expected', m); this.recoverBlockOrLine(); return null }
        const path = this.word()
        if (!path) { this.err('path-group name expected after "along"', m); this.recoverBlockOrLine(); return null }
        let grid: number | undefined
        let enabled: string | undefined
        this.skipSpace()
        if (this.peek() === '{') { // slots: { tolerance N · enabled <expr> }
          this.next()
          for (;;) {
            this.skipWs()
            if (this.eof()) { this.err('missing "}"', m); break }
            if (this.peek() === '}') { this.next(); break }
            const sm = this.mark()
            const slot = this.word()
            if (slot === 'tolerance') { const n = this.number(); if (n === null) { this.err('value expected after "tolerance"', sm); this.skipLine(); continue } grid = n }
            else if (slot === 'enabled') { this.skipSpace(); const epos = this.mark(); const ex = this.lineExpr(); if (!ex) { this.err('expression expected after "enabled"', sm); this.skipLine(); continue } this.exprSite(ex, epos); enabled = ex }
            else { this.err(`unknown slot "${slot}" (expected: tolerance, enabled)`, sm); this.skipLine(); continue }
            this.endStatement()
          }
        } else this.endStatement()
        return { kind: 'interactor', axis: 'trace', varX: v, confine: path, ...(grid !== undefined ? { grid } : {}), ...(enabled ? { enabled } : {}) }
      }
      case 'reveal': {
        // `reveal <progress> [{ brush N · enabled <expr> }]` — scratch/wipe: the object IS the revealed zone,
        // the progress 0..1 climbs (monotonically) as the finger covers its surface.
        const v = this.outVar()
        if (!v) { this.err('variable name (progress) expected after "reveal"', m); this.recoverBlockOrLine(); return null }
        let grid: number | undefined
        let enabled: string | undefined
        this.skipSpace()
        if (this.peek() === '{') { // slots: { brush N · enabled <expr> }
          this.next()
          for (;;) {
            this.skipWs()
            if (this.eof()) { this.err('missing "}"', m); break }
            if (this.peek() === '}') { this.next(); break }
            const sm = this.mark()
            const slot = this.word()
            if (slot === 'brush') { const n = this.number(); if (n === null) { this.err('value expected after "brush"', sm); this.skipLine(); continue } grid = n }
            else if (slot === 'enabled') { this.skipSpace(); const epos = this.mark(); const ex = this.lineExpr(); if (!ex) { this.err('expression expected after "enabled"', sm); this.skipLine(); continue } this.exprSite(ex, epos); enabled = ex }
            else { this.err(`unknown slot "${slot}" (expected: brush, enabled)`, sm); this.skipLine(); continue }
            this.endStatement()
          }
        } else this.endStatement()
        return { kind: 'interactor', axis: 'reveal', varX: v, ...(grid !== undefined ? { grid } : {}), ...(enabled ? { enabled } : {}) }
      }
      case 'link': {
        // `link <endX>, <endY>, <target> to <Targets> [{ enabled <expr> }]` — pulls an elastic thread toward a
        // target of a GROUP. During the drag: endX/endY = pointer (the author DRAWS the thread). On release:
        // target = index 1..n of the reached target (0 = none).
        const vx = this.outVar()
        if (!vx) { this.err('endX variable expected after "link"', m); this.recoverBlockOrLine(); return null }
        if (!this.eat(',')) { this.err('"," expected: link endX, endY, target to <Targets>', m); this.recoverBlockOrLine(); return null }
        const vy = this.outVar()
        if (!vy) { this.err('endY variable expected: link endX, endY, target to <Targets>', m); this.recoverBlockOrLine(); return null }
        if (!this.eat(',')) { this.err('"," expected: link endX, endY, target to <Targets>', m); this.recoverBlockOrLine(); return null }
        const vt = this.outVar()
        if (!vt) { this.err('target variable expected: link endX, endY, target to <Targets>', m); this.recoverBlockOrLine(); return null }
        if (this.word() !== 'to') { this.err('"link endX, endY, target to <Targets>" expected', m); this.recoverBlockOrLine(); return null }
        const targets = this.word()
        if (!targets) { this.err('target-group name expected after "to"', m); this.recoverBlockOrLine(); return null }
        let enabled: string | undefined
        this.skipSpace()
        if (this.peek() === '{') { // slots: { enabled <expr> }
          this.next()
          for (;;) {
            this.skipWs()
            if (this.eof()) { this.err('missing "}"', m); break }
            if (this.peek() === '}') { this.next(); break }
            const sm = this.mark()
            const slot = this.word()
            if (slot === 'enabled') { this.skipSpace(); const epos = this.mark(); const ex = this.lineExpr(); if (!ex) { this.err('expression expected after "enabled"', sm); this.skipLine(); continue } this.exprSite(ex, epos); enabled = ex }
            else { this.err(`unknown slot "${slot}" (expected: enabled)`, sm); this.skipLine(); continue }
            this.endStatement()
          }
        } else this.endStatement()
        return { kind: 'interactor', axis: 'link', varX: vx, varY: vy, varT: vt, confine: targets, ...(enabled ? { enabled } : {}) }
      }
      case 'fn': {
        const name = this.word()
        if (!name) { this.err('function name expected after "fn"', m); this.recoverBlockOrLine(); return null }
        this.skipSpace()
        if (this.peek() !== '(') { this.err(`"(" expected after "fn ${name}"`, m); this.recoverBlockOrLine(); return null }
        const params = this.callArgs()
        this.skipSpace()
        if (this.peek() === '=') { // value-function: fn name(p) = <expr>
          this.next()
          this.skipSpace()
          const pos = this.mark()
          const expr = this.lineExpr()
          if (!expr) { this.err('expression expected after "="', m); return null }
          this.exprSite(expr, pos)
          this.endStatement()
          return { kind: 'func', func: { name, params, kind: 'value', expr } }
        }
        if (!this.expectBrace()) return null // procedure: fn name(p) { … }
        return { kind: 'func', func: { name, params, kind: 'proc', body: this.body() } }
      }
      case 'each': {
        const symbol = this.string()
        if (symbol === null) { this.recoverBlockOrLine(); return null }
        if (this.word() !== 'as') { this.err('"as <index>" expected: each "Symbol" as i { … }', m); this.recoverBlockOrLine(); return null }
        const asVar = this.word()
        if (!asVar) { this.err('index name expected after "as"', m); this.recoverBlockOrLine(); return null }
        if (!this.expectBrace()) return null
        const bindings: { channel: ExprChannel; expr: string }[] = []
        for (;;) {
          this.skipWs()
          if (this.eof()) { this.err('missing "}"', m); break }
          if (this.peek() === '}') { this.next(); break }
          const bm = this.mark()
          const ch = this.word()
          if (!this.eat('=')) { this.err(`"=" expected after "${ch}"`, bm); this.skipLine(); continue }
          this.skipSpace()
          const pos = this.mark()
          const expr = this.lineExpr()
          const deg = ch === 'rotationDeg' // authoring sugar: `rotationDeg = e` → `rotation = rad(e)`
          if (!deg && !isChannel(ch)) { this.err(`unknown channel "${ch}" (expected: ${EXPR_CHANNELS.join(', ')}, rotationDeg)`, bm); continue }
          if (!expr) { this.err('expression expected after "="', bm); continue }
          this.exprSite(expr, pos)
          this.endStatement()
          bindings.push(deg ? { channel: 'rotation', expr: `rad(${expr})` } : { channel: ch as ExprChannel, expr })
        }
        return { kind: 'each', symbol, as: asVar, bindings }
      }
      case 'label': {
        const n = this.number()
        if (n === null) {
          this.err('frame number expected after "label"', m)
          this.skipLine()
          return null
        }
        const name = this.string()
        if (name === null) {
          this.skipLine()
          return null
        }
        this.endStatement()
        return { kind: 'label', frame: n, name }
      }
      case 'let': {
        const name = this.word()
        if (!name) {
          this.err('variable name expected after "let"', m)
          this.skipLine()
          return null
        }
        if (!this.eat('=')) {
          this.err(`"=" expected after "let ${name}"`, m)
          this.skipLine()
          return null
        }
        const v = this.declareValue(m)
        if (v === null) {
          this.err('initial value expected: number, "[a, b, …]" or "fill(n, v)"', m)
          this.skipLine()
          return null
        }
        this.endStatement()
        return { kind: 'declare', name, value: v }
      }
      case '':
        this.err('declaration expected', m)
        this.skipLine()
        return null
      default: {
        // channel binding: `<channel> = <expr>`
        if (!this.eat('=')) {
          this.err(`unexpected statement "${w}" (expected an event, "at frame", "label", "let", or "channel = …")`, m)
          this.skipLine()
          return null
        }
        this.skipSpace()
        const pos = this.mark()
        const expr = this.lineExpr()
        const deg = w === 'rotationDeg' // authoring sugar: `rotationDeg = e` → `rotation = rad(e)` (degrees → radians)
        if (!deg && !isChannel(w)) {
          this.err(`unknown channel "${w}" (expected: ${EXPR_CHANNELS.join(', ')}, rotationDeg)`, m)
          return null
        }
        if (!expr) {
          this.err('expression expected after "="', m)
          return null
        }
        this.exprSite(expr, pos)
        this.endStatement()
        return { kind: 'binding', channel: deg ? 'rotation' : (w as ExprChannel), expr: deg ? `rad(${expr})` : expr }
      }
    }
  }
}

/** Parses DSL source into units + diagnostics + sites (never throws). */
export function parseUnits(src: string): ParseResult {
  const p = new Parser(src)
  const units = p.parse()
  return { units, diagnostics: p.diags, sites: p.sites }
}
