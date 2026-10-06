// ─────────────────────────────────────────────────────────────────────────────
//  lint.ts — linter for the FlatInk Script language (batch L3).
//
//  Builds on the parser (dsl.ts) for syntax errors + positions, then adds
//  SEMANTIC validation, ~free and PURE:
//   • each expression is compiled (compileExpr) → expression syntax error;
//   • referenced functions / member objects / identifiers are checked against
//     the standard environment (expr.ts) + the known variables → "unknown";
//   • `go to "label"` is checked against the set of known labels.
//
//  Tolerant and kid-friendly: a variable is "known" if it is declared
//  (`let`) OR simply assigned (`x = …`) somewhere in the source, or provided
//  by the caller (document global variables). Labels are only checked
//  if the caller provides their list (otherwise we don't know the universe).
// ─────────────────────────────────────────────────────────────────────────────
import { analyzeExpr, MATH_CTX, STD_CONSTANTS, STD_FUNCTIONS, STD_IDS, STD_OBJECTS } from '@flatkit/engine/expr'
import { packageFunctionNames, resolvePackage } from '@flatkit/engine/stdlib'
import { parseUnits, type Diagnostic, type ScriptUnit, type TextEdit } from '@flatkit/engine/dsl'
import type { Action } from '@flatkit/engine/actions'
import { didYouMean } from './suggest'

export type LintContext = {
  /** Known variables in addition to those declared/assigned in the source. */
  variables?: Iterable<string>
  /** Known labels (timeline). Absent = we don't check `go to "…"`. */
  labels?: Iterable<string>
  /** Known functions in addition to those defined in the source. */
  functions?: Iterable<string>
  /** Scene objects referenceable by name (`Hero.x`) — in addition to mouse/keys. */
  objects?: Iterable<string>
  /** Parameter count of the caller's functions (`functions`), so a call to one is counted too. */
  arities?: Record<string, number>
  /** Fields an object answers to beyond its channels: an instance's params and states (`R.bras`). */
  fields?: Record<string, string[]>
}

/** What `obj.field` may read (flatink/flatink#68, from #65.5c). An object's channels; `self` adds its
 *  interaction state; `mouse` its pointer; `keys` is open-ended. */
const CHANNEL_FIELDS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity']
const BUILTIN_FIELDS: Record<string, string[]> = {
  mouse: ['x', 'y', 'dx', 'dy', 'wheel'],
  self: [...CHANNEL_FIELDS, 'hovered', 'grabbed', 'pressed', 'focused'],
}

/** Arguments a built-in takes: a count, or `'1+'` for the variadic ones. Arguments were never counted —
 *  `round(3.14159, 2)` is 3, `clamp(a, 0)` is 0, `random(10)` stays in 0..1 (flatink/flatink#65). */
const VARIADIC = new Set(['min', 'max', 'hypot'])
const BUILTIN_ARITY: Record<string, number | '1+'> = {
  ...Object.fromEntries(Object.entries(MATH_CTX).filter(([, v]) => typeof v === 'function').map(([k, v]) => [k, VARIADIC.has(k) ? '1+' : (v as (...a: number[]) => number).length])),
  random: 0, toLocalX: 2, toLocalY: 2, toGlobalX: 2, toGlobalY: 2, velocity: 1,
}
const plural = (n: number) => (n === 0 ? 'no argument' : n === 1 ? '1 argument' : `${n} arguments`)
/** The arity diagnostic of one call, or undefined when it is right (or the function is not counted). */
function arityMessage(name: string, got: number, arities: Map<string, number | '1+'>): string | undefined {
  const want = arities.get(name)
  if (want === undefined) return undefined
  if (want === '1+') return got >= 1 ? undefined : `"${name}" takes at least 1 argument, ${got === 0 ? 'none' : got} given`
  return got === want ? undefined : `"${name}" takes ${plural(want)}, ${got} given`
}

/** Collects the names of ASSIGNED variables (setVar) + loop vars, inside action bodies. */
function collectAssigned(actions: Action[], into: Set<string>): void {
  for (const a of actions) {
    if (a.do === 'setVar') into.add(a.name)
    else if (a.do === 'if') {
      collectAssigned(a.then, into)
      if (a.else) collectAssigned(a.else, into)
    } else if (a.do === 'repeat') collectAssigned(a.body, into)
    else if (a.do === 'repeatRange') { into.add(a.var); collectAssigned(a.body, into) } // i is known in the body
  }
}

/** Locally known variables: `let` declarations + every assigned variable. */
export function localVariables(units: ScriptUnit[]): Set<string> {
  const vars = new Set<string>()
  for (const u of units) {
    if (u.kind === 'declare') vars.add(u.name)
    else if (u.kind === 'event' || u.kind === 'frameActions') collectAssigned(u.body, vars)
    else if (u.kind === 'each') vars.add(u.as) // the index is known in the each bindings
    else if (u.kind === 'interactor') { if (u.varX) vars.add(u.varX); if (u.varY) vars.add(u.varY) } // drag writes these variables
    else if (u.kind === 'drop') collectAssigned(u.body, vars)
    else if (u.kind === 'func') { for (const p of u.func.params) vars.add(p); if (u.func.kind === 'proc') collectAssigned(u.func.body, vars) } // params + assignments
  }
  return vars
}

/** Detects a `text(` call (whole word) in an expression → only allowed in a `send` payload. */
const TEXT_CALL = /\btext\s*\(/

/** A bare assignment (`x =`, `a[i] =`; NOT ==/<=/>=/!=) left inside an expression: the tell-tale of a
 *  SECOND statement crammed onto one line (FlatInk ends a statement at the newline, so it got swallowed). */
const SECOND_ASSIGN = /[\w\]]\s*=(?![=])/

/** Same tell-tale for the statements that are NOT assignments — `score = score + 1  send "correct", 1`
 *  swallowed the `send` and reported a bewildering `unexpected character """` instead. All of these are
 *  RESERVED words (cf. ident.ts), so none can legitimately appear as a name inside an expression. */
const SECOND_ACTION = /\b(send|play|pause|sound|set|go|repeat)\b/

/** Where the swallowed SECOND statement begins inside the expression text, or -1. `send`-style actions
 *  start at their keyword; a swallowed assignment starts at the identifier its `=` belongs to. */
function splitPoint(text: string): number {
  const act = SECOND_ACTION.exec(text)
  if (act) return act.index
  const asg = SECOND_ASSIGN.exec(text)
  if (!asg) return -1
  const upTo = text.slice(0, asg.index + 1) // the char before `=` is the last of the identifier
  const id = /[A-Za-z_$][\w$]*\s*$/.exec(upTo)
  return id ? upTo.length - id[0].length : -1
}

/** The `fix` half of the two-statements diagnostic: replace the expression text with its two lines. */
function withSplit(s: { text: string; line: number; col: number }): { fix?: TextEdit } {
  const at = splitPoint(s.text)
  if (at <= 0) return {}
  const left = s.text.slice(0, at).trimEnd()
  const right = s.text.slice(at).trim()
  if (!left || !right) return {}
  return { fix: { line: s.line, col: s.col, endLine: s.line, endCol: s.col + s.text.length, replacement: `${left}\n${right}` } }
}

/** Analyze a DSL source and return all diagnostics (syntax + semantic). */
export function lint(src: string, ctx: LintContext = {}): Diagnostic[] {
  const { units, diagnostics, sites } = parseUnits(src)
  const out: Diagnostic[] = [...diagnostics]

  const variables = localVariables(units)
  for (const v of ctx.variables ?? []) variables.add(v)
  const knownIds = new Set<string>([...STD_IDS, ...STD_CONSTANTS, ...variables])
  const knownFns = new Set(STD_FUNCTIONS)
  knownFns.add('velocity') // valid inside a spring/smooth target (resolved by the modifier advance); NOT a stdlib
  const arities = new Map<string, number | '1+'>(Object.entries(BUILTIN_ARITY))
  const procs = new Set<string>() // what a `name(args)` statement may call
  for (const [k, n] of Object.entries(ctx.arities ?? {})) arities.set(k, n)
  for (const f of ctx.functions ?? []) { knownFns.add(f); procs.add(f) }
  for (const u of units) {
    if (u.kind === 'func') { knownFns.add(u.func.name); procs.add(u.func.name); arities.set(u.func.name, u.func.params.length) } // user-defined functions
    else if (u.kind === 'use') {
      for (const name of packageFunctionNames(u.name)) { knownFns.add(name); procs.add(name) } // package functions (bare + qualified)
      for (const f of resolvePackage(u.name)) { arities.set(f.name, f.params.length); arities.set(`${u.name}.${f.name}`, f.params.length) }
    }
  }
  const knownObjs = new Set(STD_OBJECTS)
  for (const o of ctx.objects ?? []) knownObjs.add(o) // scene objects (Hero.x…)
  const labels = ctx.labels ? new Set(ctx.labels) : null

  for (const s of sites) {
    if (s.kind === 'expr') {
      // `text(…)` is valid ONLY as a `send` payload (consumed by the parser, never
      // exposed as an expression site). Seeing it here = out-of-context use → dedicated error.
      if (TEXT_CALL.test(s.text)) {
        out.push({ line: s.line, col: s.col, message: 'text("…") is only allowed as an argument to "send"' })
        continue
      }
      const a = analyzeExpr(s.text)
      if (!a.ok) {
        // #1 footgun: two statements on one line. The 2nd one got swallowed into this expression → a
        // cryptic "unexpected character = / \"". Detect the leftover statement and NAME it, so the rule
        // ("one action per line") is visible from the message rather than only from the docs.
        const leftover = SECOND_ASSIGN.test(s.text) ? 'an assignment' : SECOND_ACTION.test(s.text) ? `\`${SECOND_ACTION.exec(s.text)![1]} …\`` : ''
        const message = leftover
          ? `two statements on one line — ${leftover} was swallowed into the expression before it. FlatInk ends a statement at the NEWLINE: put each action on its own line.`
          : `invalid expression: ${a.error}`
        // The repair is mechanical: the boundary is where the SECOND statement starts, and the parser
        // already located it to name it. Split there; anything else about the line stays untouched.
        out.push({ line: s.line, col: s.col, message, ...(leftover ? withSplit(s) : {}) })
        continue
      }
      for (const fn of a.refs.calls) if (!knownFns.has(fn)) out.push({ line: s.line, col: s.col, message: `unknown function "${fn}"` })
      for (const [fn, got] of a.refs.arity) { const m = arityMessage(fn, got, arities); if (m) out.push({ line: s.line, col: s.col, message: m }) }
      for (const o of a.refs.members)
        if (!knownObjs.has(o)) out.push({ line: s.line, col: s.col, message: `unknown object "${o}" (expected: ${[...knownObjs].join(', ')})` })
      // A field the object does not have read 0 in silence. A warning: an instance's fields are its symbol's.
      for (const [o, f] of a.refs.fields) {
        if (o === 'keys' || !knownObjs.has(o)) continue
        // Own keys only: `toString.x` must not read Object.prototype.toString out of these tables.
        const allowed = Object.hasOwn(BUILTIN_FIELDS, o) ? BUILTIN_FIELDS[o]! : [...CHANNEL_FIELDS, ...(ctx.fields && Object.hasOwn(ctx.fields, o) ? ctx.fields[o]! : [])]
        if (!allowed.includes(f)) out.push({ line: s.line, col: s.col, severity: 'warning', message: `${o === 'mouse' || o === 'self' ? o : `"${o}"`} has no field "${f}" — it reads 0 (${allowed.join(', ')})${didYouMean(f, allowed)}` })
      }
      for (const id of a.refs.ids)
        if (!knownIds.has(id))
          // The hint names the DOCUMENT declaration (`var`, at the top level of the program), because that
          // is the one every scope can read. `let` declares in the scope it sits in — which is why the old
          // hint sent a reader in a circle: they declared with `let`, the binding still could not see it,
          // and the message repeated itself. (Both spellings mean the same thing at the top level of a
          // program; inside an `object` block a declaration is refused outright, with its own message.)
          out.push({ line: s.line, col: s.col, message: `unknown variable "${id}"${variables.size ? '' : ` — declare it at the top level of the program: \`var ${id} = 0\``}` })
    } else if (s.kind === 'call-ref') {
      // A call statement naming nothing was skipped at runtime, while the same name in an expression was
      // already an error (flatink/flatink#65).
      if (!procs.has(s.name)) out.push({ line: s.line, col: s.col, message: `unknown procedure "${s.name}" — declare it with \`fn ${s.name}() { … }\`` })
      else { const m = arityMessage(s.name, s.argc, arities); if (m) out.push({ line: s.line, col: s.col, message: m }) }
    } else if (labels && !labels.has(s.name)) {
      out.push({ line: s.line, col: s.col, message: `unknown label "${s.name}"` })
    }
  }

  return out.sort((a, b) => a.line - b.line || a.col - b.col)
}

/**
 * Lint report ready to feed back to a generator (LLM/CLI): `''` = no issue (the code passes),
 * otherwise one `line:col: message` line per diagnostic. Primitive of the "generate → lint →
 * fix" loop: the language fits in few tokens, robustness comes from this feedback, not from context.
 */
export function lintReport(src: string, ctx: LintContext = {}): string {
  return lint(src, ctx).map((d) => `${d.line}:${d.col}: ${d.message}`).join('\n')
}
