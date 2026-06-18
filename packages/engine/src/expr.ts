// ─────────────────────────────────────────────────────────────────────────────
//  expr.ts — a mini expression interpreter, PURE and WITHOUT `eval`.
//
//  Serves the timeline "expressions" (`rotation = sin(time)*20`). EXPRESSION-only language
//  (no statements, no loops, no assignment) → it cannot loop forever, only touches the provided
//  context (a "domain sandbox"), and is CSP-safe (no `eval`/`new Function`). Reusable in the player.
//
//  Grammar (low → high precedence):
//    ?: │ || │ && │ == != │ < > <= >= │ + - │ * / % │ unary - ! │ call/member │ primary
// ─────────────────────────────────────────────────────────────────────────────

import type { ExprContext } from '@flatkit/types'
export type { ExprContext } from '@flatkit/types'

type Node =
  | { t: 'num'; v: number }
  | { t: 'id'; name: string }
  | { t: 'un'; op: string; x: Node }
  | { t: 'bin'; op: string; l: Node; r: Node }
  | { t: 'cond'; c: Node; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] }
  | { t: 'member'; obj: string; prop: string }
  | { t: 'index'; name: string; idx: Node } // indexed array: arr[i]

export type Compiled = { ok: true; node: Node } | { ok: false; error: string }

// ── Tokenizer ────────────────────────────────────────────────────────────────
type Tok = { k: 'num' | 'id' | 'op' | 'eof'; v: string }
const OPS3: string[] = []
const OPS2 = ['<=', '>=', '==', '!=', '&&', '||']
const OPS1 = '+-*/%<>!?:.,()[]'

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      let j = i + 1
      while (j < n && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++
      out.push({ k: 'num', v: src.slice(i, j) })
      i = j
      continue
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i + 1
      while (j < n && ((src[j] >= 'a' && src[j] <= 'z') || (src[j] >= 'A' && src[j] <= 'Z') || (src[j] >= '0' && src[j] <= '9') || src[j] === '_')) j++
      out.push({ k: 'id', v: src.slice(i, j) })
      i = j
      continue
    }
    const two = src.slice(i, i + 2)
    if (OPS3.includes(src.slice(i, i + 3))) {
      out.push({ k: 'op', v: src.slice(i, i + 3) })
      i += 3
      continue
    }
    if (OPS2.includes(two)) {
      out.push({ k: 'op', v: two })
      i += 2
      continue
    }
    if (OPS1.includes(c)) {
      out.push({ k: 'op', v: c })
      i++
      continue
    }
    throw new Error(`unexpected character "${c}"`)
  }
  out.push({ k: 'eof', v: '' })
  return out
}

// ── Parser (recursive descent) ───────────────────────────────────────────────
class Parser {
  private p = 0
  constructor(private toks: Tok[]) {}
  private peek() {
    return this.toks[this.p]
  }
  private next() {
    return this.toks[this.p++]
  }
  private eat(v: string) {
    const t = this.toks[this.p]
    if (t.v !== v) throw new Error(`expected "${v}", found "${t.v || 'end'}"`)
    this.p++
  }
  private isOp(v: string) {
    const t = this.peek()
    return t.k === 'op' && t.v === v
  }

  parse(): Node {
    const node = this.ternary()
    if (this.peek().k !== 'eof') throw new Error(`unexpected "${this.peek().v}"`)
    return node
  }

  private ternary(): Node {
    const c = this.or()
    if (this.isOp('?')) {
      this.next()
      const a = this.ternary()
      this.eat(':')
      const b = this.ternary()
      return { t: 'cond', c, a, b }
    }
    return c
  }
  private binL(next: () => Node, ops: string[]): Node {
    let l = next()
    while (this.peek().k === 'op' && ops.includes(this.peek().v)) {
      const op = this.next().v
      l = { t: 'bin', op, l, r: next() }
    }
    return l
  }
  private or() {
    return this.binL(() => this.and(), ['||'])
  }
  private and() {
    return this.binL(() => this.eq(), ['&&'])
  }
  private eq() {
    return this.binL(() => this.cmp(), ['==', '!='])
  }
  private cmp() {
    return this.binL(() => this.add(), ['<', '>', '<=', '>='])
  }
  private add() {
    return this.binL(() => this.mul(), ['+', '-'])
  }
  private mul() {
    return this.binL(() => this.unary(), ['*', '/', '%'])
  }
  private unary(): Node {
    if (this.isOp('-') || this.isOp('!')) {
      const op = this.next().v
      return { t: 'un', op, x: this.unary() }
    }
    return this.primary()
  }
  private primary(): Node {
    const t = this.peek()
    if (t.k === 'num') {
      this.next()
      const v = Number(t.v)
      if (!Number.isFinite(v)) throw new Error(`invalid number "${t.v}"`)
      return { t: 'num', v }
    }
    if (this.isOp('(')) {
      this.next()
      const e = this.ternary()
      this.eat(')')
      return e
    }
    if (t.k === 'id') {
      this.next()
      if (this.isOp('(')) {
        this.next()
        const args: Node[] = []
        if (!this.isOp(')')) {
          args.push(this.ternary())
          while (this.isOp(',')) {
            this.next()
            args.push(this.ternary())
          }
        }
        this.eat(')')
        return { t: 'call', name: t.v, args }
      }
      if (this.isOp('.')) {
        this.next()
        const prop = this.next()
        if (prop.k !== 'id') throw new Error('expected a property name after "."')
        if (this.isOp('(')) { // QUALIFIED call: collision.boxHit(…) → a call named "collision.boxHit"
          this.next()
          const args: Node[] = []
          if (!this.isOp(')')) {
            args.push(this.ternary())
            while (this.isOp(',')) { this.next(); args.push(this.ternary()) }
          }
          this.eat(')')
          return { t: 'call', name: t.v + '.' + prop.v, args }
        }
        return { t: 'member', obj: t.v, prop: prop.v }
      }
      if (this.isOp('[')) {
        this.next()
        const idx = this.ternary()
        this.eat(']')
        return { t: 'index', name: t.v, idx }
      }
      return { t: 'id', name: t.v }
    }
    throw new Error(`expected an expression, found "${t.v || 'end'}"`)
  }
}

/** Compile a source into an AST (or an error message). Pure, never throws. */
export function compileExpr(src: string): Compiled {
  try {
    const node = new Parser(tokenize(src)).parse()
    return { ok: true, node }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Memoized `compileExpr`: the AST of an expression source is immutable, so we parse each distinct source
 *  ONCE and reuse it. Hot for the channel resolver AND the `every frame` script interpreter (which evaluates
 *  hundreds of expressions per frame); the cache turns those re-parses into a map lookup. The key set is
 *  bounded by the doc's distinct expression sources. */
const exprCache = new Map<string, Compiled>()
export function compileCached(src: string): Compiled {
  let c = exprCache.get(src)
  if (!c) { c = compileExpr(src); exprCache.set(src, c) }
  return c
}

// ── Evaluation ───────────────────────────────────────────────────────────────
const num = (b: boolean) => (b ? 1 : 0)

function evalNode(node: Node, ctx: ExprContext): number {
  switch (node.t) {
    case 'num':
      return node.v
    case 'id': {
      // Own properties only: never reach inherited members (constructor, valueOf, __proto__…).
      const v = Object.hasOwn(ctx, node.name) ? ctx[node.name] : undefined
      return typeof v === 'number' ? v : Number.NaN
    }
    case 'member': {
      const o = Object.hasOwn(ctx, node.obj) ? ctx[node.obj] : undefined
      return o && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, node.prop) && typeof o[node.prop] === 'number' ? o[node.prop] : Number.NaN
    }
    case 'index': {
      const a = Object.hasOwn(ctx, node.name) ? ctx[node.name] : undefined
      if (!Array.isArray(a)) return Number.NaN
      const v = a[Math.round(evalNode(node.idx, ctx))]
      return typeof v === 'number' ? v : Number.NaN
    }
    case 'un': {
      const x = evalNode(node.x, ctx)
      return node.op === '-' ? -x : num(x === 0)
    }
    case 'cond':
      return evalNode(node.c, ctx) === 0 ? evalNode(node.b, ctx) : evalNode(node.a, ctx)
    case 'call': {
      // Own properties only: never call an inherited function (constructor, hasOwnProperty…).
      const fn = Object.hasOwn(ctx, node.name) ? ctx[node.name] : undefined
      if (typeof fn !== 'function') return Number.NaN
      return fn(...node.args.map((a) => evalNode(a, ctx)))
    }
    case 'bin': {
      const l = evalNode(node.l, ctx)
      const r = evalNode(node.r, ctx)
      switch (node.op) {
        case '+':
          return l + r
        case '-':
          return l - r
        case '*':
          return l * r
        case '/':
          return l / r
        case '%':
          return l % r
        case '<':
          return num(l < r)
        case '>':
          return num(l > r)
        case '<=':
          return num(l <= r)
        case '>=':
          return num(l >= r)
        case '==':
          return num(l === r)
        case '!=':
          return num(l !== r)
        case '&&':
          return num(l !== 0 && r !== 0)
        case '||':
          return num(l !== 0 || r !== 0)
      }
      return Number.NaN
    }
  }
}

/** Evaluate a compiled AST. `fallback` is returned when the result is not finite (NaN/∞). */
export function evalExpr(node: Node, ctx: ExprContext, fallback = 0): number {
  const v = evalNode(node, ctx)
  return Number.isFinite(v) ? v : fallback
}

/**
 * Build the evaluation context (canonical order, sandbox): `extra` (variables/mouse/keys/random) then
 * MATH (reserved functions & names take priority) then `time`/`frame`/`clock`/`value`. A single source
 * shared by the timeline and the player.
 *
 * `clock` = MONOTONE elapsed seconds, never wrapped by the timeline loop (unlike `time = frame/fps`,
 * which resets to 0 every `durationFrames`). Use it for ambient motion in a looping/interactive scene so
 * `sin(clock*f)` doesn't jump on each loop. Defaults to `time` (in a static eval there is no playback to
 * accumulate, so the two coincide); only a live player threads the real monotone value.
 */
export function exprScope(extra: ExprContext | undefined, time: number, frame: number, value?: number, clock?: number): ExprContext {
  const ctx: ExprContext = { ...extra, ...MATH_CTX, time, frame }
  // `clock` rides INSIDE `extra` when the player provides it (engine resolvers don't take it as a param):
  // explicit arg wins, then a clock carried in `extra`, else it coincides with `time` (static eval).
  ctx.clock = clock ?? (typeof extra?.clock === 'number' ? extra.clock : time)
  if (value !== undefined) ctx.value = value
  return ctx
}

// ── Static analysis (for the linter) ─────────────────────────────────────────
/** Identifiers referenced by an expression: bare ids, member objects, functions. */
export type ExprRefs = { ids: string[]; members: string[]; calls: string[] }

function collectRefs(node: Node, ids: Set<string>, members: Set<string>, calls: Set<string>): void {
  switch (node.t) {
    case 'num':
      return
    case 'id':
      ids.add(node.name)
      return
    case 'member':
      members.add(node.obj)
      return
    case 'un':
      collectRefs(node.x, ids, members, calls)
      return
    case 'bin':
      collectRefs(node.l, ids, members, calls)
      collectRefs(node.r, ids, members, calls)
      return
    case 'cond':
      collectRefs(node.c, ids, members, calls)
      collectRefs(node.a, ids, members, calls)
      collectRefs(node.b, ids, members, calls)
      return
    case 'call':
      calls.add(node.name)
      for (const a of node.args) collectRefs(a, ids, members, calls)
      return
    case 'index':
      ids.add(node.name) // the array is a known variable
      collectRefs(node.idx, ids, members, calls)
      return
  }
}

/** Compile + extract the referenced identifiers (linter). Pure, never throws. */
export function analyzeExpr(src: string): { ok: true; refs: ExprRefs } | { ok: false; error: string } {
  const c = compileExpr(src)
  if (!c.ok) return { ok: false, error: c.error }
  const ids = new Set<string>()
  const members = new Set<string>()
  const calls = new Set<string>()
  collectRefs(c.node, ids, members, calls)
  return { ok: true, refs: { ids: [...ids], members: [...members], calls: [...calls] } }
}

/** Table of math functions/constants exposed to expressions. */
export const MATH_CTX: ExprContext = {
  PI: Math.PI,
  TAU: Math.PI * 2,
  E: Math.E,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  abs: Math.abs,
  sqrt: Math.sqrt,
  pow: Math.pow,
  exp: Math.exp,
  log: Math.log,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  hypot: Math.hypot,
  clamp: (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x)),
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  mod: (a: number, b: number) => ((a % b) + b) % b,
  rad: (deg: number) => (deg * Math.PI) / 180, // degrees → radians (the `rotation` channel is radians)
  deg: (rad: number) => (rad * 180) / Math.PI, // radians → degrees
  turns: (n: number) => n * Math.PI * 2, // full turns → radians, e.g. `rotation = turns(time)` spins once/second
  between: (x: number, lo: number, hi: number) => (x >= lo && x <= hi ? 1 : 0), // interval test (zone/collision) → 1/0
}

// ── Standard environment (names): the source of truth for the linter ─────────
// The runtime PROVIDES the values (timeline → time/frame/value; player → mouse/keys/random/variables);
// here we declare the NAMES so we can validate without evaluating.
/** Bare constants (PI, TAU, E). */
export const STD_CONSTANTS: string[] = Object.keys(MATH_CTX).filter((k) => typeof MATH_CTX[k] === 'number')
/** Callable functions (sin, clamp, lerp… + random + world⇄local conversions provided by the player). */
export const STD_FUNCTIONS: string[] = [...Object.keys(MATH_CTX).filter((k) => typeof MATH_CTX[k] === 'function'), 'random', 'toLocalX', 'toLocalY', 'toGlobalX', 'toGlobalY']
/** Reserved scalars provided by the runtime. `clock` = monotone elapsed seconds (never wraps; for ambient
 *  motion in a looping scene), as opposed to `time` which resets every `durationFrames`. */
export const STD_IDS: string[] = ['time', 'frame', 'clock', 'value']
/** Member-access objects (mouse.x, keys.ArrowRight, self.x in a channel binding). */
export const STD_OBJECTS: string[] = ['mouse', 'keys', 'self']
